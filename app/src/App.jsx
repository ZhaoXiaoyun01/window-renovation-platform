import {useEffect,useState} from 'react';
import {PanelsTopLeft,FileText,SlidersHorizontal,BookOpen,Search,Save,Plus} from 'lucide-react';
import {api,blank} from './api';
import ProjectPanel from './ProjectPanel';
import Compare from './Compare';
import Results from './Results';
import Library from './Library';
import Assistant from './Assistant';
import {pendingChecks} from './VisualReview';
const nav=[['project','项目评估',FileText],['compare','配置对照',SlidersHorizontal],['library','依据资料库',BookOpen],['assistant','模型与搜索',Search]];
export default function App(){
 const [page,setPage]=useState('project'),[project,setProject]=useState(blank),[docs,setDocs]=useState([]),[projects,setProjects]=useState([]),[sources,setSources]=useState([]),[result,setResult]=useState(null),[history,setHistory]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 async function run(fn,success=''){setBusy(true);setError('');setMessage('');try{await fn();setMessage(success)}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function refresh(){setProjects(await api('/projects'))}
 useEffect(()=>{Promise.all([api('/projects'),api('/sources')]).then(([p,s])=>{setProjects(p);setSources(s)}).catch(e=>setError(e.message))},[]);
 async function load(id){if(!id)return;await run(async()=>{const p=projects.find(x=>x.id===id);const [d,h]=await Promise.all([Promise.all(p.documents.map(x=>api('/documents/'+x))),api('/history/'+id)]);setProject(p);setDocs(d);setHistory(h);setResult(h[0]||null)})}
 const pendingDocs=docs.filter(d=>!project.reviewed_documents?.includes(d.id)||d.content_review?.sha256!==d.sha256||(/\.(png|jpe?g|webp|pdf)$/i.test(d.name)&&!d.visual_reports?.length)||pendingChecks(d).length);
 const canAssess=docs.length>0&&pendingDocs.length===0;
 async function assess(){if(!canAssess){setError('请先上传资料，为图片/PDF生成报告并核对每份资料。');return}await run(async()=>{const r=await api('/evaluate',project);setResult(r);setProject(r.project);setHistory(await api('/history/'+r.project_id));await refresh()},'评估已保存。未确定项需要补充依据。')}
 function fresh(){setProject(blank());setDocs([]);setResult(null);setHistory([]);setMessage('已新建项目；旧项目仍保留在本地。')}
 const dirty=result&&(JSON.stringify({...project,version:0})!==JSON.stringify({...result.project,version:0})||(result.document_evidence&&JSON.stringify(docs.map(d=>d.visual_reports||[]))!==JSON.stringify(result.document_evidence.map(d=>d.visual_reports||[]))));
 return <div className="shell"><aside className="sidebar"><div className="brand"><PanelsTopLeft size={41} strokeWidth={1.4}/><strong>门窗结构分析 <small>1.5</small></strong></div><nav>{nav.map(([key,name,Icon])=><button key={key} className={page===key?'selected':''} onClick={()=>setPage(key)}><Icon size={19} strokeWidth={1.5}/>{name}</button>)}<a href="/renovation3d.html" target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:18,padding:"15px 18px",fontSize:14,textDecoration:"none"}}><PanelsTopLeft size={19} strokeWidth={1.5}/>3D装修效果演示 4.1</a></nav><div className="sidebar-foot">广东地区 · 本地工作台<small>证据先行 / 谨慎判断</small></div></aside>
 <main><header><div className="topline"><span>广东住宅 · 门窗选购工作台</span><div className="tools"><button disabled={busy} onClick={()=>run(async()=>{setProject(await api('/projects',project));await refresh()},'项目已保存至本机。')}><Save size={14}/>保存</button><button disabled={busy} onClick={fresh}><Plus size={14}/>新建</button></div></div><div className="title-row"><div><h1>从结构，看清每一扇窗。</h1><p>上传资料、核对配置，让选择有据可依。</p></div><div className="project-picker"><select aria-label="切换项目" value={project.id||''} onChange={e=>load(e.target.value)} disabled={busy}><option value="">当前未保存项目</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name} · v{p.version}</option>)}</select></div></div></header>
 {(error||message||busy)?<div role={error?'alert':'status'} className={'banner '+(error?'error':'')}>{busy?'正在处理，请稍候…':error||message}</div>:null}
 {page==='project'?<><ProjectPanel {...{project,setProject,docs,setDocs,run,busy,assess,history,setResult,canAssess,pendingDocs}}/><Results {...{result,dirty}}/></>:null}
 {page==='compare'?<Compare {...{project,setProject,assess,busy,result,dirty,canAssess}}/>:null}
 {page==='library'?<Library sources={sources}/>:null}{page==='assistant'?<Assistant {...{run,busy}}/>:null}
 <footer>门窗结构分析 1.5<span>硬性规范 / 经验建议 / 用户需求</span></footer></main></div>
}
