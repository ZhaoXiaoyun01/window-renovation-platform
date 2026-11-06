import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFaces, faceSolids } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';
import { buildMaterialReport, reportExportPayload, reportTotals } from '../src/renovation3d/utils/material-report.ts';
import { buildingTileQuantities, tileQuantityKey, tileQuantityTotals } from '../src/renovation3d/utils/tile-quantities.ts';

const faces=buildingFaces(config.walls);
const fresh=()=>validateState({schemaVersion:1,faceGroupingVersion:7,buildingId:config.id,materials:structuredClone(config.materials),hiddenFloors:[],exploded:false,
  finishes:Object.fromEntries(config.walls.map(w=>[w.id,{...config.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}]))});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('material report reconciles every stock, face and region with the actual building and preserves hidden-floor totals',()=>{
  const state=fresh(),before=structuredClone(state),report=buildMaterialReport(faces,state),quantities=buildingTileQuantities(faces,state),totals=reportTotals(report.summary);
  assert.deepEqual(state,before);
  for(const stock of quantities.all){const row=report.summary.find(r=>r.key===tileQuantityKey(stock));assert.ok(row);assert.equal(row.tiles,stock.tiles);close(row.areaMm2,stock.areaMm2);}
  const current=tileQuantityTotals(quantities.all);assert.equal(totals.tiles,current.tiles);assert.equal(totals.purchase,current.purchase);close(totals.area,current.area);
  const floorTotals=report.regions.map(r=>reportTotals(r.rows));close(floorTotals.reduce((s,r)=>s+r.area,0),totals.area);assert.equal(floorTotals.reduce((s,r)=>s+r.tiles,0),totals.tiles);
  assert.ok(floorTotals.reduce((s,r)=>s+r.purchase,0)>=totals.purchase);
  for(const face of faces){const parts=report.details.filter(d=>d.faceId===face.id),stocks=quantities.byFace.get(face.id);close(parts.reduce((s,p)=>s+p.areaMm2,0),stocks.reduce((s,r)=>s+r.areaMm2,0));assert.equal(parts.reduce((s,p)=>s+p.tiles,0),stocks.reduce((s,r)=>s+r.tiles,0));}
  const hidden=buildMaterialReport(faces,{...state,hiddenFloors:['f1','f2','f3','f4'],hiddenGroups:['terrace']});assert.deepEqual(hidden,report);
});

test('a brick spanning the fourth-floor and terrace boundary is purchased once, with actual net area assigned to both regions',()=>{
  const state=fresh(),face=faces.find(f=>new Set(f.members.map(m=>m.viewGroup)).size>1),report=buildMaterialReport([face],state);
  const regions=report.regions.filter(r=>r.rows.length);assert.equal(regions.length,2);assert.ok(regions.some(r=>r.id==='f4'));assert.ok(regions.some(r=>r.id==='terrace'));
  const expected=buildingTileQuantities([face],state).all;
  assert.equal(report.details.reduce((s,r)=>s+r.tiles,0),expected.reduce((s,r)=>s+r.tiles,0));
  close(report.details.reduce((s,r)=>s+r.areaMm2,0),expected.reduce((s,r)=>s+r.areaMm2,0));
  assert.equal(reportTotals(report.summary).tiles,expected.reduce((s,r)=>s+r.tiles,0));
});

test('paint costs use actual net area without tile counts; price updates and mixed orientations keep stock grouping correct',()=>{
  const state=fresh(),face=faces.find(f=>faceSolids(f).length===1);
  state.faceFinishes[face.id]={...config.defaultTile,materialId:'paint',preserveZoning:false};
  state.materials.find(m=>m.id==='paint').pricePerM2=1.005;
  const report=buildMaterialReport([face],state),row=report.summary[0];assert.equal(row.kind,'paint');assert.equal(row.tiles,0);assert.equal(row.purchase,0);close(row.purchaseArea,row.areaMm2/1e6);
  assert.equal(row.amountCents,Math.round((row.areaMm2/1e6*1.005+Number.EPSILON)*100));
  const rect={x:0,y:0,width:1000,height:1000},member={...face.members[0],rects:[rect],holes:[]};
  const square={...face,originMm:[0,0,0],rotationX:-Math.PI/2,rotationY:0,rects:[rect],holes:[],members:[member]};
  assert.equal(buildMaterialReport([square],state).summary[0].amountCents,101,'1m² × 1.005元/m² rounds to 1.01元');
  const pair=faces.slice(0,2);for(const [i,f] of pair.entries())state.faceFinishes[f.id]={...config.defaultTile,materialId:'ivory',widthMm:i?145:45,heightMm:i?45:145,preserveZoning:false};
  assert.equal(buildMaterialReport(pair,state).summary.length,1);
  const before=buildMaterialReport(pair,state).summary[0];state.materials.find(m=>m.id==='ivory').pricePerM2=200;const after=buildMaterialReport(pair,state).summary[0];
  assert.equal(after.tiles,before.tiles);assert.equal(after.unitPrice,200);assert.notEqual(after.amountCents,before.amountCents);
});

test('export payload carries actual area and assigned counts with no image data or model changes',()=>{
  const state=fresh(),report=buildMaterialReport(faces,state),before=structuredClone(state),payload=reportExportPayload(report,'本次方案','2026/10/22 12:00:00');
  assert.deepEqual(state,before);assert.equal(payload.name,'本次方案');assert.equal(payload.rows.length,report.regions.reduce((s,r)=>s+r.rows.length,0));
  assert.ok(payload.materials.every(m=>!('image'in m)&&!('color'in m)));assert.equal(payload.rows.reduce((s,r)=>s+r.tiles,0),reportTotals(report.summary).tiles);
  assert.ok(payload.rows.every(r=>r.regionId!=='all'));assert.equal(payload.rows.reduce((s,r)=>s+r.areaMm2,0),report.details.reduce((s,r)=>s+r.areaMm2,0));
});
