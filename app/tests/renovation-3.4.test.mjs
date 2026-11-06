import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as c } from '../src/renovation3d/config/building-config.ts';
import { validateState } from '../src/renovation3d/utils/validation.ts';
import { purchaseQuantity,validatePurchaseRule } from '../src/renovation3d/utils/purchasing.ts';
import { buildMaterialReport,reportExportPayload } from '../src/renovation3d/utils/material-report.ts';
import { editableBuildingFaces } from '../src/renovation3d/utils/model-surfaces.ts';
import { recordWindowQuote,quoteInfo } from '../src/renovation3d/utils/window-quotes.ts';
import { resolveWindowFinish } from '../src/renovation3d/utils/window-finishes.ts';
import { updateWindow } from '../src/renovation3d/utils/window-report.ts';
import { comparePlans } from '../src/renovation3d/utils/plan-comparison.ts';
const seed=()=>validateState({schemaVersion:1,faceGroupingVersion:7,buildingId:c.id,materials:c.materials,finishes:Object.fromEntries(c.walls.map(w=>[w.id,{...c.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}])),hiddenFloors:[],exploded:false});
test('purchase rules round reserve before boxes and preserve old five-percent defaults',()=>{
 assert.deepEqual(purchaseQuantity(100,{reservePercent:5,piecesPerBox:8,fullBoxes:true}),{reserved:105,boxes:14,purchase:112});
 assert.equal(purchaseQuantity(10001,{reservePercent:.01,piecesPerBox:1,fullBoxes:false}).purchase,10003);
 assert.equal(purchaseQuantity(100).purchase,105);assert.throws(()=>validatePurchaseRule({reservePercent:5.001,piecesPerBox:8,fullBoxes:true}));
 const s=seed();s.purchaseRules={ivory:{reservePercent:10,piecesPerBox:16,fullBoxes:true}};const r=buildMaterialReport(editableBuildingFaces(),s),row=r.summary.find(r=>r.materialId==='ivory');assert.equal(row.purchase%16,0);assert.ok(row.purchase>=Math.ceil(row.tiles*1.1));assert.deepEqual(reportExportPayload(r,'方案','日期').materials.find(m=>m.id==='ivory').purchaseRule,s.purchaseRules.ivory);assert.deepEqual(validateState(s).purchaseRules,s.purchaseRules);
});
test('quotes bind real configuration and price source, preserve history and become stale after edits',()=>{
 let s=seed();const opening=c.walls.flatMap(w=>w.openings).find(o=>o.id==='f1-s-window');assert.match(quoteInfo(opening,resolveWindowFinish(opening,s)).label,/估价/);
 assert.throws(()=>recordWindowQuote(s,opening.id,'confirmed','商家A 单号Q1','2026-10-23',false));
 s=recordWindowQuote(s,opening.id,'merchant','商家A 单号Q1','2026-10-23',false);assert.equal(quoteInfo(opening,resolveWindowFinish(opening,s)).status,'merchant');const before=structuredClone(s.windowFinishes[opening.id].quotes);
 s=updateWindow(s,opening.id,{pricePerM2:0,glassType:'high'});assert.equal(quoteInfo(opening,resolveWindowFinish(opening,s)).status,'stale');assert.deepEqual(s.windowFinishes[opening.id].quotes,before);
 s=recordWindowQuote(s,opening.id,'confirmed','商家A 已核对Q2','2026-10-23',true);assert.equal(quoteInfo(opening,resolveWindowFinish(opening,s)).status,'confirmed');assert.equal(validateState(s).windowFinishes[opening.id].quotes.length,2);assert.equal(s.windowFinishes[opening.id].quotes[1].configuration.pricePerM2,0);
});
test('comparison of identical saved content is zero and changes locate faces/windows with independent costs',()=>{
 const a=seed(),b=updateWindow(a,'f1-s-window',{pricePerM2:650,sashPrice:700,sashCount:2}),same=comparePlans(a,a);assert.equal(same.faceChanges.length,0);assert.equal(same.windowChanges.length,0);assert.ok(same.materials.every(m=>m.amountCents===0&&m.purchase===0));
 const diff=comparePlans(a,b);assert.equal(diff.faceChanges.length,0);assert.equal(diff.windowChanges[0].id,'f1-s-window');assert.equal(diff.windowChanges[0].amountCents,190800);assert.equal(diff.b.windows.amountCents-diff.a.windows.amountCents,190800);
});
