import copy
from io import BytesIO
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from backend.renovation import router, PlanState


def payload():
    return {'name': '窗户方案', 'generatedAt': '2026/10/22 16:00:00', 'rows': [
        {'id': 'f1-s-window', 'floorId': 'f1', 'name': '南面窗', 'widthMm': 2800, 'heightMm': 2400,
         'frameColor': '#333d3f', 'mode': '平开', 'sashCount': 2, 'pricePerM2': 500, 'sashPrice': 100},
        {'id': 'f2-s-window', 'floorId': 'f2', 'name': '待报价窗', 'widthMm': 1000, 'heightMm': 1000,
         'frameColor': '#ffffff', 'mode': '固定', 'sashCount': 0}]}


class RenovationWindowsTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI(); app.include_router(router); self.client = TestClient(app)
        self.url = '/api/renovation3d/window-report/export'

    def tearDown(self):
        self.client.close()

    def test_independent_workbook_uses_sash_item_price_and_leaves_missing_prices_unknown(self):
        from unittest.mock import patch
        data = payload(); original = copy.deepcopy(data)
        with patch('backend.renovation.connect', side_effect=AssertionError('export must not open database')):
            response = self.client.post(self.url, json=data)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        book = load_workbook(BytesIO(response.content), data_only=True)
        self.assertEqual(book.sheetnames, ['窗户统计'])
        sheet = book.active
        self.assertEqual(sheet['E7'].value, 6.72); self.assertEqual(sheet['I7'].value, 2)
        self.assertEqual(sheet['O7'].value, 3560); self.assertEqual(sheet['O8'].value, '待报价')
        self.assertEqual(sheet['O9'].value, 3560); self.assertEqual(sheet['K9'].value, '1樘待报价')
        self.assertEqual(sheet['E9'].value, 7.72); self.assertEqual(sheet.freeze_panes, 'C7')
        self.assertEqual(sheet.auto_filter.ref, 'A6:O8'); self.assertEqual(sheet['O7'].data_type, 'n')
        self.assertEqual(data, original)

    def test_zero_sashes_need_no_sash_quote_and_fractional_price_rounds_to_cents(self):
        data = payload(); data['rows'] = [data['rows'][1]]; data['rows'][0]['pricePerM2'] = 1.005
        response = self.client.post(self.url, json=data)
        self.assertEqual(load_workbook(BytesIO(response.content)).active['O7'].value, 1.01)
        data['rows'][0].update(widthMm=1550, heightMm=1300, pricePerM2=5)
        response = self.client.post(self.url, json=data)
        self.assertEqual(load_workbook(BytesIO(response.content)).active['O7'].value, 10.08)

    def test_invalid_counts_prices_duplicate_ids_and_empty_names_are_rejected(self):
        variants = []
        for field, value in [('sashCount', 1.5), ('sashCount', True), ('pricePerM2', -1), ('frameColor', 'red'), ('floorId', 'base'), ('widthMm', 0), ('name', ' ')]:
            data = payload(); data['rows'][0][field] = value; variants.append(data)
        data = payload(); data['rows'].append(data['rows'][0].copy()); variants.append(data)
        for data in variants:
            self.assertEqual(self.client.post(self.url, json=data).status_code, 422)

    def test_names_are_literal_text_and_long_names_wrap(self):
        data = payload(); data['name'] = '=1+1'; data['rows'][0]['name'] = '材料' * 40
        data['rows'][1]['name'] = '=HYPERLINK("x","y")'
        response = self.client.post(self.url, json=data); sheet = load_workbook(BytesIO(response.content)).active
        self.assertIn('=1+1', sheet['A2'].value); self.assertGreaterEqual(sheet.row_dimensions[7].height, 90)
        self.assertEqual(sheet['B8'].data_type, 's')

    def test_plan_contract_accepts_base_sunlight_window_pricing_and_rejects_invalid_values(self):
        from pydantic import ValidationError
        state = {'schemaVersion': 1, 'buildingId': 'pdf-residence-1', 'materials': [
            {'id': 'a', 'name': '材料', 'color': '#ffffff', 'texture': 'plain'}], 'finishes': {
                'f1-front': {'materialId': 'a', 'widthMm': 600, 'heightMm': 1200, 'direction': 'horizontal', 'groutMm': 3, 'groutColor': '#ffffff', 'alignment': 'edge'}},
            'hiddenFloors': [], 'hiddenGroups': ['base'], 'exploded': False, 'faceGroupingVersion': 10, 'sunHour': 8.25,
            'windowFinishes': {'f1-s-window': {'frameColor': '#ffffff', 'glassType': 'medium', 'name': '定制窗', 'pricePerM2': 500, 'sashCount': 2, 'sashPrice': 100}}}
        saved = PlanState.model_validate(state).model_dump(exclude_none=True)
        self.assertEqual(saved['windowFinishes'], state['windowFinishes'])
        for patch in ({'sunHour': 19}, {'hiddenGroups': ['base', 'base']}):
            with self.assertRaises(ValidationError): PlanState.model_validate({**state, **patch})
