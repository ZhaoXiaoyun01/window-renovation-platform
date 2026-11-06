import {useEffect,useState} from 'react';
import {ArrowUpRight,Search} from 'lucide-react';
import {api} from './api';
const standard=s=>/标准|规范/.test(s.kind)&&!/经验/.test(s.kind);
export default function Library({sources}){
 const [section,setSection]=useState('标准库'),[draft,setDraft]=useState(''),[query,setQuery]=useState(''),[skills,setSkills]=useState([]);
 useEffect(()=>{api('/skills').then(setSkills).catch(()=>{})},[]);
 const match=(text)=>text.toLowerCase().includes(query.toLowerCase());
 const items=sources.filter(s=>(query|| (section==='标准库'?standard(s):section==='经验库'&&!standard(s)))&&(!query||match(s.title+s.kind+s.excerpt+s.id)));
 const skillItems=skills.filter(s=>(query||section==='Skill')&&(!query||match(s.title+s.scope+s.source+s.id)));
 return <section className="page-section library"><h1>依据资料库</h1><p className="lead">标准、经验和项目 Skill 整页切换；搜索覆盖本地资料全集。每条来源保留核验状态。</p>
 <div className="library-switch">{['标准库','经验库','Skill'].map(name=><button key={name} className={section===name?'selected':''} onClick={()=>{setSection(name);setQuery('');setDraft('')}}>{name}</button>)}</div>
 <form className="library-search" onSubmit={e=>{e.preventDefault();setQuery(draft.trim())}}><input aria-label="全集模糊搜索" placeholder="搜索全部标准、经验或视频" value={draft} onChange={e=>setDraft(e.target.value)}/><button type="submit"><Search size={15}/>搜索全集</button></form>
 <p className="notice">{query?'全集结果 · '+(items.length+skillItems.length)+' 条':section+' · '+(items.length+skillItems.length)+' 条'}。视频仅保留96分钟全攻略索引及章节；未取得字幕，观点尚未进入评估规则。地方规范线索不等于适用条文。项目 Skill 是本地改写的审查流程，不代表上游仓库原文。</p>
 {items.map(s=><article className="source-row" key={s.id}><small>{s.kind} · 核查日期 {s.checked_at}</small><h3>{s.url?<a href={s.url} target="_blank" rel="noreferrer">{s.title}<ArrowUpRight size={15}/></a>:s.title}</h3><span className="status">{s.status}</span><p>{s.excerpt}</p>{s.chapters?<div className="chapters">{s.chapters.map(c=><a key={c.seconds} href={s.url+'?t='+c.seconds} target="_blank" rel="noreferrer">{Math.floor(c.seconds/60)}:{String(c.seconds%60).padStart(2,'0')} {c.title}</a>)}</div>:null}</article>)}
 {skillItems.map(s=><article className="source-row" key={s.id}><small>项目 Skill · {s.enabled?'已启用':'未启用'}</small><h3>{s.title}</h3><p>适用范围：{s.scope}</p><p>来源：{s.source}</p><small>模型回答会按问题主题调用；Skill 不能代替规范原文或人工核验。</small></article>)}
 {!items.length&&!skillItems.length?<p className="empty">本地资料中没有匹配结果。</p>:null}
 </section>
}
