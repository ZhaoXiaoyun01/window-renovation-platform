import copy
from io import BytesIO
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from backend.renovation import router


def payload():
    return {'name': '当前方案', 'generatedAt': '2026/10/22 12:00:00', 'materials': [
        {'id': 'tile', 'name': '米白细石', 'kind': 'tile', 'texture': 'stone', 'pricePerM2': 120},
        {'id': 'paint', 'name': '外墙漆', 'kind': 'paint', 'texture': 'plain', 'pricePerM2': 35}], 'rows': [
        {'regionId': 'f1', 'materialId': 'tile', 'widthMm': 600, 'heightMm': 1200, 'tiles': 2, 'areaMm2': 1200000},
        {'regionId': 'f1', 'materialId': 'paint', 'widthMm': 0, 'heightMm': 0, 'tiles': 0, 'areaMm2': 3500000},
        {'regionId': 'f2', 'materialId': 'tile', 'widthMm': 1200, 'heightMm': 600, 'tiles': 1, 'areaMm2': 500000}]}


class RenovationReportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'WINDOW_DATA_DIR': self.temp.name})
        self.env.start()
        self.paths = [Path(self.temp.name) / name for name in ('windows.sqlite3', 'renovation3d.sqlite3')]
        for path in self.paths:
            path.write_bytes(b'Export must not open or change this database')
        app = FastAPI(); app.include_router(router)
        self.client = TestClient(app)
        self.url = '/api/renovation3d/material-report/export'

    def tearDown(self):
        for path in self.paths:
            self.assertEqual(path.read_bytes(), b'Export must not open or change this database')
        self.client.close(); self.env.stop(); self.temp.cleanup()

    def test_download_is_real_two_sheet_excel_with_independent_purchase_and_paint_calculations(self):
        data = payload(); original = copy.deepcopy(data)
        response = self.client.post(self.url, json=data)
        self.assertEqual(response.status_code, 200, response.text[:100] if response.status_code != 200 else '')
        self.assertIn('spreadsheetml.sheet', response.headers['content-type'])
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertTrue(response.content.startswith(b'PK'))
        book = load_workbook(BytesIO(response.content), data_only=True)
        self.assertEqual(book.sheetnames, ['分层明细', '整楼汇总'])
        floors, summary = book.worksheets
        for sheet in book:
            self.assertEqual(sheet.freeze_panes, 'E7')
            self.assertEqual(sheet.max_column, 10)
            self.assertIn('当前方案', sheet['A2'].value)
            self.assertIn('2026/10/22', sheet['A2'].value)
            self.assertEqual(sheet['E7'].data_type, 'n')
            self.assertEqual(sheet['I7'].number_format, '#,##0.00')
            self.assertEqual(sheet.page_setup.orientation, 'landscape')
        rows = [list(row) for row in summary.iter_rows(min_row=7, values_only=True)]
        tile = next(row for row in rows if row[1] == '米白细石')
        paint = next(row for row in rows if row[1] == '外墙漆')
        self.assertEqual(tile[4:], [1.7, 3, 4, 2.88, 120, 345.6])
        self.assertEqual(paint[4:], [3.5, '—', '—', 3.5, 35, 122.5])
        self.assertEqual(summary.cell(summary.max_row, 10).value, 468.1)
        self.assertEqual(floors.cell(floors.max_row, 10).value, 554.5)
        self.assertEqual(summary.cell(summary.max_row, 7).value, 4)
        self.assertEqual(floors.cell(floors.max_row, 7).value, 5)
        self.assertEqual(data, original)

    def test_user_names_are_literal_text_and_workbook_is_a_snapshot(self):
        data = payload(); data['name'] = '=1+1'; data['materials'][0]['name'] = '=HYPERLINK("https://example.invalid","test")'
        response = self.client.post(self.url, json=data)
        book = load_workbook(BytesIO(response.content), data_only=False)
        cells = [cell for sheet in book for row in sheet for cell in row if cell.value == data['materials'][0]['name']]
        self.assertTrue(cells)
        self.assertTrue(all(cell.data_type == 's' for cell in cells))
        self.assertFalse(any(cell.data_type == 'f' for sheet in book for row in sheet for cell in row))

    def test_fractional_unit_price_rounds_half_up_to_the_same_cent_as_preview(self):
        data = payload()
        data['materials'] = [data['materials'][1]]
        data['materials'][0]['pricePerM2'] = 1.005
        data['rows'] = [data['rows'][1]]
        data['rows'][0]['areaMm2'] = 1000000
        response = self.client.post(self.url, json=data)
        self.assertEqual(response.status_code, 200)
        book = load_workbook(BytesIO(response.content), data_only=True)
        self.assertEqual(book['整楼汇总']['J7'].value, 1.01)
        data['materials'][0]['pricePerM2'] = 10.075
        response = self.client.post(self.url, json=data)
        self.assertEqual(load_workbook(BytesIO(response.content))['整楼汇总']['J7'].value, 10.08)

    def test_long_chinese_material_names_and_metadata_expand_rows_without_truncation(self):
        data = payload(); data['name'] = '方案' * 40; data['materials'][0]['name'] = '材料' * 40
        response = self.client.post(self.url, json=data)
        self.assertEqual(response.status_code, 200)
        book = load_workbook(BytesIO(response.content), data_only=True)
        for sheet in book:
            self.assertIn(data['name'], sheet['A2'].value)
            self.assertGreater(sheet.row_dimensions[2].height, 29)
            cells = [cell for row in sheet for cell in row if cell.value == data['materials'][0]['name']]
            self.assertTrue(cells)
            self.assertTrue(all(sheet.row_dimensions[cell.row].height >= 90 for cell in cells))

    def test_invalid_or_duplicate_rows_and_paint_tile_counts_reject_without_writes(self):
        variants = []
        for field, value in [('regionId', 'unknown'), ('materialId', 'unknown'), ('tiles', -1), ('tiles', True), ('areaMm2', 0), ('widthMm', 10)]:
            data = payload(); data['rows'][0][field] = value; variants.append(data)
        data = payload(); data['rows'].append(copy.deepcopy(data['rows'][0])); variants.append(data)
        data = payload(); data['rows'][1]['tiles'] = 1; variants.append(data)
        data = payload(); data['materials'][0]['pricePerM2'] = -1; variants.append(data)
        data = payload(); data['name'] = ' '; variants.append(data)
        for data in variants:
            with self.subTest(data=data):
                self.assertEqual(self.client.post(self.url, json=data).status_code, 422)
