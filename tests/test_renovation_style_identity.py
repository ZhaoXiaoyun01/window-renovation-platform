from concurrent.futures import ThreadPoolExecutor
import copy
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.renovation import router


def sample():
    return {'name': '深灰 · 修改1', 'material': {'id': 'basalt', 'name': '深灰', 'color': '#494e50', 'texture': 'stone', 'pricePerM2': 180},
            'finish': {'materialId': 'basalt', 'widthMm': 45, 'heightMm': 145, 'direction': 'horizontal', 'groutMm': 3, 'groutColor': '#777b77', 'alignment': 'edge', 'preserveZoning': False}}


class StyleIdentityTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.env = patch.dict(os.environ, {'WINDOW_DATA_DIR': self.temp.name}); self.env.start()
        self.app = FastAPI(); self.app.include_router(router); self.client = TestClient(self.app); self.url = '/api/renovation3d/tile-styles'

    def tearDown(self):
        self.client.close(); self.env.stop(); self.temp.cleanup()

    def test_same_contents_reuse_original_despite_name_ids_case_and_numeric_representation(self):
        data = sample(); first = self.client.post(self.url, json=data).json()
        duplicate = copy.deepcopy(data); duplicate['name'] = '重复名称'; duplicate['material'].update(id='new-id', name='显示名不同', color='#494E50', pricePerM2=180.0); duplicate['finish'].update(materialId='new-id', widthMm=45.0)
        second = self.client.post(self.url, json=duplicate).json()
        self.assertEqual(second, first); self.assertEqual(self.client.get(self.url).json(), [first])

    def test_real_price_grout_and_size_changes_stay_separate(self):
        original = sample(); ids = [self.client.post(self.url, json=original).json()['id']]
        for field, value in [('price', 23), ('grout', '#bbb9b4'), ('width', 95)]:
            data = copy.deepcopy(original)
            if field == 'price': data['material']['pricePerM2'] = value
            elif field == 'grout': data['finish']['groutColor'] = value
            else: data['finish']['widthMm'] = value
            ids.append(self.client.post(self.url, json=data).json()['id'])
        self.assertEqual(len(set(ids)), 4)

    def test_concurrent_duplicate_saves_are_atomic(self):
        def save(index):
            with TestClient(self.app) as client:
                data = sample(); data['name'] = f'同时保存{index}'
                response = client.post(self.url, json=data); self.assertEqual(response.status_code, 201)
                return response.json()['id']
        with ThreadPoolExecutor(max_workers=4) as pool: ids = list(pool.map(save, range(8)))
        self.assertEqual(len(set(ids)), 1); self.assertEqual(len(self.client.get(self.url).json()), 1)
