import json, os, sqlite3, uuid, hashlib, base64
from contextlib import contextmanager, asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from .models import Project, Question, VisualRequest, CheckReview, ProviderConfig
from .rules import evaluate
from .sources import get_sources,ROOT
from .extract import extract
from .providers import settings,search_web,model_call
from .config import save_config
from .visual import analyze, image_data, valid_region, CHECKS
from .references import get_references
from .skills import list_skills
from .renovation import router as renovation_router
from .subscriptions import router as subscription_router, validate_selection, shutdown as stop_subscriptions

DATA=Path(os.getenv('WINDOW_DATA_DIR',str(ROOT/'data'))); DATA.mkdir(parents=True,exist_ok=True)
(DATA/'uploads').mkdir(exist_ok=True)
DB=DATA/'windows.sqlite3'
@contextmanager
def connect():
    con=sqlite3.connect(DB); con.row_factory=sqlite3.Row
    try:
        with con: yield con
    finally: con.close()
with connect() as c:
    c.executescript('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, version INTEGER, body TEXT); CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, body TEXT, path TEXT); CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY, project_id TEXT, body TEXT); CREATE TABLE IF NOT EXISTS source_entries(id TEXT PRIMARY KEY, body TEXT);')
    current_sources=get_sources()
    source_ids={source['id'] for source in current_sources}
    for row in c.execute('SELECT id,body FROM source_entries').fetchall():
        if row['id'] not in source_ids and json.loads(row['body']).get('kind','').startswith('从业者视频'):
            c.execute('DELETE FROM source_entries WHERE id=?',(row['id'],))
    for source in current_sources:
        c.execute('INSERT OR REPLACE INTO source_entries VALUES(?,?)',(source['id'],json.dumps(source,ensure_ascii=False)))
@asynccontextmanager
async def lifespan(app):
    try: yield
    finally: stop_subscriptions()

app=FastAPI(title='门窗结构分析 1.5',docs_url=None,redoc_url=None,lifespan=lifespan)
app.include_router(renovation_router)
app.include_router(subscription_router)

@app.exception_handler(RequestValidationError)
async def invalid_request(request,exc):
    return JSONResponse({'detail':[{k:v for k,v in error.items() if k in ('loc','msg','type')} for error in exc.errors()]},422)

@app.middleware('http')
async def local_only(request:Request,call_next):
    if request.url.hostname not in ('127.0.0.1','localhost','testserver'): return JSONResponse({'detail':'仅限本机访问'},403)
    origin=request.headers.get('origin')
    allowed_origins=(f'http://127.0.0.1:{request.url.port}',f'http://localhost:{request.url.port}','http://127.0.0.1:5173')
    if origin and origin not in allowed_origins: return JSONResponse({'detail':'拒绝跨站请求'},403)
    if request.method!='GET' and int(request.headers.get('content-length','0'))>21*1024*1024: return JSONResponse({'detail':'文件上限20MB'},413)
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Referrer-Policy']='no-referrer'
    return response

@app.get('/api/health')
def health(): return {'status':'ok','version':'1.5'}

@app.get('/api/sources')
def sources():
    return get_sources()

@app.get('/api/references')
def references(product:str='铝合金外窗'): return get_references(product)

@app.get('/api/skills')
def skills(): return list_skills()

@app.get('/api/settings')
def config(): return settings()

@app.post('/api/settings')
async def set_config(value:ProviderConfig):
    try:
        if value.provider=='pi': await validate_selection(value.pi_provider,value.model,value.vision_model)
        save_config(value)
        return settings()
    except ValueError as exc: raise HTTPException(422,str(exc)) from exc

@app.get('/api/projects')
def projects():
    with connect() as c: return [json.loads(x['body']) for x in c.execute('SELECT body FROM projects ORDER BY rowid DESC')]

