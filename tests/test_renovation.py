import copy
import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.renovation import router


def state():
    return {'schemaVersion': 1, 'buildingId': 'pdf-residence-1', 'materials': [
        {'id': 'custom-tile', 'name': '我的瓷砖', 'color': '#112233', 'texture': 'custom', 'image': 'data:image/jpeg;base64,AA==', 'pricePerM2': 65}],
        'finishes': {'f1-front': {'materialId': 'custom-tile', 'widthMm': 600, 'heightMm': 1200, 'direction': 'horizontal', 'groutMm': 3, 'groutColor': '#778899', 'alignment': 'edge', 'preserveZoning': False}},
        'faceFinishes': {}, 'faceRegionFinishes': {'f1-front:face:-60': {'materialId': 'custom-tile', 'widthMm': 300, 'heightMm': 900, 'direction': 'vertical', 'groutMm': 5, 'groutColor': '#778899', 'alignment': 'center'}},
        'windowFinishes': {'f1-s-window': {'frameColor': '#445566', 'glassType': 'medium'}}, 'hiddenFloors': ['f2'], 'exploded': True}


class RenovationPlansTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {'WINDOW_DATA_DIR': self.temp.name})
        self.environment.start()
        self.original = Path(self.temp.name) / 'windows.sqlite3'
        self.original.write_bytes(b'original window database must never be opened')
        self.original_hash = hashlib.sha256(self.original.read_bytes()).hexdigest()
        app = FastAPI(); app.include_router(router)
        self.client = TestClient(app)
        self.url = '/api/renovation3d/plans'

    def tearDown(self):
        self.assertEqual(hashlib.sha256(self.original.read_bytes()).hexdigest(), self.original_hash)
        self.client.close(); self.environment.stop(); self.temp.cleanup()

    def save(self, name='装修方案'):
        result = self.client.post(self.url, json={'name': name, 'state': state()})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_each_save_creates_an_independent_snapshot_and_restores_all_parameters(self):
        first = self.save('第一版'); second = self.save('第二版')
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(first['state'], state())
        self.assertEqual(self.client.get(f"{self.url}/{first['id']}").json(), first)
        history = self.client.get(self.url).json()
        self.assertEqual([item['id'] for item in history], [second['id'], first['id']])
        self.assertTrue(all(set(item) == {'id', 'name', 'createdAt', 'updatedAt'} for item in history))
        self.assertTrue((Path(self.temp.name) / 'renovation3d.sqlite3').is_file())

    def test_rename_changes_only_name_and_updated_time_and_read_does_not_write(self):
        saved = self.save()
        db = Path(self.temp.name) / 'renovation3d.sqlite3'
        with sqlite3.connect(db) as con:
            before = con.execute('SELECT state,created_at FROM plans WHERE id=?', (saved['id'],)).fetchone()
        renamed = self.client.patch(f"{self.url}/{saved['id']}", json={'name': '  已改名  '}).json()
        self.assertEqual(renamed['name'], '已改名'); self.assertEqual(renamed['state'], saved['state'])
        self.assertEqual(renamed['createdAt'], saved['createdAt'])
        with sqlite3.connect(db) as con:
            self.assertEqual(con.execute('SELECT state,created_at FROM plans WHERE id=?', (saved['id'],)).fetchone(), before)
        digest = hashlib.sha256(db.read_bytes()).hexdigest()
        self.assertEqual(self.client.get(f"{self.url}/{saved['id']}").json(), renamed)
        self.assertEqual(self.client.get(self.url).json()[0]['name'], '已改名')
        self.assertEqual(hashlib.sha256(db.read_bytes()).hexdigest(), digest)

    def test_paint_kind_round_trips_in_independent_plan_and_style_without_changing_old_materials(self):
        value = state()
        value['materials'][0] = {'id': 'custom-tile', 'name': '外墙漆', 'color': '#eeeeee', 'texture': 'plain', 'kind': 'paint', 'pricePerM2': 35}
        saved = self.client.post(self.url, json={'name': '漆面测试', 'state': value})
        self.assertEqual(saved.status_code, 201, saved.text)
        self.assertEqual(self.client.get(f"{self.url}/{saved.json()['id']}").json()['state'], value)
        style = self.client.post('/api/renovation3d/tile-styles', json={'name': '漆面样式', 'material': value['materials'][0], 'finish': value['finishes']['f1-front']})
        self.assertEqual(style.status_code, 201, style.text)
        self.assertEqual(style.json()['material']['kind'], 'paint')
        self.assertEqual(self.save()['state']['materials'], state()['materials'])

    def test_textured_paint_is_rejected_without_saving_a_plan(self):
        value = state(); value['materials'][0]['kind'] = 'paint'
        self.assertEqual(self.client.post(self.url, json={'name': '错误漆面', 'state': value}).status_code, 422)
        self.assertEqual(self.client.get(self.url).json(), [])

    def test_invalid_building_types_material_references_and_extra_fields_are_rejected(self):
        invalid = []
        for change in [lambda s: s.update(buildingId='window-project'), lambda s: s.update(exploded='true'), lambda s: s.update(schemaVersion=True),
                       lambda s: s['materials'][0].update(pricePerM2=-1), lambda s: s['finishes']['f1-front'].update(widthMm=0),
                       lambda s: s['finishes']['f1-front'].update(materialId='missing'), lambda s: s.update(projects=[]),
                       lambda s: s['faceRegionFinishes']['f1-front:face:-60'].update(materialId='missing'),
                       lambda s: s['windowFinishes']['f1-s-window'].update(glassType='unknown'), lambda s: s.update(hiddenFloors=['f1', 'f1'])]:
            value = copy.deepcopy(state()); change(value); invalid.append(value)
        for value in invalid:
            result = self.client.post(self.url, json={'name': '无效方案', 'state': value})
            self.assertEqual(result.status_code, 422, result.text)
        self.assertEqual(self.client.post(self.url, json={'name': '  ', 'state': state()}).status_code, 422)
        self.assertEqual(self.client.get(self.url).json(), [])

    def test_oversized_payload_is_rejected_without_creating_a_snapshot(self):
        with patch('backend.renovation.MAX_BYTES', 50):
            self.assertEqual(self.client.post(self.url, json={'name': '过大方案', 'state': state()}).status_code, 413)
        self.assertEqual(self.client.get(self.url).json(), [])

    def test_missing_snapshot_and_invalid_rename_leave_existing_state_unchanged(self):
        saved = self.save()
        self.assertEqual(self.client.get(f'{self.url}/missing').status_code, 404)
        self.assertEqual(self.client.patch(f'{self.url}/missing', json={'name': '名称'}).status_code, 404)
        self.assertEqual(self.client.patch(f"{self.url}/{saved['id']}", json={'name': '', 'state': {}}).status_code, 422)
        self.assertEqual(self.client.get(f"{self.url}/{saved['id']}").json(), saved)
        self.assertEqual(self.client.delete(f"{self.url}/{saved['id']}").status_code, 405)

    def test_tile_styles_preserve_complete_material_and_finish_independently_of_plans(self):
        saved = self.save(); original = state()
        body = {'name': '  我的瓷砖 45×95mm  ', 'material': original['materials'][0],
                'finish': {**original['finishes']['f1-front'], 'widthMm': 45, 'heightMm': 95}}
        url = '/api/renovation3d/tile-styles'
        result = self.client.post(url, json=body)
        self.assertEqual(result.status_code, 201, result.text)
        first = result.json()
        self.assertEqual(first['name'], body['name'].strip())
        self.assertEqual(first['material'], body['material'])
        self.assertEqual(first['finish'], body['finish'])
        second = self.client.post(url, json=body).json()
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(self.client.get(url).json(), [first])
        renamed = self.client.patch(f"{url}/{first['id']}", json={'name': '45×95灰砖'}).json()
        self.assertEqual(renamed['name'], '45×95灰砖')
        for field in ('id', 'createdAt', 'material', 'finish'):
            self.assertEqual(renamed[field], first[field])
        self.assertEqual(self.client.get(f"{self.url}/{saved['id']}").json(), saved)
        self.assertEqual(self.client.patch(f"{url}/{saved['id']}", json={'name': '串用'}).status_code, 404)
        self.assertEqual(self.client.get(f"{self.url}/{first['id']}").status_code, 404)

    def test_invalid_styles_and_renames_never_replace_saved_content(self):
        sample = state()
        body = {'name': '完整样式', 'material': sample['materials'][0], 'finish': sample['finishes']['f1-front']}
        url = '/api/renovation3d/tile-styles'
        saved = self.client.post(url, json=body).json()
        for change in [lambda b: b.update(name='  '), lambda b: b['finish'].update(materialId='missing'),
                       lambda b: b['finish'].update(widthMm=19), lambda b: b['finish'].update(groutMm=21),
                       lambda b: b['material'].update(pricePerM2=-1), lambda b: b['material'].update(image='not an image'),
                       lambda b: b['material'].update(color='red'), lambda b: b.update(state=sample)]:
            invalid = copy.deepcopy(body); change(invalid)
            self.assertEqual(self.client.post(url, json=invalid).status_code, 422)
        with patch('backend.renovation.MAX_BYTES', 50):
            self.assertEqual(self.client.post(url, json=body).status_code, 413)
        self.assertEqual(self.client.patch(f"{url}/{saved['id']}", json={'name': '改名', 'material': body['material']}).status_code, 422)
        self.assertEqual(self.client.patch(f'{url}/missing', json={'name': '不存在'}).status_code, 404)
        self.assertEqual(self.client.get(url).json(), [saved])
        self.assertEqual(self.client.get(self.url).json(), [])

    def test_optional_background_is_backward_compatible_and_validated(self):
        saved = self.save()
        self.assertNotIn('background', saved['state'])
        for background in ('studio', 'sunny'):
            value = state(); value['background'] = background
            result = self.client.post(self.url, json={'name': background, 'state': value})
            self.assertEqual(result.status_code, 201, result.text)
            self.assertEqual(result.json()['state'], value)
        value = state(); value['background'] = 'unknown'
        self.assertEqual(self.client.post(self.url, json={'name': '无效背景', 'state': value}).status_code, 422)
        self.assertEqual(self.client.get(f"{self.url}/{saved['id']}").json(), saved)

    def test_face_grouping_revision_round_trips_without_changing_old_snapshots(self):
        old = self.save()
        value = state(); value['faceGroupingVersion'] = 2
        result = self.client.post(self.url, json={'name': '独立内墙', 'state': value})
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual(result.json()['state'], value)
        self.assertEqual(self.client.get(f"{self.url}/{old['id']}").json(), old)
        value['faceGroupingVersion'] = 3
        self.assertEqual(self.client.post(self.url, json={'name': '独立连通块面', 'state': value}).status_code, 201)
        value['faceGroupingVersion'] = 12
        self.assertEqual(self.client.post(self.url, json={'name': '无效分组', 'state': value}).status_code, 422)

    def test_revision8_uniform_face_round_trip_keeps_old_snapshot(self):
        old = self.save()
        value = state(); value['faceGroupingVersion'] = 8
        value['faceFinishes'] = {'f4-right:face:0': dict(value['finishes']['f1-front'])}
        value['faceRegionFinishes'] = {}
        result = self.client.post(self.url, json={'name': '同层共面单一铺贴', 'state': value})
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual(self.client.get(f"{self.url}/{result.json()['id']}").json()['state'], value)
        self.assertEqual(self.client.get(f"{self.url}/{old['id']}").json(), old)

    def test_revision9_uniform_face_round_trip_keeps_old_snapshot(self):
        old = self.save()
        value = state(); value['faceGroupingVersion'] = 9
        value['faceFinishes'] = {'f4-right:face:0': dict(value['finishes']['f1-front'])}
        value['faceRegionFinishes'] = {}
        result = self.client.post(self.url, json={'name': '同层共面单一铺贴', 'state': value})
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual(self.client.get(f"{self.url}/{result.json()['id']}").json()['state'], value)
        self.assertEqual(self.client.get(f"{self.url}/{old['id']}").json(), old)

    def test_revision7_preserves_legacy_member_finishes_and_previous_snapshots(self):
        old = self.save()
        value = state(); value['faceGroupingVersion'] = 7
        key = 'f1-right:face:0:junction:0:3620:legacy:0'
        value['faceRegionFinishes'][key] = dict(value['finishes']['f1-front'])
        result = self.client.post(self.url, json={'name': '楼板条合并', 'state': value})
        self.assertEqual(result.status_code, 201, result.text)
        saved = result.json()
        self.assertEqual(self.client.get(f"{self.url}/{saved['id']}").json()['state'], value)
        self.assertEqual(self.client.get(f"{self.url}/{old['id']}").json(), old)

    def test_terrace_visibility_round_trip_without_changing_existing_plan(self):
        old = self.save()
        value = state(); value['faceGroupingVersion'] = 5; value['hiddenGroups'] = ['terrace']
        result = self.client.post(self.url, json={'name': '露台独立隐藏', 'state': value})
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual(self.client.get(f"{self.url}/{result.json()['id']}").json()['state'], value)
        self.assertEqual(self.client.get(f"{self.url}/{old['id']}").json(), old)
        for groups in [['unknown'], ['f4'], ['terrace', 'terrace'], 'terrace']:
            value['hiddenGroups'] = groups
            self.assertEqual(self.client.post(self.url, json={'name': '无效显示组', 'state': value}).status_code, 422)

    def test_revision_six_finish_map_round_trip_keeps_previous_snapshot(self):
        old = self.save()
        value = state(); value['faceGroupingVersion'] = 6; value['hiddenGroups'] = ['terrace']
        result = self.client.post(self.url, json={'name': '完整交口分面', 'state': value})
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual(self.client.get(f"{self.url}/{result.json()['id']}").json()['state'], value)
        self.assertEqual(self.client.get(f"{self.url}/{old['id']}").json(), old)

    def test_junction_revision_and_screen_colour_round_trip_without_rewriting_existing_plan(self):
        old = self.save()
        value = state(); value['faceGroupingVersion'] = 4
        value['partColors'] = {'f1-entry-screen': '#aabbcc'}
        result = self.client.post(self.url, json={'name': '交口与格栅验收', 'state': value})
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual(self.client.get(f"{self.url}/{result.json()['id']}").json()['state'], value)
        self.assertEqual(self.client.get(f"{self.url}/{old['id']}").json(), old)
        for invalid in ['red', '#11223344', '#123', 'url(secret)']:
            value['partColors']['f1-entry-screen'] = invalid
            self.assertEqual(self.client.post(self.url, json={'name': '无效颜色', 'state': value}).status_code, 422)


if __name__ == '__main__':
    unittest.main()
