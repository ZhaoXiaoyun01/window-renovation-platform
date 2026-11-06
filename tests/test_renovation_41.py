import copy
import io
import os
import tempfile
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from backend.renovation import router
from test_renovation import state


class Renovation41Test(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'WINDOW_DATA_DIR': self.temp.name}); self.env.start()
        app = FastAPI(); app.include_router(router); self.client = TestClient(app)

    def tearDown(self):
        self.client.close(); self.env.stop(); self.temp.cleanup()

    def row(self):
        return dict(id='f1-s-window', floorId='f1', name='测试窗', widthMm=2800, heightMm=1500,
                    frameColor='#445566', glassType='medium', mode='开启扇', sashCount=2, pricePerM2=500, sashPrice=100)

    def test_all_upgrade_specs_decimal_amounts_totals_and_filter_columns(self):
        for spec, price in [('5', 28), ('6', 55), ('8', 203), ('10', 350), ('6', 55.125), ('5', 0)]:
            row = self.row(); row['glassUpgrade'] = dict(spec=spec, pricePerM2=price)
            response = self.client.post('/api/renovation3d/window-report/export', json=dict(name='升级测试', generatedAt='2026-11-05', rows=[row]))
            self.assertEqual(response.status_code, 200, response.text)
            sheet = load_workbook(io.BytesIO(response.content), data_only=True).active
            from decimal import Decimal, ROUND_HALF_UP
            amount = (Decimal('4.2')*(500+Decimal(str(price)))+200).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
            self.assertEqual(sheet['L7'].value, f'{spec}+(6-27)A+{spec}离线LOWE')
            self.assertEqual(sheet['M7'].value, price); self.assertEqual(sheet['O7'].value, float(amount))
            self.assertEqual(sheet['O8'].value, float(amount)); self.assertEqual(sheet.auto_filter.ref, 'A6:O7')
            self.assertEqual(sheet.max_column, 15)

    def test_saved_old_and_new_snapshots_restore_independently_and_retain_legacy_quotes(self):
        old = state(); original = self.client.post('/api/renovation3d/plans', json=dict(name='旧方案', state=old)).json()
        new = copy.deepcopy(old); new['windowFinishes']['f1-s-window']['glassUpgrade'] = dict(spec='8', pricePerM2=199.5)
        saved = self.client.post('/api/renovation3d/plans', json=dict(name='升级方案', state=new))
        self.assertEqual(saved.status_code, 201, saved.text)
        restored = self.client.get('/api/renovation3d/plans/'+saved.json()['id']).json()
        self.assertEqual(restored['state'], new)
        self.assertEqual(self.client.get('/api/renovation3d/plans/'+original['id']).json()['state'], old)

    def test_upgrade_binds_quote_evidence_and_historical_records_export_without_upgrade(self):
        row = self.row(); config = {k:v for k,v in row.items() if k not in ('id','floorId','name')}; config['openingId'] = row['id']
        quote = dict(id='legacy',status='merchant',source='旧报价',date='2026-10-26',checked=False,configuration=config)
        row.update(glassUpgrade=dict(spec='6',pricePerM2=55),quotes=[quote])
        metadata = dict(applicationVersion='4.1',schemaVersion=1,faceGroupingVersion=11,basePlanId='',source='QA模型',measurementBasis='窗户总面积',dimensionNote='待核实',snapshotType='测试快照')
        payload = dict(name='报价证据',generatedAt='2026-11-05',metadata=metadata,rows=[row])
        response = self.client.post('/api/renovation3d/window-report/export',json=payload)
        self.assertEqual(response.status_code,200,response.text)
        book = load_workbook(io.BytesIO(response.content),data_only=True)
        self.assertIn('待重核',book['窗户配置与依据']['G2'].value)
        self.assertEqual(book['报价记录']['O2'].value,'无升级')
        quote['configuration']['glassUpgrade'] = copy.deepcopy(row['glassUpgrade'])
        response = self.client.post('/api/renovation3d/window-report/export',json=payload)
        book = load_workbook(io.BytesIO(response.content),data_only=True)
        self.assertEqual(book['窗户配置与依据']['J2'].value,'一致')
        self.assertEqual(book['报价记录']['P2'].value,55)
        self.assertEqual(book['交付说明']['B3'].value,'4.1')

    def test_invalid_upgrade_contracts_reject_without_accepting_hidden_price_errors(self):
        for upgrade in [dict(spec='7',pricePerM2=28),dict(spec='5',pricePerM2=-1),dict(spec='5',pricePerM2=True),dict(spec='5',pricePerM2=1000001)]:
            row = self.row(); row['glassUpgrade'] = upgrade
            response = self.client.post('/api/renovation3d/window-report/export',json=dict(name='非法',generatedAt='2026-11-05',rows=[row]))
            self.assertEqual(response.status_code,422)
            s = state(); s['windowFinishes']['f1-s-window']['glassUpgrade'] = upgrade
            self.assertEqual(self.client.post('/api/renovation3d/plans',json=dict(name='非法',state=s)).status_code,422)
