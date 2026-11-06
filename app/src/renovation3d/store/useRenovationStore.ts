import { useEffect, useMemo, useRef, useState } from 'react';
import { buildingConfig as config } from '../config/building-config';
import { storageKey, validateState } from '../utils/validation';
import { createPlan, listPlans, readPlan, renameSavedPlan, type PlanMetadata } from './plans-api';
import { listDrafts,writeDraft,readDraft,removeDraft,type DraftInfo } from './drafts';
import { sameEdits } from '../utils/edit-history';
import type { RenovationState } from '../types';
import { useEditHistory } from './useEditHistory';

export const defaultState = (): RenovationState => validateState({ schemaVersion: 1, faceGroupingVersion: 7, buildingId: config.id, materials: config.materials.map(m => ({ ...m })), hiddenFloors: [], hiddenGroups: [], exploded: false, faceFinishes: {}, faceRegionFinishes: {}, windowFinishes: {},
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });
const savedMetaKey=`${storageKey}:saved-meta`;
function restore() {
  let state=defaultState(),plan: {id:string;name:string}|undefined,message='',drafts:DraftInfo[]=[];
  try{const saved=localStorage.getItem(storageKey);if(saved){state=validateState(JSON.parse(saved));message='已恢复上次手动保存的本机缓存。';}const meta=JSON.parse(localStorage.getItem(savedMetaKey)??'null');if(meta&&typeof meta.id==='string'&&typeof meta.name==='string')plan=meta;}catch{message='本机缓存无法读取，原内容保留；已使用默认方案。';}
  try{drafts=listDrafts();}catch{message+=' 草稿目录无法读取，原内容保留。';}
  return {state,plan,drafts,message};
}
export function useRenovationStore() {
  const [initial]=useState(restore),editor=useEditHistory(initial.state),{state,setState}=editor;
  const [message,setMessage]=useState(initial.message),[history,setHistory]=useState<PlanMetadata[]>([]),[busy,setBusy]=useState(false);
  const [activePlan,setActivePlan]=useState<{id:string;name:string}|undefined>(initial.plan),[baseline,setBaseline]=useState<RenovationState|null>(initial.state);
  const [draftId,setDraftId]=useState<string>(()=>crypto.randomUUID()),[drafts,setDrafts]=useState<DraftInfo[]>(initial.drafts),[draftStatus,setDraftStatus]=useState('');
  const dirty=useMemo(()=>!baseline||!sameEdits(state,baseline),[state,baseline]),operation=useRef(false);
  const latest=useRef({state,dirty,draftId,activePlan});latest.current={state,dirty,draftId,activePlan};
  function persistDraft(){
    const current=latest.current;if(!current.dirty)return true;
    try{writeDraft({id:current.draftId,updatedAt:new Date().toISOString(),base:current.activePlan},current.state);setDrafts(listDrafts());setDraftStatus('独立草稿已自动保存');return true;}
    catch{setDraftStatus('草稿保存失败：浏览器存储不足或不可用，请导出草稿备份');return false;}
  }
  useEffect(()=>{if(!dirty){try{if(listDrafts().some(d=>d.id===draftId)){removeDraft(draftId);setDrafts(listDrafts());}setDraftStatus('');}catch{setDraftStatus('旧草稿清理未完成，原内容保留');}return;}setDraftStatus('正在等待保存独立草稿…');const timer=setTimeout(persistDraft,700);return()=>clearTimeout(timer);},[state,dirty,draftId,activePlan]);
  useEffect(()=>{
    const leave=(event:BeforeUnloadEvent)=>{if(latest.current.dirty){persistDraft();event.preventDefault();event.returnValue='';}};
    const hide=()=>{if(document.visibilityState==='hidden')persistDraft();};
    window.addEventListener('beforeunload',leave);window.addEventListener('pagehide',persistDraft);document.addEventListener('visibilitychange',hide);
    return()=>{window.removeEventListener('beforeunload',leave);window.removeEventListener('pagehide',persistDraft);document.removeEventListener('visibilitychange',hide);};
  },[]);
  function beforeSwitch(){return !latest.current.dirty||window.confirm('当前修改尚未保存为历史方案。保留独立草稿后继续切换？')&&persistDraft();}
  async function run(action:()=>Promise<void>){if(operation.current)return false;operation.current=true;setBusy(true);try{await action();return true;}catch(error){setMessage(error instanceof Error?error.message:'本地方案操作失败。');return false;}finally{operation.current=false;setBusy(false);}}
  async function refreshHistory(){return run(async()=>setHistory(await listPlans()));}
  useEffect(()=>{void refreshHistory();},[]);
  async function save(name?:string){return run(async()=>{
    const snapshot=validateState(state),savedDraftId=draftId,saved=await createPlan(typeof name==='string'&&name.trim()?name.trim():`装修方案 ${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date())}`,snapshot);
    const {id,name:savedName,createdAt,updatedAt}=saved;setActivePlan({id,name:savedName});setBaseline(snapshot);setHistory(items=>[{id,name:savedName,createdAt,updatedAt},...items]);
    try{localStorage.setItem(storageKey,JSON.stringify(snapshot));localStorage.setItem(savedMetaKey,JSON.stringify({id,name:savedName}));if(sameEdits(latest.current.state,snapshot))removeDraft(savedDraftId);setDrafts(listDrafts());setMessage(`已保存新方案「${savedName}」。`);}
    catch{setMessage(`方案「${savedName}」已存历史；浏览器缓存或草稿清理未完成，原草稿保留。`);}
  });}
  async function loadPlan(id:string){if(!beforeSwitch())return false;return run(async()=>{const started=latest.current.state,saved=await readPlan(id),restored=validateState(saved.state);if(latest.current.state!==started&&!beforeSwitch())throw new Error('已取消切换，当前编辑保留。');setActivePlan({id,name:saved.name});setBaseline(restored);setDraftId(crypto.randomUUID());editor.replace(restored);try{localStorage.setItem(storageKey,JSON.stringify(restored));localStorage.setItem(savedMetaKey,JSON.stringify({id,name:saved.name}));}catch{setDraftStatus('已加载方案，但浏览器起点缓存未更新');}setMessage(`已加载「${saved.name}」；修改后保存为新方案。`);});}
  async function recoverDraft(id:string){if(!beforeSwitch())return false;return run(async()=>{
    const started=latest.current.state,info=listDrafts().find(d=>d.id===id);if(!info)throw new Error('草稿不存在。');const restored=readDraft(id);let source:RenovationState|null=null;
    if(info.base)try{source=validateState((await readPlan(info.base.id)).state);}catch{/* A missing source never blocks recovery of its independent draft. */}
    if(latest.current.state!==started&&!beforeSwitch())throw new Error('已取消恢复，当前编辑保留。');setBaseline(source);setActivePlan(info.base);setDraftId(id);editor.replace(restored);setMessage('已恢复独立草稿；撤销栈重新开始，历史方案未改变。');
  });}
  function discardDraft(id:string){if(!window.confirm('丢弃此独立草稿？已保存的历史方案和材料库不受影响。'))return;try{removeDraft(id);setDrafts(listDrafts());}catch{setMessage('草稿清理失败，原内容保留。');}}
  function exportDraft(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),base:activePlan,state},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='装修4.1-独立草稿.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function importDraft(file:File){if(!beforeSwitch())return false;return run(async()=>{if(file.size>60000000)throw new Error('草稿文件过大。');const data=JSON.parse(await file.text());if(data.version!==1)throw new Error('不支持此草稿格式，当前内容未更改。');const restored=validateState(data.state);setBaseline(null);setActivePlan(undefined);setDraftId(crypto.randomUUID());editor.replace(restored);setMessage('已导入独立草稿；请保存为历史方案。');});}
  async function renamePlan(id:string,name:string){return run(async()=>{const saved=await renameSavedPlan(id,name);setActivePlan(current=>current?.id===id?{id,name:saved.name}:current);setHistory(items=>items.map(item=>item.id===id?{id,name:saved.name,createdAt:saved.createdAt,updatedAt:saved.updatedAt}:item));setMessage(`已重命名为「${saved.name}」。`);});}
  function reset(){if(!beforeSwitch())return false;const defaults=defaultState();editor.replace(defaults);setBaseline(defaults);setActivePlan(undefined);setDraftId(crypto.randomUUID());try{localStorage.removeItem(storageKey);localStorage.removeItem(savedMetaKey);setMessage('已恢复默认；历史方案、材料库和独立草稿保留。');}catch{setMessage('已恢复默认，但本机起点缓存未清除；刷新可能恢复上次缓存。');}return true;}
  return {state,setState,editor,message,setMessage,history,busy,refreshHistory,save,loadPlan,renamePlan,reset,planName:activePlan?.name??'当前编辑方案',planId:activePlan?.id,dirty,draftStatus,drafts:drafts.filter(d=>d.id!==draftId),recoverDraft,discardDraft,exportDraft,importDraft};
}
