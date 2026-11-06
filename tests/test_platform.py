import os,tempfile,unittest,io,json
from pathlib import Path
from unittest.mock import patch
temp=tempfile.TemporaryDirectory();os.environ['WINDOW_DATA_DIR']=temp.name
from fastapi.testclient import TestClient
from backend.main import app
from backend.models import Project
from backend.rules import evaluate
from backend.sources import get_sources
from backend.extract import candidates,extract
from backend.providers import model_call
from pydantic import ValidationError
client=TestClient(app)

class PlatformTests(unittest.TestCase):
    def reviewed_text_project(self,name='测试'):
        document=client.post('/api/upload',files={'file':('config.txt','型材壁厚 1.8mm'.encode(),'text/plain')}).json()
        self.assertEqual(client.post('/api/documents/'+document['id']+'/confirm').status_code,200)
        return {'name':name,'documents':[document['id']],'reviewed_documents':[document['id']]}
    def test_new_comparison_dimensions_and_reference_boundary(self):
        from backend.references import get_references
        p=Project(specs={'water':350,'uw':2.6,'opening':'外开','tempered':'否','sound_rw':34,'air_grade':6,'seal_count':2},
                  targets={'water':400,'uw':2.4,'opening':'内开','tempered':'是','sound_rw':35,'air_grade':7,'seal_count':3})
        result=evaluate(p,get_sources())
        matches={x['id']:x['status'] for x in result['results']}
        self.assertTrue(all(matches['target_'+k]=='不满足需求' for k in ('water','uw','sound_rw','air_grade','seal_count')))
        self.assertEqual(matches['target_opening'],'需核对差异')
        self.assertIn('≥1.8 mm',get_references()['thickness']['national'])
        self.assertIn('未核实',get_references()['uw']['national'])
    def test_unknown_never_pass(self):
        r=evaluate(Project(),get_sources())
        self.assertTrue(all(x['status']=='未确定' for x in r['results'] if x['layer']=='硬性规范'))
    def test_target_numeric_direction(self):
        p=Project(specs={'thickness':1.8,'uw':3.2,'price':900},targets={'thickness':2,'uw':3,'price':800})
        rows=[x for x in evaluate(p,get_sources())['results'] if x['layer']=='用户需求']
        self.assertEqual([x['status'] for x in rows],['不满足需求']*3)
    def test_missing_target_value(self):
        r=evaluate(Project(targets={'seal':'EPDM'}),get_sources())
        self.assertEqual(r['results'][-1]['status'],'未确定')
    def test_unverified_standard_does_not_pass(self):
        sources=get_sources();next(x for x in sources if x['id']=='GB8478')['verified_clause']=False
        r=evaluate(Project(specs={'thickness':3}),sources)
        self.assertEqual(r['results'][0]['status'],'未确定')
    def test_verified_standard_thresholds(self):
        r=evaluate(Project(specs={'thickness':1.6,'glass':'5+6A+5'}),get_sources())
        self.assertEqual(r['results'][0]['status'],'低于标准值');self.assertEqual(r['results'][1]['status'],'低于标准值')
        r=evaluate(Project(specs={'thickness':1.8,'glass':'5+9A+5 Low-E'}),get_sources())
        self.assertEqual(r['results'][0]['status'],'参数达到');self.assertEqual(r['results'][1]['status'],'参数达到')
    def test_complex_glass_not_guessed(self):
        r=evaluate(Project(specs={'glass':'5+12A+5+12A+5'}),get_sources())
        self.assertEqual(r['results'][1]['status'],'未确定')
    def test_ambiguous_glass_not_gas(self):
        for glass in ['5+0.76+5','5+9+5','5+12A+5+12A+5']:
            self.assertEqual(evaluate(Project(specs={'glass':glass}),get_sources())['results'][1]['status'],'未确定')
        self.assertEqual(evaluate(Project(specs={'glass':'5+12Ar+5'}),get_sources())['results'][1]['status'],'参数达到')
    def test_manual_records_applicability(self):
        p=Project(specs={'seal_compatible':'否','hardware_match':'否'})
        r=evaluate(p,get_sources());self.assertEqual(r['issues'],2)
        p.product='其他/未确定'
        self.assertTrue(all(x['status']=='未确定' for x in evaluate(p,get_sources())['results'][2:4]))
        p.product='铝合金外窗';sources=get_sources();next(x for x in sources if x['id']=='GB8478')['verified_clause']=False
        self.assertTrue(all(x['status']=='未确定' for x in evaluate(p,sources)['results'][2:4]))
    def test_complex_candidate_keeps_whole_combination(self):
        glass='5+12Ar+5+12Ar+5 Low-E'
        found=candidates([{'page':1,'text':glass}])
        self.assertEqual(found[0]['value'],glass)
        self.assertEqual(evaluate(Project(specs={'glass':found[0]['value']}),get_sources())['results'][1]['status'],'未确定')
    def test_nonfinite_invalid(self):
        for val in [float('nan'),float('inf'),-1]:
            with self.assertRaises(ValidationError): Project(specs={'thickness':val})
    def test_evidence_candidates_not_adopted(self):
        c=candidates([{'page':2,'text':'型材壁厚 1.8mm\n五金：某品牌 H1\n整窗 Uw: 2.8'}])
        self.assertEqual(len(c),3);self.assertTrue(all(not x['confirmed'] for x in c));self.assertTrue(all(x['page']==2 for x in c))
    def test_upload_and_download(self):
        r=client.post('/api/upload',files={'file':('报价.txt','型材壁厚 1.8mm'.encode(),'text/plain')});self.assertEqual(r.status_code,200)
        d=r.json();self.assertEqual(d['candidates'][0]['value'],1.8);self.assertEqual(len(d['sha256']),64)
        self.assertEqual(client.get('/api/documents/'+d['id']+'/download').content,'型材壁厚 1.8mm'.encode())
    def test_bad_file_and_missing(self):
        self.assertEqual(client.post('/api/upload',files={'file':('a.exe',b'a')}).status_code,415)
        self.assertEqual(client.post('/api/upload',files={'file':('a.txt',b'')}).status_code,422)
        self.assertEqual(client.get('/api/documents/no-such').status_code,404)
    def test_history_immutable_and_conflict(self):
        p=client.post('/api/projects',json=self.reviewed_text_project()).json()
        r=client.post('/api/evaluate',json=p).json()
        self.assertEqual(client.post('/api/projects',json=p).status_code,409)
        p=r['project'];p['specs']['thickness']=2.5
        second=client.post('/api/evaluate',json=p).json()
        h=client.get('/api/history/'+p['id']).json();self.assertEqual(len(h),2)
        self.assertIsNone(h[1]['project']['specs']['thickness']);self.assertEqual(second['project']['specs']['thickness'],2.5)
    def test_cross_origin_and_non_guangdong(self):
        self.assertEqual(client.post('/api/projects',json={},headers={'origin':'https://evil.example'}).status_code,403)
        self.assertEqual(client.post('/api/projects',json={'city':'北京'}).status_code,422)
    def test_export_saved_snapshot(self):
        project=self.reviewed_text_project('导出测试');project['specs']={'thickness':1.6}
        saved=client.post('/api/evaluate',json=project).json()
        response=client.get('/api/evaluations/'+saved['id']+'/download')
        self.assertEqual(response.json(),saved)
        self.assertIn('attachment;',response.headers['content-disposition'])
        self.assertEqual(client.get('/api/evaluations/missing/download').status_code,404)
    def test_visual_report_snapshot_and_history(self):
        from PIL import Image
        from unittest.mock import AsyncMock
        image=Image.new('RGB',(120,80),'white');buf=io.BytesIO();image.save(buf,'PNG')
        document=client.post('/api/upload',files={'file':('sample.png',buf.getvalue(),'image/png')}).json()
        self.assertEqual(client.post('/api/documents/'+document['id']+'/analyze',json={'page':1}).status_code,422)
        with patch('backend.visual.completion',new=AsyncMock(return_value=('VISION_NOT_CONFIGURED',''))):
            updated=client.post('/api/documents/'+document['id']+'/analyze',json={'page':1,'consent':True}).json()
        self.assertEqual(updated['visual_reports'][0]['status'],'VISION_NOT_CONFIGURED')
        self.assertTrue(all(x['status']=='未确定' for x in updated['visual_reports'][0]['checks']))
        self.assertEqual(client.post('/api/documents/'+document['id']+'/confirm').status_code,200)
        project={'name':'图片分析','documents':[document['id']],'reviewed_documents':[document['id']]}
        first=client.post('/api/evaluate',json=project).json()
        self.assertEqual(len(first['visual_reports']),1)
        self.assertEqual(len(first['document_evidence']),1)
        self.assertTrue(any(x['layer']=='图像报告' for x in first['results']))
        self.assertEqual(client.get('/api/history/'+first['project_id']).json()[0]['id'],first['id'])
    def test_visual_rejects_invented_or_incomplete_findings(self):
        from backend.visual import analyze,CHECKS
        from unittest.mock import AsyncMock
        answers=[{'id':k,'status':'可见风险','evidence':'无'} for k,_,_ in CHECKS]
        payload=json.dumps({'document_type':'样角','summary':'局部截面','checks':answers,'observations':[]},ensure_ascii=False)
        with tempfile.TemporaryDirectory() as td:
            from PIL import Image
            path=Path(td)/'x.png';Image.new('RGB',(60,60),'white').save(path)
            with patch('backend.visual.completion',new=AsyncMock(return_value=('OK',payload))):
                import asyncio
                report=asyncio.run(analyze(path,'x',1))
            self.assertTrue(all(x['status']=='未确定' for x in report['checks']))
            self.assertNotEqual(report['summary'],'局部截面')
    def test_evaluation_gate_and_item_reviews(self):
        from PIL import Image
        from unittest.mock import AsyncMock
        from backend.visual import CHECKS
        image=Image.new('RGB',(120,80),'white');buf=io.BytesIO();image.save(buf,'PNG')
        document=client.post('/api/upload',files={'file':('corner.png',buf.getvalue(),'image/png')}).json()
        project={'name':'样角核对','documents':[document['id']],'reviewed_documents':[document['id']]}
        self.assertEqual(client.post('/api/evaluate',json={}).status_code,422)
        self.assertEqual(client.post('/api/evaluate',json=project).status_code,422)
        with patch('backend.visual.completion',new=AsyncMock(return_value=('VISION_NOT_CONFIGURED',''))):
            report=client.post('/api/documents/'+document['id']+'/analyze',json={'page':1,'consent':True,'document_type':'样角'}).json()['visual_reports'][0]
        self.assertEqual(report['document_type'],'样角')
        self.assertEqual(client.post('/api/evaluate',json=project).status_code,422)
        self.assertEqual(client.post('/api/documents/'+document['id']+'/reports/1/checks/three_seals/review',json={'decision':'confirmed'}).status_code,422)
        self.assertEqual(client.post('/api/documents/'+document['id']+'/reports/1/checks/three_seals/review',json={'decision':'manual_risk','note':'图中密封路径可见缺口','region':{'x':950,'y':0,'width':100,'height':100}}).status_code,422)
        for key,_,_ in CHECKS:
            value={'decision':'manual_risk','note':'测试图左上角框扇接缝有可见开口线索','region':{'x':100,'y':100,'width':200,'height':200}} if key=='three_seals' else {'decision':'uncertain'}
            response=client.post(f'/api/documents/{document["id"]}/reports/1/checks/{key}/review',json=value)
            self.assertEqual(response.status_code,200)
        self.assertEqual(client.post('/api/evaluate',json=project).status_code,422)
        self.assertEqual(client.post('/api/documents/'+document['id']+'/confirm').status_code,200)
        image_response=client.get(f'/api/documents/{document["id"]}/pages/1/preview')
        self.assertEqual(image_response.status_code,200)
        self.assertEqual(image_response.headers['content-type'],'image/jpeg')
        saved=client.post('/api/evaluate',json=project)
        self.assertEqual(saved.status_code,200)
        self.assertEqual(saved.json()['visual_risks'],1)
        visual=[item for item in saved.json()['results'] if item['layer']=='图像报告' and item['id'].startswith('visual_')]
        self.assertEqual(visual[0]['status'],'可见风险')
        self.assertEqual(visual[0]['region']['width'],200)
        self.assertTrue(all(item['status']=='未确定' for item in visual[1:]))
        self.assertEqual(client.get('/api/history/'+saved.json()['project_id']).json()[0]['id'],saved.json()['id'])
    def test_client_review_flag_cannot_bypass_server(self):
        document=client.post('/api/upload',files={'file':('quote.txt',b'Uw 2.8','text/plain')}).json()
        project={'name':'禁止伪造核对','documents':[document['id']],'reviewed_documents':[document['id']]}
        before=len(client.get('/api/projects').json())
        response=client.post('/api/evaluate',json=project)
        self.assertEqual(response.status_code,422)
        self.assertIn('服务端确认',response.json()['detail'])
        self.assertEqual(len(client.get('/api/projects').json()),before)
        self.assertEqual(client.post('/api/documents/'+document['id']+'/confirm').status_code,200)
        self.assertEqual(client.post('/api/evaluate',json=project).status_code,200)
    def test_visual_region_requires_model_location(self):
        from backend.visual import analyze,CHECKS
        from unittest.mock import AsyncMock
        from PIL import Image
        import asyncio
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'x.png';Image.new('RGB',(80,80),'white').save(path)
            answers=[{'id':key,'status':'可见风险','evidence':'左上角可见密封胶条在搭接处断开','region':None} for key,_,_ in CHECKS]
            payload=json.dumps({'document_type':'样角','checks':answers,'observations':[]},ensure_ascii=False)
            with patch('backend.visual.completion',new=AsyncMock(return_value=('OK',payload))):
                report=asyncio.run(analyze(path,'x',1))
            self.assertTrue(all(item['status']=='未确定' for item in report['checks']))
            answers[0]['region']={'x':100,'y':100,'width':200,'height':200}
            payload=json.dumps({'document_type':'样角','checks':answers,'observations':[]},ensure_ascii=False)
            with patch('backend.visual.completion',new=AsyncMock(return_value=('OK',payload))):
                report=asyncio.run(analyze(path,'x',1))
            self.assertEqual(report['checks'][0]['status'],'可见风险')
            self.assertEqual(report['checks'][0]['region']['width'],200)
    def test_visual_search_keeps_private_document_out_of_query(self):
        import asyncio
        from unittest.mock import AsyncMock
        from PIL import Image
        from backend.visual import analyze
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'private-contract.png';Image.new('RGB',(60,60),'white').save(path)
            leads={'status':'LIVE','items':[{'id':'WEB1','title':'公开节点资料','url':'https://example.org/node','excerpt':'公开摘要'}]}
            with patch('backend.visual.settings',return_value={'vision_available':True}),\
                 patch('backend.visual.search_web',new=AsyncMock(return_value=leads)) as search,\
                 patch('backend.visual.completion',new=AsyncMock(return_value=('UNVERIFIED_RESPONSE',''))):
                report=asyncio.run(analyze(path,'private-id',1,'业主电话 13800000000'))
            self.assertEqual(search.await_count,1)
            self.assertNotIn('13800000000',search.await_args.args[0])
            self.assertNotIn('private-contract',search.await_args.args[0])
            self.assertEqual(report['research']['items'][0]['id'],'WEB1')
            self.assertTrue(all(c['status']=='未确定' for c in report['checks']))
    def test_settings_key_is_local_encrypted(self):
        from backend.config import DB
        response=client.post('/api/settings',json={'provider':'gemini','model':'gemini-2.5-flash','vision_model':'gemini-2.5-flash','api_key':'unit-test-secret'})
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.json()['key_configured'])
        self.assertNotIn('unit-test-secret',DB.read_text(encoding='latin1'))
        self.assertEqual(client.get('/api/settings').json()['api_key'] if 'api_key' in client.get('/api/settings').json() else None,None)
        import sqlite3
        with sqlite3.connect(DB) as con: con.execute('DELETE FROM provider_config WHERE id=1')
    def test_docx_xlsx(self):
        from docx import Document
        from openpyxl import Workbook
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'a.docx';d=Document();d.add_paragraph('型材壁厚 1.8mm');d.save(p);self.assertEqual(extract(p)['candidates'][0]['value'],1.8)
            p=Path(td)/'a.xlsx';w=Workbook();w.active.append(['型材壁厚','2.0mm']);w.save(p);self.assertEqual(extract(p)['candidates'][0]['value'],2)
    def test_scanned_pdf_ocr(self):
        from PIL import Image,ImageDraw,ImageFont
        with tempfile.TemporaryDirectory() as td:
            im=Image.new('RGB',(900,160),'white');draw=ImageDraw.Draw(im)
            draw.text((25,45),'Profile 1.8mm  Uw: 2.8',fill='black',font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',36))
            p=Path(td)/'scan.pdf';im.save(p,'PDF')
            parsed=extract(p)
            self.assertEqual(parsed['mode'],'TEXT_AND_OCR_CANDIDATES')
            self.assertIn('2.8',parsed['pages'][0]['text'])

class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_qwen_vision_uses_compatible_endpoint(self):
        import httpx
        from unittest.mock import AsyncMock
        from backend.providers import completion
        response=httpx.Response(200,json={'choices':[{'message':{'content':'{"document_type":"样角"}'}}]},request=httpx.Request('POST','https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'))
        config={'provider':'qwen','model':'qwen-plus','vision_model':'qwen3-vl-plus','base_url':'','api_key':'test-only-key'}
        message=[{'role':'user','content':[{'type':'text','text':'观察'}, {'type':'image_url','image_url':{'url':'data:image/jpeg;base64,AA=='}}]}]
        with patch('backend.providers.read_config',return_value=config),patch('httpx.AsyncClient.post',new=AsyncMock(return_value=response)) as post:
            status,_=await completion(message,vision=True)
        self.assertEqual(status,'OK')
        self.assertEqual(post.await_args.args[0],'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
        self.assertEqual(post.await_args.kwargs['json']['model'],'qwen3-vl-plus')
        self.assertEqual(post.await_args.kwargs['json']['messages'],message)
    async def test_irrelevant_search_not_live(self):
        import httpx
        from unittest.mock import AsyncMock
        from backend.providers import search_web
        response=httpx.Response(200,text='<rss><channel><item><title>Cruise holidays</title><link>https://example.test</link><description>Ships and tickets</description></item></channel></rss>',request=httpx.Request('GET','https://example.test'))
        with patch('httpx.AsyncClient.get',new=AsyncMock(return_value=response)):
            r=await search_web('广东门窗抗风压');self.assertEqual(r['status'],'NO_RELEVANT_RESULTS');self.assertEqual(r['items'],[])
    async def test_no_evidence(self): self.assertEqual((await model_call('问题',[]))['status'],'INSUFFICIENT_EVIDENCE')
    async def test_unconfigured(self):
        with patch.dict(os.environ,{'WINDOW_LLM_BASE_URL':'https://example.invalid','WINDOW_LLM_API_KEY':''}):
            self.assertEqual((await model_call('问题',[{'id':'x'}]))['status'],'NOT_CONFIGURED')
    async def test_fabricated_citation_blocked(self):
        import httpx
        from unittest.mock import AsyncMock
        response=httpx.Response(200,json={'choices':[{'message':{'content':json.dumps({'answer':'伪造结论','citations':['FAKE']})}}]},request=httpx.Request('POST','https://example.test'))
        with patch('httpx.AsyncClient.post',new=AsyncMock(return_value=response)):
            self.assertEqual((await model_call('问题',[{'id':'REAL'}]))['status'],'UNVERIFIED_RESPONSE')
    async def test_network_failure_truthful(self):
        from unittest.mock import AsyncMock
        with patch('httpx.AsyncClient.post',new=AsyncMock(side_effect=OSError())):
            self.assertEqual((await model_call('问题',[{'id':'REAL'}]))['status'],'CONNECTION_FAILED')

if __name__=='__main__': unittest.main()
