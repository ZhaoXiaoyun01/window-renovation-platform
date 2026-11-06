import { buildingConfig as config } from '../config/building-config.ts';
import { editableBuildingFaces } from './model-surfaces.ts';
import { buildMaterialReport, reportTotals, type ReportLine } from './material-report.ts';
import { buildWindowReport, windowRowValues, windowReportTotals } from './window-report.ts';
import { resolveFaceFinish, faceSolids, faceFinishRegions } from './wall-surfaces.ts';
import { styleFingerprint, materialPrice } from './finish-actions.ts';
import { planeRect, pointBounds, worldPoint } from './geometry.ts';
import type { RenovationState, Vec3 } from '../types';
export function comparePlans(a:RenovationState,b:RenovationState){
 const faces=editableBuildingFaces(),ra=buildMaterialReport(faces,a),rb=buildMaterialReport(faces,b);
 function stockMap(rows:ReportLine[]){const grouped=new Map<string,ReportLine[]>();for(const row of rows){const m=row.material,key=JSON.stringify([m.kind??'tile',m.color.toLowerCase(),m.texture,m.image??'',Math.min(row.widthMm,row.heightMm),Math.max(row.widthMm,row.heightMm)]);grouped.set(key,[...(grouped.get(key)??[]),row]);}return new Map([...grouped].map(([key,items])=>[key,{...items[0],areaMm2:items.reduce((n,r)=>n+r.areaMm2,0),tiles:items.reduce((n,r)=>n+r.tiles,0),purchase:items.reduce((n,r)=>n+r.purchase,0),amountCents:items.reduce((n,r)=>n+r.amountCents,0),unitPrices:[...new Set(items.map(r=>r.unitPrice))].sort((x,y)=>x-y)}]));}
 const ma=stockMap(ra.summary),mb=stockMap(rb.summary);
 const materials=[...new Set([...ma.keys(),...mb.keys()])].map(key=>{const left=ma.get(key),right=mb.get(key),row=right??left!;return {key,name:row.material.name,color:row.material.color,spec:row.kind==='paint'?'漆面':`${row.widthMm}×${row.heightMm}`,a:left,b:right,area:(right?.areaMm2??0)/1e6-(left?.areaMm2??0)/1e6,tiles:(right?.tiles??0)-(left?.tiles??0),purchase:(right?.purchase??0)-(left?.purchase??0),amountCents:(right?.amountCents??0)-(left?.amountCents??0)};});
 const faceChanges=faces.flatMap(face=>{
   const signature=(s:RenovationState,prices:boolean)=>faceFinishRegions(face,s).map(r=>[r.face.rects,prices?materialPrice(s.materials.find(m=>m.id===r.finish.materialId)!):styleFingerprint(s.materials.find(m=>m.id===r.finish.materialId)!,r.finish,false)]);
   const appearanceChanged=JSON.stringify(signature(a,false))!==JSON.stringify(signature(b,false)),priceChanged=JSON.stringify(signature(a,true))!==JSON.stringify(signature(b,true));
   const prices=(s:RenovationState)=>[...new Set(faceFinishRegions(face,s).map(r=>materialPrice(s.materials.find(m=>m.id===r.finish.materialId)!)))];
   return appearanceChanged||priceChanged?[{...face,appearanceChanged,priceChanged,pricesA:prices(a),pricesB:prices(b)}]:[];
 });
 const wa=buildWindowReport(a),wb=buildWindowReport(b),windowChanges=wb.flatMap(right=>{const left=wa.find(w=>w.id===right.id)!;return JSON.stringify([windowRowValues(left),left.quote.label,left.quote.source,left.quote.date])===JSON.stringify([windowRowValues(right),right.quote.label,right.quote.source,right.quote.date])?[]:[{id:right.id,name:right.name,a:left,b:right,amountCents:(right.amountCents??0)-(left.amountCents??0)}];});
 return {materials,faceChanges,appearanceChanges:faceChanges.filter(f=>f.appearanceChanged),priceChanges:faceChanges.filter(f=>f.priceChanged),windowChanges,a:{materials:reportTotals(ra.summary),windows:windowReportTotals(wa)},b:{materials:reportTotals(rb.summary),windows:windowReportTotals(wb)}};
}
export function objectBounds(id:string){const face=editableBuildingFaces().find(f=>f.id===id);if(face){const boxes=faceSolids(face).map(r=>planeRect(face,r,face.offsetMm));return {owner:id,min:[0,1,2].map(i=>Math.min(...boxes.map(b=>b.min[i]))) as Vec3,max:[0,1,2].map(i=>Math.max(...boxes.map(b=>b.max[i]))) as Vec3};}
 const wall=config.walls.find(w=>w.openings.some(o=>o.id===id)),opening=wall?.openings.find(o=>o.id===id);if(!wall||!opening)throw new Error('定位对象不存在。');return {owner:id,...pointBounds([[opening.x,opening.y,0],[opening.x+opening.width,opening.y+opening.height,0]].map(p=>worldPoint(wall,p as Vec3)))};
}
