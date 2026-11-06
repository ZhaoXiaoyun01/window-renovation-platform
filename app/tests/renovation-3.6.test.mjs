import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingConfig as c} from '../src/renovation3d/config/building-config.ts';
import {validateState,storageKey} from '../src/renovation3d/utils/validation.ts';
import {EditHistory,sameEdits} from '../src/renovation3d/utils/edit-history.ts';
import {listDrafts,writeDraft,readDraft,removeDraft,draftIndexKey} from '../src/renovation3d/store/drafts.ts';
import {recordWindowQuote} from '../src/renovation3d/utils/window-quotes.ts';
import {comparePlans} from '../src/renovation3d/utils/plan-comparison.ts';
import {replaceFaces} from '../src/renovation3d/utils/finish-actions.ts';
import {editableBuildingFaces} from '../src/renovation3d/utils/model-surfaces.ts';
import {faceGridWall,resolveFaceFinish} from '../src/renovation3d/utils/wall-surfaces.ts';
import {buildMaterialReport,reportExportPayload} from '../src/renovation3d/utils/material-report.ts';
import {purchaseExplanation} from '../src/renovation3d/utils/purchasing.ts';
import {elevationLayout} from '../src/renovation3d/utils/elevation-layout.ts';
import {tileDimensions} from '../src/renovation3d/tile-layout/layout.ts';
import {worldPoint} from '../src/renovation3d/utils/geometry.ts';
const seed=()=>validateState({schemaVersion:1,faceGroupingVersion:7,buildingId:c.id,materials:c.materials,finishes:Object.fromEntries(c.walls.map(w=>[w.id,{...c.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}])),hiddenFloors:[],exploded:false});
test('undo and dirty comparisons skip unchanged image branches and never serialize the state',()=>{
 const s=seed(),journal=new EditHistory(s),stringify=JSON.stringify;let calls=0;JSON.stringify=(...args)=>{calls++;return stringify(...args);};
 try{journal.begin();for(let i=0;i<30;i++)journal.update({...s,partColors:{screen:'#'+String(i).padStart(6,'0')}});journal.end();assert.equal(journal.past.length,1);assert.equal(sameEdits(journal.current,s),false);journal.travel();assert.ok(sameEdits(journal.current,s));assert.ok(sameEdits({...s,hiddenFloors:['f2']},s));assert.equal(calls,0);}finally{JSON.stringify=stringify;}
});
test('independent draft slots recover validated state and never overwrite legacy/history caches or other slots',()=>{
 const memory=new Map([[storageKey,'legacy-cache']]),old=globalThis.localStorage;globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 try{const s=seed();writeDraft({id:'a',updatedAt:'2026-10-25T00:00:00Z'},s);writeDraft({id:'b',updatedAt:'2026-10-25T00:00:01Z',base:{id:'saved-id',name:'旧方案'}},{...s,partColors:{[c.parts.find(p=>p.kind==='screen').id]:'#123456'}});assert.deepEqual(listDrafts().map(d=>d.id),['b','a']);assert.deepEqual(readDraft('a'),s);assert.equal(readDraft('b').partColors[c.parts.find(p=>p.kind==='screen').id],'#123456');removeDraft('b');assert.equal(readDraft('a').buildingId,s.buildingId);assert.equal(memory.get(storageKey),'legacy-cache');memory.set(draftIndexKey,'broken');assert.throws(()=>writeDraft({id:'c',updatedAt:'today'},s));assert.equal(memory.get(draftIndexKey),'broken');}finally{globalThis.localStorage=old;}
});
test('quote 21 and later records append without losing any previous configuration and survive old-state validation',()=>{
 let s=seed();for(let i=0;i<22;i++)s=recordWindowQuote(s,'f1-s-window','merchant','QA-'+i,'2026-10-25',false);
 assert.equal(s.windowFinishes['f1-s-window'].quotes.length,22);assert.deepEqual(validateState(s).windowFinishes['f1-s-window'].quotes.map(q=>q.source),Array.from({length:22},(_,i)=>'QA-'+i));
});
test('price copies compare as the same appearance stock and expose exact before and after prices',()=>{
 const a=seed(),face=editableBuildingFaces().find(f=>f.id==='f1-right:face:0'),finish=resolveFaceFinish(face,a),m=a.materials.find(m=>m.id===finish.materialId),copy={...m,id:'price-copy',pricePerM2:150};
 const b=replaceFaces({...a,materials:[...a.materials,copy]},[face],{...finish,materialId:copy.id,preserveZoning:false}),diff=comparePlans(a,b);
 assert.equal(diff.appearanceChanges.length,0);assert.equal(diff.priceChanges.length,1);assert.deepEqual(diff.priceChanges[0].pricesA,[120]);assert.deepEqual(diff.priceChanges[0].pricesB,[150]);assert.equal(diff.materials.length,comparePlans(a,a).materials.length);assert.ok(diff.materials.some(r=>r.b.unitPrices.includes(150)));assert.ok(diff.b.materials.amountCents>diff.a.materials.amountCents);
});
test('report stock rows carry actual material codes, colours and boxes with explainable rounding',()=>{
 const s=seed();s.purchaseRules={ivory:{reservePercent:12.5,piecesPerBox:8,fullBoxes:true}};const report=buildMaterialReport(editableBuildingFaces(),s),row=report.summary.find(r=>r.materialId==='ivory'),payload=reportExportPayload(report,'3.6','2026-10-25');assert.equal(row.purchase,row.boxes*8);assert.ok(row.codes.length);assert.ok(payload.rows.every(r=>r.codes.length));assert.ok(row.codes.every(code=>report.catalog.some(c=>c.code===code&&c.color===row.material.color)));assert.match(purchaseExplanation(100,s.purchaseRules.ivory),/12.5%.*112.5片.*113片.*15箱.*120片/);assert.equal(payload.metadata.applicationVersion,'4.1');
});
test('elevation origins use actual layout datums and chains plus local details remain explicitly unverified',()=>{
 const s=seed(),faces=editableBuildingFaces(),drawing=elevationLayout(s,'right','测试','2026-10-25');assert.ok(drawing.origins.length>0);assert.ok(drawing.detailIds.length>0);assert.match(drawing.svg,/起铺原点/);assert.match(drawing.svg,/投影尺寸链/);assert.match(drawing.svg,/data-detail=/);
 for(const o of drawing.origins){const face=faces.find(f=>f.id===o.faceId),finish=resolveFaceFinish(face,s),wall=faceGridWall(face,c.walls),grid=wall.tileGridBoundsMm??{x:0,y:0,width:wall.widthMm,height:wall.heightMm},{width,height}=tileDimensions(finish),phase=(size,pitch)=>finish.alignment==='edge'?0:(size-(Math.ceil((size+finish.groutMm)/pitch)*pitch-finish.groutMm))/2,expected=worldPoint(face,[grid.x+phase(grid.width,width+finish.groutMm),grid.y+phase(grid.height,height+finish.groutMm),face.offsetMm+Math.max(1,face.claddingMm??c.scene.tileDepthMm)]);assert.ok(expected.every((v,i)=>Math.abs(v-o.world[i])<1e-5));}
 for(const chain of drawing.chains)assert.ok(Math.abs(chain.segments.reduce((a,b)=>a+b,0)-((chain.marks.at(-1)??0)-(chain.marks[0]??0)))<1e-4);
});