@app.post('/api/projects')
def save(p:Project):
    if p.city not in '广州 深圳 珠海 佛山 东莞 中山 惠州 江门 肇庆 汕头 潮州 揭阳 汕尾 湛江 茂名 阳江 韶关 清远 河源 梅州 云浮'.split(): raise HTTPException(422,'当前版本仅支持广东省城市')
    body=p.model_dump(); pid=p.id or uuid.uuid4().hex
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        existing=c.execute('SELECT version FROM projects WHERE id=?',(pid,)).fetchone()
        if (existing and existing['version']!=p.version) or (p.id and not existing): raise HTTPException(409,'VERSION_CONFLICT：请重新打开项目')
        for did in p.documents:
            if not c.execute('SELECT id FROM documents WHERE id=?',(did,)).fetchone(): raise HTTPException(422,'资料不存在')
        body.update(id=pid,version=p.version+1)
        c.execute('INSERT OR REPLACE INTO projects VALUES(?,?,?)',(pid,body['version'],json.dumps(body,ensure_ascii=False)))
    return body

@app.post('/api/upload')
def upload(file:UploadFile=File(...)):
    suffix=Path(file.filename or '').suffix.lower()
    if suffix not in ('.pdf','.png','.jpg','.jpeg','.webp','.docx','.xlsx','.txt','.csv'): raise HTTPException(415,'支持 PDF、PNG、JPG、WebP、DOCX、XLSX、TXT、CSV')
    raw=file.file.read(20*1024*1024+1)
    if len(raw)>20*1024*1024: raise HTTPException(413,'文件上限20MB')
    if not raw: raise HTTPException(422,'文件为空')
    did=uuid.uuid4().hex; path=DATA/'uploads'/(did+suffix); path.write_bytes(raw)
    try: parsed=extract(path)
    except Exception:
        parsed={'mode':'EXTRACTION_FAILED','pages':[],'candidates':[],'warning':'文件已保存，但解析失败。请检查格式、密码、页数或改传文本/图片。'}
    body=dict(id=did,name=Path(file.filename).name,size=len(raw),sha256=hashlib.sha256(raw).hexdigest(),created_at=datetime.now(timezone.utc).isoformat(),**parsed)
    with connect() as c: c.execute('INSERT INTO documents VALUES(?,?,?)',(did,json.dumps(body,ensure_ascii=False),str(path)))
    return body

@app.get('/api/documents/{did}')
def document(did:str):
    with connect() as c: row=c.execute('SELECT body FROM documents WHERE id=?',(did,)).fetchone()
    if not row: raise HTTPException(404,'资料不存在')
    return json.loads(row['body'])

@app.post('/api/documents/{did}/confirm')
def confirm_document(did:str):
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT body,path FROM documents WHERE id=?',(did,)).fetchone()
        if not row: raise HTTPException(404,'资料不存在')
        document=json.loads(row['body'])
        if Path(row['path']).suffix.lower() in ('.png','.jpg','.jpeg','.webp','.pdf') and not document.get('visual_reports'):
            raise HTTPException(422,'请先生成至少一页图像报告')
        for report in document.get('visual_reports',[]):
            if report.get('document_type')=='样角':
                checks=report.get('checks',[])
                if len(checks)!=len(CHECKS) or any((item.get('review') or {}).get('decision') not in ('confirmed','rejected','uncertain','manual_risk') for item in checks):
                    raise HTTPException(422,'请先逐项核对样角检查')
        document['content_review']={'confirmed_at':datetime.now(timezone.utc).isoformat(),'sha256':document['sha256']}
        c.execute('UPDATE documents SET body=? WHERE id=?',(json.dumps(document,ensure_ascii=False),did))
    return document

@app.get('/api/documents/{did}/download')
def download(did:str):
    with connect() as c: row=c.execute('SELECT body,path FROM documents WHERE id=?',(did,)).fetchone()
    if not row: raise HTTPException(404,'资料不存在')
    return FileResponse(row['path'],filename=json.loads(row['body'])['name'],media_type='application/octet-stream')

