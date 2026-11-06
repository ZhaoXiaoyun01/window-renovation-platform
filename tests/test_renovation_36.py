import os,io,tempfile,unittest
from copy import deepcopy
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from backend.renovation import router
from test_renovation import state

class Renovation36Test(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'WINDOW_DATA_DIR':self.temp.name});self.env.start();app=FastAPI();app.include_router(router);self.client=TestClient(app)
 def tearDown(self):self.client.close();self.env.stop();self.temp.cleanup()
 def test_quote_append_21_preserves_snapshot_and_all_exported_records(self):
  s=state();q={'id':'q0','status':'merchant','source':'QA0','date':'2026-10-25','checked':False,'configuration':{'openingId':'f1-s-window','widthMm':2800,'heightMm':2400,'frameColor':'#445566','glassType':'medium','mode':'开启扇','sashCount':2,'pricePerM2':650,'sashPrice':700}}
  old=[dict(deepcopy(q),id=f'q{i}',source=f'QA{i}') for i in range(20)];s['windowFinishes']['f1-s-window']['quotes']=old
  first=self.client.post('/api/renovation3d/plans',json={'name':'20条旧方案','state':s}).json()
  s['windowFinishes']['f1-s-window']['quotes']=[*old,dict(deepcopy(q),id='q20',source='QA20')]
  response=self.client.post('/api/renovation3d/plans',json={'name':'21条新方案','state':s});self.assertEqual(response.status_code,201,response.text);self.assertEqual(len(response.json()['state']['windowFinishes']['f1-s-window']['quotes']),21)
  self.assertEqual(self.client.get('/api/renovation3d/plans/'+first['id']).json(),first)
  payload={'name':'报价追加','generatedAt':'2026-10-25','rows':[{'id':'f1-s-window','floorId':'f1','name':'测试窗','widthMm':2800,'heightMm':2400,'frameColor':'#445566','glassType':'medium','mode':'开启扇','sashCount':2,'pricePerM2':650,'sashPrice':700,'quotes':s['windowFinishes']['f1-s-window']['quotes']}]}
  response=self.client.post('/api/renovation3d/window-report/export',json=payload);self.assertEqual(response.status_code,200,response.text);book=load_workbook(io.BytesIO(response.content));self.assertEqual(book['报价记录'].max_row,22);self.assertEqual(book['报价记录']['D22'].value,'QA20')
 def test_modern_material_codes_color_box_totals_and_rounding_with_legacy_compatibility(self):
  metadata={'applicationVersion':'3.6','schemaVersion':1,'faceGroupingVersion':11,'basePlanId':'','source':'QA模型','measurementBasis':'按范围分别进位','dimensionNote':'待核实','snapshotType':'编辑草稿'}
  catalog={'code':'M01','materialId':'m','name':'米白','kind':'tile','color':'#aabbcc','widthMm':600,'heightMm':1200,'direction':'horizontal','alignment':'edge','groutMm':3,'groutColor':'#bbbbbb'}
  payload={'name':'实际采购','generatedAt':'2026-10-25','metadata':metadata,'catalog':[catalog],'materials':[{'id':'m','name':'米白','kind':'tile','texture':'plain','pricePerM2':120,'purchaseRule':{'reservePercent':12.5,'piecesPerBox':8,'fullBoxes':True}}],'rows':[{'regionId':f,'materialId':'m','widthMm':600,'heightMm':1200,'tiles':100,'areaMm2':50000000,'codes':['M01']} for f in ['f1','f2']]}
  response=self.client.post('/api/renovation3d/material-report/export',json=payload);self.assertEqual(response.status_code,200,response.text);book=load_workbook(io.BytesIO(response.content),data_only=True)
  sheet=book['分层明细'];self.assertEqual(sheet['K7'].value,'M01');self.assertEqual(sheet['L7'].value,'#AABBCC');self.assertEqual(sheet['M7'].value,15);self.assertEqual(sheet['G7'].value,120);self.assertEqual(sheet['J7'].value,10368);self.assertEqual(sheet.cell(sheet.max_row,13).value,30)
  sheet=book['整楼汇总'];self.assertEqual(sheet['G7'].value,232);self.assertEqual(sheet['M7'].value,29);self.assertEqual(sheet['J7'].value,20044.8);self.assertIn('113片',book['采购计算过程']['D2'].value);self.assertIn('15箱',book['采购计算过程']['D2'].value)
  payload.pop('metadata');payload.pop('catalog');[r.pop('codes') for r in payload['rows']];response=self.client.post('/api/renovation3d/material-report/export',json=payload);self.assertEqual(response.status_code,200,response.text);self.assertEqual(load_workbook(io.BytesIO(response.content)).worksheets[0].max_column,10)
