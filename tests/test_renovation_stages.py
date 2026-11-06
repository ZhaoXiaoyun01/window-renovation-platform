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

class RenovationStagesTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'WINDOW_DATA_DIR':self.temp.name});self.env.start()
        app=FastAPI();app.include_router(router);self.client=TestClient(app)
    def tearDown(self):
        self.client.close();self.env.stop();self.temp.cleanup()
    def test_purchase_rule_snapshot_and_independent_decimal_workbook(self):
        s=state();s['purchaseRules']={'custom-tile':{'reservePercent':5,'piecesPerBox':8,'fullBoxes':True}}
        s['modelReviews']={'item':{'status':'pending','note':'节点未核实','evidence':'current','reviewedAt':'2026-10-23T00:00:00Z'}}
        reply=self.client.post('/api/renovation3d/plans',json={'name':'规则方案','state':s});self.assertEqual(reply.status_code,201,reply.text);self.assertEqual(reply.json()['state'],s)
        rule=s['purchaseRules']['custom-tile']
        payload={'name':'整箱测试','generatedAt':'2026-10-23','materials':[{'id':'m','name':'=原样文字','kind':'tile','texture':'stone','pricePerM2':120,'purchaseRule':rule}], 'rows':[{'regionId':'f1','materialId':'m','widthMm':600,'heightMm':1200,'tiles':100,'areaMm2':50000000}]}
        result=self.client.post('/api/renovation3d/material-report/export',json=payload);self.assertEqual(result.status_code,200,result.text)
        w=load_workbook(io.BytesIO(result.content),data_only=True);self.assertEqual(w.worksheets[0]['G7'].value,112);self.assertEqual(w.worksheets[0]['H7'].value,80.64);self.assertEqual(w.worksheets[0]['J7'].value,9676.8);self.assertIn('采购规则',w.sheetnames);self.assertEqual(w['采购规则']['A2'].data_type,'s')
        payload['materials'][0]['purchaseRule']['reservePercent']=5.001;self.assertEqual(self.client.post('/api/renovation3d/material-report/export',json=payload).status_code,422)
        s['purchaseRules']={'unknown':rule};self.assertEqual(self.client.post('/api/renovation3d/plans',json={'name':'bad','state':s}).status_code,422)
    def test_quote_record_snapshot_confirmation_and_export_text_safety(self):
        q={'id':'q1','status':'confirmed','source':'=商家报价原文','date':'2026-10-23','checked':True,'configuration':{'openingId':'f1-s-window','widthMm':2800,'heightMm':2400,'frameColor':'#445566','glassType':'medium','mode':'开启扇','sashCount':2,'pricePerM2':650,'sashPrice':700}}
        s=state();s['windowFinishes']['f1-s-window'].update(quotes=[q],pricePerM2=650,sashPrice=700,sashCount=2)
        result=self.client.post('/api/renovation3d/plans',json={'name':'报价','state':s});self.assertEqual(result.status_code,201,result.text);self.assertEqual(result.json()['state'],s)
        row={k:v for k,v in q['configuration'].items() if k!='openingId'};row.update(id='f1-s-window',floorId='f1',name='南窗',quotes=[q])
        payload={'name':'报价','generatedAt':'2026-10-23','rows':[row]};result=self.client.post('/api/renovation3d/window-report/export',json=payload);self.assertEqual(result.status_code,200,result.text)
        w=load_workbook(io.BytesIO(result.content),data_only=True);self.assertEqual(w.active['O7'].value,5768);self.assertEqual(w['报价记录']['D2'].value,'=商家报价原文');self.assertEqual(w['报价记录']['D2'].data_type,'s')
        q['checked']=False;self.assertEqual(self.client.post('/api/renovation3d/plans',json={'name':'bad','state':s}).status_code,422)

    def test_delivery_metadata_catalog_and_dimension_provenance(self):
        metadata={'applicationVersion':'3.5','schemaVersion':1,'faceGroupingVersion':11,'basePlanId':'saved-id','source':'业主图纸','measurementBasis':'扣洞口/不复用余料/先预留后整箱','dimensionNote':'尺寸待现场核实','snapshotType':'当前编辑快照'}
        catalog={'code':'M01','materialId':'m','name':'米白','color':'#112233','kind':'tile','widthMm':600,'heightMm':1200,'direction':'horizontal','alignment':'edge','groutMm':3,'groutColor':'#bbb9b4'}
        payload={'name':'交付资料','generatedAt':'2026-10-23 12:00:00','metadata':metadata,'catalog':[catalog],'materials':[{'id':'m','name':'米白','kind':'tile','texture':'stone','pricePerM2':120}], 'rows':[{'regionId':'f1','materialId':'m','widthMm':600,'heightMm':1200,'tiles':100,'areaMm2':50000000}]}
        result=self.client.post('/api/renovation3d/material-report/export',json=payload);self.assertEqual(result.status_code,200,result.text);w=load_workbook(io.BytesIO(result.content),data_only=True)
        self.assertEqual(w['交付说明']['B3'].value,'3.5');self.assertEqual(w['材料编号']['A2'].value,'M01');self.assertEqual(w.worksheets[0]['G7'].value,105);self.assertIn('采购规则',w.sheetnames)
        payload['catalog'][0]['widthMm']=900;self.assertEqual(self.client.post('/api/renovation3d/material-report/export',json=payload).status_code,422)
        row={'id':'f1-s-window','floorId':'f1','name':'南窗','widthMm':2800,'heightMm':2400,'frameColor':'#112233','glassType':'medium','mode':'开启扇','sashCount':1,'pricePerM2':500,'sashPrice':500,'code':'W01','dimensionStatus':'模型值 · 待核实','dimensionNote':'图纸定位待复核'}
        result=self.client.post('/api/renovation3d/window-report/export',json={'name':'窗户交付','generatedAt':'2026-10-23','metadata':metadata,'rows':[row]});self.assertEqual(result.status_code,200,result.text);w=load_workbook(io.BytesIO(result.content),data_only=True)
        self.assertEqual(w.active['O7'].value,3860);self.assertEqual(w['窗户配置与依据']['A2'].value,'W01');self.assertIn('待核实',w['窗户配置与依据']['E2'].value);self.assertIn('估价',w['窗户配置与依据']['G2'].value)