@app.get('/api/documents/{did}/preview')
def preview(did:str):
    with connect() as c: row=c.execute('SELECT path FROM documents WHERE id=?',(did,)).fetchone()
    if not row: raise HTTPException(404,'资料不存在')
    suffix=Path(row['path']).suffix.lower()
    mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}.get(suffix)
    if not mime: raise HTTPException(415,'该格式请下载原件查看')
    return FileResponse(row['path'],media_type=mime)

@app.get('/api/documents/{did}/pages/{page}/preview')
def page_preview(did:str,page:int):
    with connect() as c: row=c.execute('SELECT path FROM documents WHERE id=?',(did,)).fetchone()
    if not row: raise HTTPException(404,'资料不存在')
    path=Path(row['path'])
    if path.suffix.lower() not in ('.png','.jpg','.jpeg','.webp','.pdf'): raise HTTPException(415,'该文件没有图像预览')
    try: encoded=image_data(path,page)
    except (ValueError,OSError,RuntimeError) as exc: raise HTTPException(422,'图像无法渲染或页码无效') from exc
    return Response(base64.b64decode(encoded.split(',',1)[1]),media_type='image/jpeg',headers={'Cache-Control':'no-store'})

@app.post('/api/documents/{did}/analyze')
async def visual_review(did:str, options:VisualRequest):
    with connect() as c: row=c.execute('SELECT body,path FROM documents WHERE id=?',(did,)).fetchone()
    if not row: raise HTTPException(404,'资料不存在')
    path=Path(row['path'])
    if path.suffix.lower() not in ('.png','.jpg','.jpeg','.webp','.pdf'): raise HTTPException(415,'仅支持图片或 PDF 页面的视觉分析')
    source=json.loads(row['body'])
    local_text=next((str(p.get('text','')) for p in source.get('pages',[]) if p.get('page')==options.page),'')
    try: report=await analyze(path,did,options.page,local_text,options.document_type)
    except (ValueError,OSError,RuntimeError) as exc: raise HTTPException(422,'图像无法渲染或页码无效，请检查文件格式、密码和页码。') from exc
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        current=json.loads(c.execute('SELECT body FROM documents WHERE id=?',(did,)).fetchone()['body'])
        current['visual_reports']=[r for r in current.get('visual_reports',[]) if r['page']!=options.page]+[report]
        current.pop('content_review',None)
        c.execute('UPDATE documents SET body=? WHERE id=?',(json.dumps(current,ensure_ascii=False),did))
    return current

@app.post('/api/documents/{did}/reports/{page}/checks/{check_id}/review')
def review_visual_check(did:str,page:int,check_id:str,value:CheckReview):
    if check_id not in {item[0] for item in CHECKS}: raise HTTPException(404,'检查项不存在')
    region=valid_region(value.region) if value.region is not None else None
    if value.region is not None and region is None: raise HTTPException(422,'标注区域无效')
    if value.decision=='manual_risk' and (not region or len(value.note.strip())<10):
        raise HTTPException(422,'人工记录风险须标注图中区域并写明至少10字可见依据')
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT body FROM documents WHERE id=?',(did,)).fetchone()
        if not row: raise HTTPException(404,'资料不存在')
        document=json.loads(row['body'])
        report=next((r for r in document.get('visual_reports',[]) if r['page']==page),None)
        if not report: raise HTTPException(404,'该页报告不存在')
        check=next((item for item in report['checks'] if item['id']==check_id),None)
        if not check: raise HTTPException(404,'检查项不存在')
        if value.decision in ('confirmed','rejected') and check['status'] not in ('可见风险','未见明显问题'):
            raise HTTPException(422,'模型未给出明确线索；请选择无法核实或人工记录风险')
        if value.decision=='confirmed':
            if check['status'] not in ('可见风险','未见明显问题') or not (region or valid_region(check.get('region'))):
                raise HTTPException(422,'仅可确认已定位且有明确判断的模型线索；其余请选择无法核实或人工记录风险')
        check['review']={'decision':value.decision,'note':value.note.strip(),'region':region or (valid_region(check.get('region')) if value.decision=='confirmed' else None),
                         'reviewed_at':datetime.now(timezone.utc).isoformat()}
        document.pop('content_review',None)
        c.execute('UPDATE documents SET body=? WHERE id=?',(json.dumps(document,ensure_ascii=False),did))
    return document

