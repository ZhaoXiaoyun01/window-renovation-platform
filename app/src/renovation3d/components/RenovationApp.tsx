import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Box, Save, RotateCcw, Undo2, Redo2, ScanLine, Columns2, Package, FileImage } from 'lucide-react';
import { buildingConfig as config } from '../config/building-config';
import { BuildingScene, type CameraCommand } from '../scene/BuildingScene';
import { useRenovationStore } from '../store/useRenovationStore';
import { editableBuildingFaces, modelGroups } from '../utils/model-surfaces';
import { faceFinishRegions } from '../utils/wall-surfaces';
import { WindowReportDialog } from './WindowReportDialog';
import { matchesViewScope } from '../utils/view-groups';
import { aggregateTileQuantities, buildingTileQuantities, tileQuantityTotals } from '../utils/tile-quantities';
import { facadeLabels } from '../utils/units';
import { MaterialPanel } from './MaterialPanel';
import { WindowPanel } from './WindowPanel';
import { ScreenPanel } from './ScreenPanel';
import { HistoryPanel } from './HistoryPanel';
import { ViewControls, type ApplicationScope } from './ViewControls';
import { ColorSamplingProvider } from './ColorPicker';
import { MaterialReportDialog } from './MaterialReportDialog';
import type { Facade, View } from '../types';
import { ModelInspectionPanel } from './ModelInspectionPanel';
import type { ModelIssue } from '../utils/model-inspection';
import { ProcurementDialog } from './ProcurementDialog';
import { PlanComparisonDialog } from './PlanComparisonDialog';
import { ElevationDialog } from './ElevationDialog';

const faces = editableBuildingFaces();
const wallsById = new Map(config.walls.map(w => [w.id, w]));

