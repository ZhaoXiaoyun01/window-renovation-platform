import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { inspectModel, repairIssue, type ModelIssue } from '../utils/model-inspection';
import type { RenovationState } from '../types';

export function ModelInspectionPanel({ state, setState, onLocate, onClose }: { state: RenovationState; setState: (s: RenovationState)=>void; onLocate: (issue: ModelIssue)=>void; onClose:()=>void }) {
  const report=useMemo(()=>inspectModel(state),[state.faceFinishes,state.materials,state.faceRegionFinishes,state.finishes]),[filter,setFilter]=useState('all'),[active,setActive]=useState(''),[progress,setProgress]=useState('all');
  const reviewOf=(issue:ModelIssue)=>{const saved=state.modelReviews?.[issue.id];return saved?.evidence===JSON.stringify([issue.evidence,issue.bounds])?saved:undefined;};
  const issues=report.issues.filter(i=>(filter==='all'||i.certainty===filter)&&(progress==='all'||(reviewOf(i)?.status??'pending')===progress));
  return <section className="r3d-inspection" aria-label="可视化模型检查"><div className="r3d-inspection-head"><h2>模型检查</h2><button aria-label="关闭模型检查" onClick={onClose}><X size={16}/></button></div>
    <p>可铺贴面 {report.faceCount} · 确定问题 {report.issues.filter(i=>i.certainty==='certain').length} · 待核实 {report.issues.filter(i=>i.certainty==='review').length}</p>
    <p>结构联合外壳：{report.structuralPatches}片；{report.mergedJunctions}处原墙体交叠已裁去内部界面，源实体面中约{report.removedStructuralArea.toFixed(2)}㎡内部/重复面不再输出（非用料面积）。尺寸依据仍须核实。</p><p>检查当前模型的共面重复、缺失标准外表面、装修面入墙、外表面交接和楼层归属；不确定项不会自动删除。已复核仅表示人工看过，不改变问题性质；柔金色定位线框是辅助图形。</p>
    <label>问题性质<select aria-label="模型检查分类" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部</option><option value="certain">确定问题</option><option value="review">待核实</option></select></label>
    <label>复核进度<select aria-label="模型复核进度" value={progress} onChange={e=>setProgress(e.target.value)}><option value="all">全部进度</option><option value="pending">未复核</option><option value="reviewed">已复核</option></select></label>
    <div className="r3d-inspection-list">{issues.map(issue=>{ const signature=JSON.stringify([issue.evidence,issue.bounds]),saved=state.modelReviews?.[issue.id],review=saved?.evidence===signature?saved:undefined;return <article key={issue.id} className={active===issue.id?'active':''}>
      <div className="r3d-issue-badges"><span>性质：{issue.certainty==='certain'?'确定问题':'证据不足 · 待核实'}</span><span>进度：{review?.status==='reviewed'?'已复核':'未复核'}</span></div>
      <button className="r3d-inspection-locate" onClick={()=>{setActive(issue.id);onLocate(issue);}}>{issue.certainty==='certain'?'确定':'待核实'} · {issue.title}</button><p>{issue.evidence}</p>
      <label>复核备注<input aria-label={`复核备注${issue.id}`} maxLength={1000} defaultValue={review?.note??''} key={`${issue.id}:${review?.reviewedAt??''}`} onBlur={e=>{if(e.target.value!==(review?.note??''))setState({...state,modelReviews:{...state.modelReviews,[issue.id]:{status:'pending',note:e.target.value,evidence:signature,reviewedAt:new Date().toISOString()}}});}}/></label>
      <button onClick={()=>setState({...state,modelReviews:{...state.modelReviews,[issue.id]:{status:review?.status==='reviewed'?'pending':'reviewed',note:review?.note??'',evidence:signature,reviewedAt:new Date().toISOString()}}})}>{review?.status==='reviewed'?'已复核 · 改为未复核':'标记已复核'}</button>
      {issue.repair&&<button onClick={()=>setState(repairIssue(state,issue))}>清理无效覆盖</button>}
    </article>;})}{!issues.length&&<p>本分类未发现问题；这不等于未标注施工节点已经核实。</p>}</div>
    <details><summary>合法洞口与结构封底</summary><p>{report.legalOpenings}个配置洞口（含窗、门、阳台敞口），{report.structuralClosures}个结构封底片/板。它们不作为缺面或室内可贴面。复核结果随保存方案保留；证据变化后需要重新复核。</p></details>
  </section>;
}