def assessment_documents(p:Project):
    if not p.documents: raise HTTPException(422,'请先上传至少一份资料')
    if len(p.documents)!=len(set(p.documents)) or set(p.reviewed_documents)-set(p.documents):
        raise HTTPException(422,'资料清单或核对记录无效')
    with connect() as c:
        documents=[]
        for did in p.documents:
            row=c.execute('SELECT body,path FROM documents WHERE id=?',(did,)).fetchone()
            if not row: raise HTTPException(422,'资料不存在')
            document=json.loads(row['body']); documents.append(document)
            if did not in p.reviewed_documents or document.get('content_review',{}).get('sha256')!=document['sha256']:
                raise HTTPException(422,f'{document["name"]} 尚未在服务端确认原件与识别文字')
            if Path(row['path']).suffix.lower() in ('.png','.jpg','.jpeg','.webp','.pdf') and not document.get('visual_reports'):
                raise HTTPException(422,f'{document["name"]} 尚未生成图像报告')
            for report in document.get('visual_reports',[]):
                if report.get('document_type')=='样角':
                    checks=report.get('checks',[])
                    if len(checks)!=len(CHECKS) or {item.get('id') for item in checks}!={item[0] for item in CHECKS}:
                        raise HTTPException(422,f'{document["name"]} 第 {report["page"]} 页的检查项不完整，请重新生成报告')
                    missing=[item['title'] for item in checks if (item.get('review') or {}).get('decision') not in ('confirmed','rejected','uncertain','manual_risk')]
                    if missing: raise HTTPException(422,f'{document["name"]} 第 {report["page"]} 页尚有 {len(missing)} 项样角检查未逐项确认')
    return documents

