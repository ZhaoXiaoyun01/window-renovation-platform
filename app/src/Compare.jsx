import {useEffect,useState} from 'react';
import {api,fields} from './api';
import {ConfigInput} from './ProjectPanel';
import Results from './Results';

export default function Compare({project,setProject,assess,busy,result,dirty,canAssess}){
 const [references,setReferences]=useState({});
 useEffect(()=>{api('/references?product='+encodeURIComponent(project.product)).then(setReferences).catch(()=>setReferences({}))},[project.product]);
 const target=(key,value)=>setProject(p=>({...p,targets:{...p.targets,[key]:value}}));
 const spec=(key,value)=>setProject(p=>({...p,specs:{...p.specs,[key]:value},evidence:{...p.evidence,[key]:'手工填写，来源由用户确认'}}));
 return <section className="page-section compare"><h1>配置对照</h1><p className="lead">以水密与整窗 K/Uw 为先，逐项比较目标、商家资料和已核实参考。空白表示未确定。</p>
 <div className="compare-table"><div className="compare-row compare-head"><b>评估维度</b><b>用户配置要求</b><b>商家提供配置</b><b>标准参考 · 只读</b></div>
 {fields.map(field=>{const [key,label]=field,reference=references[key]||{};return <div className="compare-row" key={key}><strong>{label}</strong><ConfigInput field={field} values={project.targets} onChange={target} target/><ConfigInput field={field} values={project.specs} onChange={spec}/><div className="reference"><p><b>国标要求</b> {reference.national||'待核实'}</p><p><b>地标要求</b> {reference.local||'待核实'}</p></div></div>})}</div>
 <p className="notice">参考栏只列已核实的适用数值；“待核实”不代表该项目没有要求。三道密封是你的选购偏好。水密压力、K 值须与项目设计和同型号报告对照。</p>
 <div className="actions"><button className="primary" disabled={busy||!canAssess} onClick={assess}>评估差距与优化方向</button>{!canAssess?<small>上传资料、为图片/PDF生成报告并确认识别内容后可评估。</small>:null}</div><Results {...{result,dirty}}/>
 </section>
}
