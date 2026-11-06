import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { buildMaterialReport } from '../utils/material-report';
import { defaultPurchaseRule, validatePurchaseRule } from '../utils/purchasing';
import { editableBuildingFaces } from '../utils/model-surfaces';
import type { PurchaseRule, RenovationState, TileMaterial } from '../types';

function RuleRow({material,rule,onSave}:{material:TileMaterial;rule:PurchaseRule;onSave:(r:PurchaseRule)=>void}){
 const [draft,setDraft]=useState(rule),[error,setError]=useState('');useEffect(()=>setDraft(rule),[rule]);const paint=material.kind==='paint';
 return <tr><th>{material.name}</th><td><input aria-label={`${material.id}预留比例`} type="number" min="0" max="100" step=".01" value={draft.reservePercent} onChange={e=>setDraft({...draft,reservePercent:Number(e.target.value)})}/></td><td><input aria-label={`${material.id}每箱片数`} type="number" min="1" max="10000" step="1" disabled={paint} value={draft.piecesPerBox} onChange={e=>setDraft({...draft,piecesPerBox:Number(e.target.value)})}/></td><td><input aria-label={`${material.id}整箱采购`} type="checkbox" disabled={paint} checked={draft.fullBoxes} onChange={e=>setDraft({...draft,fullBoxes:e.target.checked})}/></td><td><button onClick={()=>{try{onSave(validatePurchaseRule(draft));setError('');}catch(e){setError((e as Error).message);}}}>应用规则</button>{error&&<p role="alert">{error}</p>}</td></tr>;
}
export function ProcurementDialog({state,setState,onClose}:{state:RenovationState;setState:(s:RenovationState)=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),report=useMemo(()=>buildMaterialReport(editableBuildingFaces(),state),[state]);
 useEffect(()=>{const el=dialog.current!,previous=document.activeElement as HTMLElement;el.showModal();return()=>{el.close();previous?.focus();};},[]);
 const materials=state.materials.filter(m=>report.summary.some(r=>r.materialId===m.id));
 return <dialog ref={dialog} className="r3d-report-dialog" aria-label="采购规则" onCancel={onClose}><div className="r3d-report-head"><div><h2>采购规则</h2><p>按材料配置，随方案保存；同种材料不同规格分别计算装箱</p></div><button aria-label="关闭采购规则" onClick={onClose}><X size={18}/></button></div><div className="r3d-report-body">
 <p className="r3d-report-note">计算片数 → 按预留比例向上取整 → 启用时按整箱进位。切割余料不跨面复用。旧方案默认5%预留、散片；漆面默认0%，仅面积估算，未提供涂布率时不推算桶数。</p>
 <div className="r3d-report-scroll"><table className="r3d-report-table r3d-rule-table"><thead><tr><th>材料</th><th>预留 %</th><th>每箱片数</th><th>整箱采购</th><th>操作</th></tr></thead><tbody>{materials.map(m=><RuleRow key={m.id} material={m} rule={state.purchaseRules?.[m.id]??defaultPurchaseRule(m.kind==='paint')} onSave={rule=>setState({...state,purchaseRules:{...state.purchaseRules,[m.id]:rule}})}/>)}</tbody></table></div>
 <div className="r3d-report-scroll"><table className="r3d-report-table"><caption>整楼合并采购 · 实时结果</caption><thead><tr><th>材料</th><th>规格 mm</th><th>净面积 ㎡</th><th>计算片数</th><th>预留后片数</th><th>箱数</th><th>采购片数</th><th>采购面积 ㎡</th><th>预算 元</th></tr></thead><tbody>{report.summary.map(r=><tr key={r.key} data-purchase-row={r.materialId}><th>{r.material.name}</th><td>{r.kind==='paint'?'漆面':`${r.widthMm}×${r.heightMm}`}</td><td>{(r.areaMm2/1e6).toFixed(3)}</td><td>{r.tiles||'—'}</td><td>{r.reserved||'—'}</td><td>{r.boxes||'散片/不适用'}</td><td>{r.purchase||'—'}</td><td>{r.purchaseArea.toFixed(3)}</td><td>{(r.amountCents/100).toFixed(2)}</td></tr>)}</tbody></table></div><p className="r3d-report-note">分层采购与整楼合并采购分别进位，结果可能不同；材料与价格表及Excel沿用相同规则。</p></div></dialog>;
}
