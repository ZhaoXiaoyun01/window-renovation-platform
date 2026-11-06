import { storageKey,validateState } from '../utils/validation.ts';
import type { RenovationState } from '../types';
export const draftIndexKey=`${storageKey}:drafts:1`;
export type DraftInfo={id:string;updatedAt:string;base?:{id:string;name:string}};
export function listDrafts():DraftInfo[]{
 const raw=localStorage.getItem(draftIndexKey);if(!raw)return [];
 const items=JSON.parse(raw);if(!Array.isArray(items)||items.some(d=>!d||typeof d.id!=='string'||!/^[\w-]+$/.test(d.id)||typeof d.updatedAt!=='string'||d.base&&(!d.base.id||typeof d.base.name!=='string')))throw new Error('草稿目录无法读取，原内容保留。');return items;
}
export function writeDraft(info:DraftInfo,state:RenovationState){
 const items=listDrafts();localStorage.setItem(`${draftIndexKey}:${info.id}`,JSON.stringify(state));
 localStorage.setItem(draftIndexKey,JSON.stringify([info,...items.filter(d=>d.id!==info.id)]));
}
export function readDraft(id:string){if(!listDrafts().some(d=>d.id===id))throw new Error('草稿不存在。');const raw=localStorage.getItem(`${draftIndexKey}:${id}`);if(!raw)throw new Error('草稿内容无法读取，目录保留。');return validateState(JSON.parse(raw));}
export function removeDraft(id:string){const items=listDrafts();localStorage.setItem(draftIndexKey,JSON.stringify(items.filter(d=>d.id!==id)));localStorage.removeItem(`${draftIndexKey}:${id}`);}
