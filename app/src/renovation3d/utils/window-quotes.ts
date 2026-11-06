import { buildingConfig as config } from '../config/building-config.ts';
import { windowDesignFor, windowModeLabels } from '../config/window-config.ts';
import { windowGeometry, resolveWindowFinish } from './window-finishes.ts';
import type { Opening, RenovationState, WindowFinish, WindowQuote } from '../types';
import { validateGlassUpgrade } from './glass-upgrades.ts';
export const quoteLabels = { estimate:'默认/人工估价',merchant:'商家报价',confirmed:'已确认报价',stale:'配置或价格已变更 · 待重核' };
export function quoteConfiguration(opening:Opening,finish:WindowFinish){return {openingId:opening.id,widthMm:opening.width,heightMm:opening.height,frameColor:finish.frameColor.toLowerCase(),glassType:finish.glassType,mode:windowModeLabels[windowDesignFor(opening).mode],sashCount:finish.sashCount??windowGeometry(opening).panes.filter(p=>p.operable).length,pricePerM2:finish.pricePerM2??500,sashPrice:finish.sashPrice??500,...(finish.glassUpgrade?{glassUpgrade:{...finish.glassUpgrade}}:{})};}
export const configurationKey = (c:WindowQuote['configuration'])=>JSON.stringify([c.openingId,c.widthMm,c.heightMm,c.frameColor.toLowerCase(),c.glassType,c.mode,c.sashCount,c.pricePerM2,c.sashPrice,c.glassUpgrade?.spec??'',c.glassUpgrade?.pricePerM2??0]);
export function quoteInfo(opening:Opening,finish:WindowFinish){const record=finish.quotes?.at(-1),matches=!!record&&configurationKey(record.configuration)===configurationKey(quoteConfiguration(opening,finish));return {record,status:record?(matches?record.status:'stale'):'estimate',label:record?(matches?quoteLabels[record.status]:quoteLabels.stale):'默认/历史估价（来源未核实）',source:record?.source??'未记录来源',date:record?.date??'未记录',matches};}
export function recordWindowQuote(state:RenovationState,id:string,status:WindowQuote['status'],source:string,date:string,checked:boolean){
 const opening=config.walls.flatMap(w=>w.openings).find(o=>o.id===id&&o.kind==='window');if(!opening)throw new Error('窗户不存在。');
 const finish=resolveWindowFinish(opening,state);
 const quote:WindowQuote={id:crypto.randomUUID(),status,source:source.trim(),date,checked,configuration:quoteConfiguration(opening,finish)};
 validateQuotes([quote]);return {...state,windowFinishes:{...state.windowFinishes,[id]:{...finish,quotes:[...(finish.quotes??[]),quote]}}};
}
export function validateQuotes(quotes:WindowQuote[]){
 if(!Array.isArray(quotes)||new Set(quotes.map(q=>q?.id)).size!==quotes.length)throw new Error('报价记录无效。');
 for(const q of quotes)validateGlassUpgrade(q?.configuration?.glassUpgrade);
 for(const q of quotes){const c=q?.configuration;if(!q||typeof q.id!=='string'||!q.id||q.id.length>100||!['estimate','merchant','confirmed'].includes(q.status)||typeof q.source!=='string'||!q.source.trim()||q.source.length>300||!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||!Number.isFinite(Date.parse(q.date))||new Date(q.date).toISOString().slice(0,10)!==q.date||typeof q.checked!=='boolean'||q.status==='confirmed'&&!q.checked||!c||typeof c.openingId!=='string'||!c.openingId||!/^#[0-9a-f]{6}$/i.test(c.frameColor)||!['low','medium','high'].includes(c.glassType)||typeof c.mode!=='string'||!c.mode||c.mode.length>40||![c.widthMm,c.heightMm].every(n=>Number.isFinite(n)&&n>0&&n<=20000)||![c.pricePerM2,c.sashPrice].every(n=>Number.isFinite(n)&&n>=0&&n<=1000000)||!Number.isInteger(c.sashCount)||c.sashCount<0||c.sashCount>100)throw new Error('报价来源、日期、配置或确认状态无效。');}
}
