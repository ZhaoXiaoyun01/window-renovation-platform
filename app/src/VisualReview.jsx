import {useRef,useState} from 'react';

const labels={confirmed:'已确认线索',rejected:'不认可线索',uncertain:'无法核实',manual_risk:'人工标注风险'};

export function pendingChecks(document){
 return (document.visual_reports||[]).filter(report=>report.document_type==='样角').flatMap(report=>report.checks.filter(check=>!labels[check.review?.decision]));
}

export default function VisualReview({document,report,busy,onReview}){
 const [activeId,setActiveId]=useState(report.checks[0]?.id);
 const [drafts,setDrafts]=useState({});
 const drag=useRef(null);
 const active=report.checks.find(check=>check.id===activeId)||report.checks[0];
 const draft=drafts[active?.id]||{};
 const region=draft.region===undefined?(active?.review?.region||active?.region):draft.region;
 const decision=draft.decision??active?.review?.decision??'';
 const note=draft.note??active?.review?.note??'';
 const setDraft=change=>setDrafts(items=>({...items,[active.id]:{...items[active.id],...change}}));
 const point=event=>{const rect=event.currentTarget.getBoundingClientRect();return {x:Math.round(Math.max(0,Math.min(1000,(event.clientX-rect.left)/rect.width*1000))),y:Math.round(Math.max(0,Math.min(1000,(event.clientY-rect.top)/rect.height*1000)))}};
 function move(event){if(!drag.current)return;const now=point(event),start=drag.current;setDraft({region:{x:Math.min(start.x,now.x),y:Math.min(start.y,now.y),width:Math.abs(now.x-start.x),height:Math.abs(now.y-start.y)}})}
 function end(event){if(!drag.current)return;const now=point(event),start=drag.current;drag.current=null;event.currentTarget.releasePointerCapture(event.pointerId);if(Math.abs(now.x-start.x)<5||Math.abs(now.y-start.y)<5)setDraft({region:null})}
 if(report.document_type!=='样角')return null;
 return <div className="visual-review"><div className="visual-review-head"><h4>样角逐项核对 · {report.checks.filter(check=>labels[check.review?.decision]).length}/{report.checks.length}</h4><small>点击检查项，再在原图上拖选对应部位。模型框选只是定位线索，须对照原图确认。</small></div>
 <div className="visual-review-grid"><div className="evidence-image"><img src={'/api/documents/'+document.id+'/pages/'+report.page+'/preview'} alt={document.name+' 第 '+report.page+' 页原图'}/><div className="image-hit" role="img" aria-label="拖动标注当前检查项的图像证据位置" onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);drag.current=point(event);setDraft({region:null})}} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>{region&&region.width>0&&region.height>0?<span className="evidence-box" style={{left:region.x/10+'%',top:region.y/10+'%',width:region.width/10+'%',height:region.height/10+'%'}}/>:null}</div></div>
 <div className="visual-checks">{report.checks.map(check=><button key={check.id} type="button" className={'visual-check'+(check.id===active?.id?' selected':'')} onClick={()=>setActiveId(check.id)}><span>{check.title}</span><small>{labels[check.review?.decision]||'待逐项确认'} · {check.status}</small></button>)}</div></div>
 {active?<div className="visual-decision"><h4>{active.title}</h4><p>模型观察：{active.status}。{active.evidence}</p><p className="muted">{active.advice}</p><label className="field"><span>核对结论</span><select aria-label={active.title+' 核对结论'} value={decision} onChange={event=>setDraft({decision:event.target.value})}><option value="">请选择</option>{active.status!=='未确定'?<><option value="confirmed">确认图中线索</option><option value="rejected">不认可图中线索</option></>:null}<option value="uncertain">无法核实，保持未确定</option><option value="manual_risk">人工标注可见风险</option></select></label><label className="field"><span>可见依据或核对说明</span><textarea aria-label={active.title+' 核对说明'} rows="2" maxLength="500" value={note} onChange={event=>setDraft({note:event.target.value})} placeholder="人工风险须说明图中可见部位；其他结论可备注原因"/></label><div className="visual-review-actions"><button type="button" onClick={()=>setDraft({region:null})}>清除标注</button><button type="button" className="primary" disabled={busy||!decision||((decision==='confirmed'||decision==='manual_risk')&&!region)|| (decision==='manual_risk'&&note.trim().length<10)} onClick={()=>onReview(document,report,active,{decision,note,region})}>保存本项核对</button><small>确认模型线索或人工记录风险时，必须定位到原图。无法判断可选“无法核实”。</small></div></div>:null}</div>;
}