function RenovationEditor() {
  const { state, setState, editor, message, setMessage, save, reset, history, busy, refreshHistory, loadPlan, renamePlan, planName, planId, dirty, draftStatus, drafts, recoverDraft, discardDraft, exportDraft, importDraft } = useRenovationStore();
  const [inspectionOpen,setInspectionOpen]=useState(false),[inspectionFaces,setInspectionFaces]=useState<string[]>([]),[inspectionBounds,setInspectionBounds]=useState<ModelIssue['bounds']>(),pointerEdit=useRef(false);
  const [procurementOpen,setProcurementOpen]=useState(false),[comparisonOpen,setComparisonOpen]=useState(false),[elevationOpen,setElevationOpen]=useState(false);
  const [reportOpen, setReportOpen] = useState(false), [windowsOpen, setWindowsOpen] = useState(false);
  const [highlightedMaterial, setHighlightedMaterial] = useState('');
  const [highlightedWindows, setHighlightedWindows] = useState<string[]>([]);
  const highlighted = useMemo(() => new Set([...inspectionFaces,...(highlightedMaterial ? faces.filter(face => faceFinishRegions(face, state).some(r => r.finish.materialId === highlightedMaterial)).map(f => f.id) : [])]), [inspectionFaces, highlightedMaterial, state.faceFinishes, state.finishes]);
  const [floor, setFloor] = useState('all'), [scope, setScope] = useState<ApplicationScope>('face'), [facade, setFacade] = useState<Facade>('front');
  const [selectedObject, setSelectedObject] = useState('');
  const [schemeRevision, setSchemeRevision] = useState(0);
  useEffect(() => setHighlightedWindows([]), [selectedObject, schemeRevision, planId]);
  function travelEdit(redo=false){ editor.travel(redo);setSchemeRevision(n=>n+1); }
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(!(event.ctrlKey||event.metaKey)||event.altKey||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true],.r3d-compare-dialog,.r3d-layout-dialog'))return;const key=event.key.toLowerCase();if(key==='z'||key==='y'){event.preventDefault();editor.travel(key==='y'||event.shiftKey);setSchemeRevision(n=>n+1);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[editor.travel]);
  const [command, setCommand] = useState<CameraCommand>({ view: 'perspective', sequence: 0 }), [ready, setReady] = useState(false);
  const selectedFace = faces.find(f => f.id === selectedObject);
  const targets = useMemo(() => faces.filter(f => scope === 'all' || (scope === 'face' ? f.id === selectedObject : (scope === 'floor' ? floor !== 'all' && matchesViewScope(f, floor) : matchesViewScope(f, floor) && f.facade === facade))), [scope, floor, facade, selectedObject]);
  const quantities = useMemo(() => buildingTileQuantities(faces, state), [state.finishes, state.faceFinishes, state.faceRegionFinishes, state.materials]);
  const rangeQuantities = useMemo(() => aggregateTileQuantities(targets.flatMap(face => quantities.byFace.get(face.id) ?? [])), [targets, quantities]);
  const stats = tileQuantityTotals(rangeQuantities,state.purchaseRules);
  function onView(view: View) { setInspectionBounds(undefined);setCommand(c => ({ view, sequence: c.sequence + 1 })); }
  function chooseFloor(id: string) { setFloor(id); setSelectedObject(''); setScope(id === 'all' ? 'all' : 'floor'); }
  function chooseObject(id: string, wallId?: string, faceId?: string) {
    setSelectedObject(faceId ?? id); setScope('face');
    const wall = wallId ? wallsById.get(wallId) : undefined;
    if (wall) { setFloor(selectedFaceGroup(faceId) ?? wall.viewGroup ?? wall.floorId); setFacade(wall.facade); }
    else { const part = config.parts.find(p => p.id === id); if (part) setFloor(part.viewGroup ?? part.floorId); }
  }
  function selectedFaceGroup(id?: string) { const face = faces.find(face => face.id === id); return face?.viewGroup ?? face?.floorId; }
  function clearSelection() { setSelectedObject(''); setScope('face'); }
  const objectWall = selectedFace ? wallsById.get(selectedFace.wallId) : config.walls.find(w => w.openings.some(o => o.id === selectedObject));
  const opening = objectWall?.openings.find(o => o.id === selectedObject);
  const part = config.parts.find(p => p.id === selectedObject);
  const objectFloor = modelGroups.find(group => group.id === (selectedFace?.viewGroup ?? objectWall?.viewGroup ?? part?.viewGroup)) ?? config.floors.find(f => f.id === (selectedFace?.floorId ?? objectWall?.floorId ?? part?.floorId));
  const faceLabel = selectedFace?.category === 'ceiling' ? '外顶面 / 阳台天花' : selectedFace?.category === 'floor' ? '室外地面' : selectedFace?.surfaceKind === 'exposed-surface' ? selectedFace.sourceWallIds.some(id => /entry-|front-step/.test(id)) ? '入户平台 / 阶梯面' : Math.abs(selectedFace.rotationX ?? 0) > 1 ? (selectedFace.rotationX! < 0 ? '外露顶面' : '外露底面 / 阳台顶面') : '外露板边 / 洞口侧面' : selectedFace?.surfaceKind === 'outdoor-floor' ? '室外地面' : selectedFace?.surfaceKind === 'relief-return' ? '6cm高差返边' : selectedFace?.surfaceKind === 'inner-wall' ? selectedFace.sourceWallIds.some(id => id.startsWith('f4-')) ? '露台凹口内侧' : selectedFace.sourceWallIds.some(id => id.includes('balcony-')) ? '阳台内侧' : '栏墙内侧' : selectedFace?.faceKey ? '独立块面' : selectedFace?.sourceWallIds.some(id => /porch-(left|right)$/.test(id)) ? '阳台内侧' : selectedFace?.sourceWallIds.some(id => id.endsWith('porch-back')) ? '阳台后墙' : selectedFace?.sourceWallIds.some(id => /^(roof-|terrace-)/.test(id)) ? '屋檐栏墙' : '外墙';
  const objectLabel = selectedFace ? `${faceLabel} · ${facadeLabels[selectedFace.facade]} · ${objectFloor?.label}` : opening ? `${opening.kind === 'door' ? '门' : '窗'} · ${objectFloor?.label}` : part ? `${{ slab: '楼板 / 屋面板', rail: '栏杆', step: '台阶', parapet: '栏墙', screen: '透光格栅' }[part.kind]} · ${objectFloor?.label}` : '';
  const objectSize = opening ? [opening.width, opening.height] : part ? part.sizeMm : undefined;
  const scopeLabel = scope === 'face' ? '选中面' : scope === 'all' ? '全楼' : `${floor === 'all' ? scope === 'floor' ? '请选择楼层' : '全楼' : (modelGroups.find(g => g.id === floor) ?? config.floors.find(f => f.id === floor))!.label}${scope === 'facade' ? ' · ' + facadeLabels[facade] : ''}`;
  function closeInspection(){setInspectionOpen(false);if(inspectionFaces.includes(selectedObject))clearSelection();setInspectionFaces([]);setInspectionBounds(undefined);if(inspectionBounds)setCommand(c=>({view:'perspective',sequence:c.sequence+1}));}
  useEffect(()=>{if(!inspectionOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))closeInspection();};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[inspectionOpen,inspectionFaces,inspectionBounds,selectedObject]);
  function locateIssue(issue:ModelIssue){setInspectionBounds(issue.bounds);setInspectionFaces(issue.faceIds);setState({...state,hiddenFloors:[],hiddenGroups:[],exploded:false});if(issue.faceIds[0])chooseObject(issue.faceIds[0],faces.find(f=>f.id===issue.faceIds[0])?.wallId,issue.faceIds[0]);setCommand(c=>({view:'perspective',sequence:c.sequence+1,focus:issue.bounds}));}
  return <div className="r3d-app" onFocusCapture={e=>{if((e.target as HTMLElement).matches('input:not([type=range]),textarea'))editor.begin();}} onBlurCapture={e=>{if(!pointerEdit.current&&(e.target as HTMLElement).matches('input:not([type=range]),textarea'))editor.end();}} onPointerDownCapture={e=>{if((e.target as HTMLElement).closest('.r3d-color-plane,input[type=range]')){pointerEdit.current=true;editor.begin();}}} onPointerUpCapture={()=>{if(pointerEdit.current){pointerEdit.current=false;editor.end();}}} onPointerCancelCapture={()=>{pointerEdit.current=false;editor.end();}}>
    <header className="r3d-header"><div className="r3d-brand"><Box size={23} strokeWidth={1.4}/><h1>3D装修效果演示 <small>4.1</small></h1></div>
      <div className="r3d-project-tools" aria-label="编辑与交付工具"><button aria-label="撤销编辑" title="撤销 Ctrl+Z；文本框内保留文本撤销" disabled={!editor.canUndo} onClick={()=>travelEdit()}><Undo2 size={15}/></button><button aria-label="重做编辑" title="重做 Ctrl+Y" disabled={!editor.canRedo} onClick={()=>travelEdit(true)}><Redo2 size={15}/></button><button onClick={()=>inspectionOpen?closeInspection():setInspectionOpen(true)} aria-pressed={inspectionOpen}><ScanLine size={15}/>模型检查</button><button onClick={()=>setComparisonOpen(true)}><Columns2 size={15}/>方案对比</button><button onClick={()=>setProcurementOpen(true)}><Package size={15}/>采购规则</button><button onClick={()=>setElevationOpen(true)}><FileImage size={15}/>立面排版图</button></div>
      <div className="r3d-header-actions"><a href="/" target="_blank" rel="noreferrer"><ArrowLeft size={15}/>门窗分析</a><button disabled={busy} onClick={() => { if(reset()){ closeInspection(); setSelectedObject(''); setScope('face'); setSchemeRevision(n => n + 1); } }}><RotateCcw size={15}/>默认方案</button><button className="r3d-save" disabled={busy} onClick={() => void save()}><Save size={15}/>{busy ? '处理中…' : '保存方案'}</button></div>
    </header>
    <ViewControls {...{ state, floor, setState, scope, setScope, facade, setFacade }} setFloor={chooseFloor} view={command.view} onView={onView} onZoom={zoom => setCommand(c => ({view:c.view,sequence:c.sequence+1,zoom}))} onReport={() => setReportOpen(true)} onWindows={() => setWindowsOpen(true)}/>
    {elevationOpen&&<ElevationDialog {...{state,planName}} onClose={()=>setElevationOpen(false)}/>}
    {procurementOpen&&<ProcurementDialog {...{state,setState}} onClose={()=>setProcurementOpen(false)}/>}
    {comparisonOpen&&<PlanComparisonDialog history={history} onClose={()=>setComparisonOpen(false)}/>}
    {reportOpen ? <MaterialReportDialog {...{ state, faces, planName,planId }} onClose={() => setReportOpen(false)}/> : null}
    {windowsOpen ? <WindowReportDialog {...{ state, setState, planName,planId }} onClose={() => setWindowsOpen(false)}/> : null}
    <div className="r3d-workspace"><section className="r3d-stage" aria-label="建筑3D场景">
      <div className="r3d-draft-overlay">
    <div className="r3d-edit-status" role="status" data-dirty={dirty}><strong>{dirty?'● 未保存为历史方案':'无未保存编辑'}</strong><span>{draftStatus}</span><button onClick={exportDraft}>导出草稿备份</button><label className="r3d-draft-import">导入草稿<input type="file" accept="application/json,.json" aria-label="导入独立草稿" onChange={e=>{const file=e.target.files?.[0];if(file)void importDraft(file).then(ok=>{if(ok){closeInspection();setSelectedObject('');setSchemeRevision(n=>n+1);}});e.target.value='';}}/></label></div>
    {drafts.length>0&&<details className="r3d-draft-recovery" open><summary>可恢复独立草稿 · {drafts.length}份（不包含撤销记录）</summary>{drafts.map(d=><div key={d.id}><span>{d.base?.name??'未保存方案'} · {new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date(d.updatedAt))}</span><button disabled={busy} onClick={()=>void recoverDraft(d.id).then(ok=>{if(ok){closeInspection();setSelectedObject('');setSchemeRevision(n=>n+1);}})}>恢复草稿</button><button disabled={busy} onClick={()=>discardDraft(d.id)}>丢弃草稿</button></div>)}</details>}
      </div>
      {inspectionOpen&&inspectionBounds&&<div className="r3d-inspection-helper" role="status">柔金色线框为检查定位辅助框，不是建筑实体</div>}
      <BuildingScene {...{ state, selectedObject, command, highlighted }} highlightedWindows={highlightedWindows} focusBounds={inspectionBounds} onSelect={chooseObject} onClearSelection={clearSelection} onReady={() => setReady(true)}/>
      {inspectionOpen&&<ModelInspectionPanel {...{state,setState}} onLocate={locateIssue} onClose={closeInspection}/>}
      {message ? <div className="r3d-notice" role="status">{message}</div> : null}
      {highlightedMaterial && <div className="r3d-highlight-status" role="status">同材质高亮 · {highlighted.size}个面（隐藏区域保持隐藏）<button onClick={() => setHighlightedMaterial('')}>取消高亮</button></div>}
      {highlightedWindows.length > 0 && <div className="r3d-highlight-status" role="status">同类型窗户高亮 · {highlightedWindows.length}樘（隐藏区域保持隐藏）<button onClick={() => setHighlightedWindows([])}>取消窗户高亮</button></div>}
    </section><aside className="r3d-panel">
      {part?.kind === 'screen' ? <ScreenPanel {...{ part, state, setState }}/> : opening && opening.kind !== 'balcony' ? <WindowPanel key={`${schemeRevision}:${opening.id}`} {...{ opening, state, setState, highlightedWindows }} onHighlight={ids => { setHighlightedMaterial(''); setHighlightedWindows(ids); }} onMessage={setMessage}/> : <MaterialPanel key={schemeRevision} {...{ state, setState, targets, selectedFace, objectLabel, objectSize, selectedObject, stats, rangeQuantities }} allQuantities={quantities.all} onMessage={setMessage} highlightedMaterial={highlightedMaterial} onHighlight={id => { setHighlightedWindows([]); setHighlightedMaterial(id); }} scopeLabel={scopeLabel}/>}
      <HistoryPanel {...{ history, busy }} onRefresh={refreshHistory} onLoad={async id => { const success = await loadPlan(id); if (success) { closeInspection(); setSelectedObject(''); setScope('face'); setFloor('all'); setSchemeRevision(n => n + 1); } return success; }} onRename={renamePlan}/>
    </aside></div>
    <footer className="r3d-footer"><span>{ready ? '场景就绪' : '场景加载中'} · 拖动旋转 / 滚轮缩放 / 右键平移</span><span>{config.floors.length - state.hiddenFloors.length} 层可见{state.hiddenGroups?.includes('terrace') ? ' · 露台/屋顶已隐藏' : ''} · 本机方案</span></footer>
  </div>;
}

export default function RenovationApp() { return <ColorSamplingProvider><RenovationEditor/></ColorSamplingProvider>; }