@app.post('/api/evaluate')
def assess(p:Project):
    documents=assessment_documents(p)
    saved=save(p); source_snapshot=get_sources(); result=evaluate(saved,source_snapshot)
    for document in documents:
        source_snapshot.append({'id':document['id'],'title':document['name'],'kind':'用户上传资料','status':'OCR/图像识别待人工核验',
                                'url':'/api/documents/'+document['id']+'/download','excerpt':'SHA-256：'+document['sha256']+'。原件及提取文本存于本地。'})
        pending=len(document.get('candidates',[])); reviewed=document['id'] in saved.get('reviewed_documents',[])
        result['results'].append({'id':'document_'+document['id'],'layer':'资料核对','title':document['name'],
            'status':'待核对' if not reviewed else '记录已核对','detail':f'提取模式：{document["mode"]}；{pending} 个参数候选；{len(document.get("observations",[]))} 条分类文字。自动识别数据由用户核对后进入配置评估。',
            'advice':'对照原件逐项核对报价、合同约定、报告样品与本项目是否一致；识别文本不能证明文件真实性。','source':document['id']})
        for category in dict.fromkeys(x['category'] for x in document.get('observations',[])):
            lines=[x for x in document['observations'] if x['category']==category]
            result['results'].append({'id':f'document_{document["id"]}_{category}','layer':'资料核对','title':f'{document["name"]} · {category}',
                'status':'记录已核对' if reviewed else '待核对','detail':f'{len(lines)} 条线索，例：'+ '；'.join(f'第{x["page"]}页 {x["text"]}' for x in lines[:3]),
                'advice':'全部原文保留在本次快照；合同承诺、检测性能和现场实物须分别核对。','source':document['id']})
        for report in document.get('visual_reports',[]):
            for check in report['checks']:
                review=check.get('review') or {}; decision=review.get('decision')
                status=check['status'] if decision=='confirmed' else '可见风险' if decision=='manual_risk' else '未确定'
                review_text={'confirmed':'用户已核对图中位置与模型线索','manual_risk':'用户依据图中标注补充风险','rejected':'用户不认可模型线索','uncertain':'用户核对后仍无法确认'}.get(decision,'尚未经逐项确认')
                result['results'].append({'id':f'visual_{document["id"]}_{report["page"]}_{check["id"]}',
                    'layer':'图像报告','title':check['title'],'status':status,
                    'detail':f'{document["name"]} · 第 {report["page"]} 页：{review["note"] if decision=="manual_risk" else check["evidence"]}（{review_text}）',
                    'advice':check['advice']+' 用户确认仅表示核对可见部位，不代表工程检测或鉴定。','source':document['id'],
                    'region':review.get('region') or check.get('region'),'review':review})
            for i,note in enumerate(report['observations']):
                result['results'].append({'id':f'visual_note_{document["id"]}_{report["page"]}_{i}',
                    'layer':'图像报告','title':note['topic'] or '图像文字观察','status':'待核对',
                    'detail':note['evidence'],'advice':note['meaning']+' 请对照原件核验。','source':document['id']})
    result['unknown']=sum(x['status']=='未确定' for x in result['results'])
    result['visual_risks']=sum(x['status']=='可见风险' for x in result['results'])
    result['summary']=f'参数差距 {result["issues"]} 项，图像风险线索 {result["visual_risks"]} 项，未确定 {result["unknown"]} 项。图像判断待人工核验，不构成整窗合规或结构安全结论。'
    result.update(id=uuid.uuid4().hex,project_id=saved['id'],project=saved,sources=source_snapshot,
                  visual_reports=[report for document in documents for report in document.get('visual_reports',[])],
                  document_evidence=[{'id':d['id'],'name':d['name'],'sha256':d['sha256'],'pages':d['pages'],'observations':d.get('observations',[]),'visual_reports':d.get('visual_reports',[])} for d in documents])
    with connect() as c: c.execute('INSERT INTO evaluations VALUES(?,?,?)',(result['id'],saved['id'],json.dumps(result,ensure_ascii=False)))
    return result

@app.get('/api/history/{pid}')
def history(pid:str):
    with connect() as c: return [json.loads(x['body']) for x in c.execute('SELECT body FROM evaluations WHERE project_id=? ORDER BY rowid DESC',(pid,))]

@app.post('/api/search')
async def search(q:Question): return await search_web(q.question)

@app.get('/api/evaluations/{eid}/download')
def export_evaluation(eid:str):
    with connect() as c: row=c.execute('SELECT body FROM evaluations WHERE id=?',(eid,)).fetchone()
    if not row: raise HTTPException(404,'评估不存在')
    body=json.loads(row['body'])
    return JSONResponse(body,headers={'Content-Disposition':f'attachment; filename="window-review-{body["id"]}.json"'})

@app.post('/api/ask')
async def ask(q:Question):
    local=[{'id':s['id'],'title':s['title'],'excerpt':s['excerpt'],'status':s['status']} for s in get_sources() if s['id'] in ('GB8478','GDENERGY','GDGUIDE2026','GDWINDOW','EXP','PYWIN','ZX029')]
    search=await search_web(q.question) if q.search else {'status':'NOT_REQUESTED','items':[]}
    result=await model_call(q.question,local+search['items'])
    return dict(**result,search=search,sources=local+search['items'])

@app.post('/api/model-test')
async def model_test(): return await model_call('请只说明这条资料已知与未知的内容。',[{'id':'TEST','title':'连接测试','excerpt':'整窗 Uw 未提供，因此传热性能未确定。'}])

dist=ROOT/'app'/'dist'
if dist.exists(): app.mount('/',StaticFiles(directory=dist,html=True),name='ui')
