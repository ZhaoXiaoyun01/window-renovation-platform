import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { editableBuildingFaces, editableFacesAtRevision10, modelWalls, junctionFillers } from '../src/renovation3d/utils/model-surfaces.ts';
import { stepPatches } from '../src/renovation3d/utils/model-structure.ts';
import { buildingBodies, worldPoint, wallFrame, dot } from '../src/renovation3d/utils/geometry.ts';
import { faceBodyMasks } from '../src/renovation3d/utils/surface-intersections.ts';
import { faceSolids } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateState, validateRevision10State } from '../src/renovation3d/utils/validation.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';
import { buildWindowReport, updateWindow, windowExportPayload, windowReportTotals } from '../src/renovation3d/utils/window-report.ts';
import { matchesColumnSelections } from '../src/renovation3d/utils/report-filters.ts';

const seed = () => ({schemaVersion:1,faceGroupingVersion:7,buildingId:config.id,materials:structuredClone(config.materials),hiddenFloors:[],hiddenGroups:[],exploded:false,
  finishes:Object.fromEntries(config.walls.map(w=>[w.id,{...config.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}]))});
const inside=(point,box)=>point.every((v,i)=>v>box.min[i]+1e-5&&v<box.max[i]-1e-5);
const volumeIntersection=(a,b)=>a.min.reduce((n,v,i)=>n*Math.max(0,Math.min(a.max[i],b.max[i])-Math.max(v,b.min[i])),1);

test('all storey porch junctions are solid throughout their height without blocking adjacent windows',()=>{
  assert.ok(junctionFillers.length);
  for(const floor of config.floors.slice(0,3)){
    const back=modelWalls.find(w=>w.id===floor.id+'-porch-back');
    for(const y of [200,1200,2200,floor.heightMm-100])assert.ok(junctionFillers.some(b=>inside([-910,floor.elevationMm+y,back.originMm[2]-100],b)),`${floor.id} junction at ${y}`);
  }
  const bodies=buildingBodies(modelWalls,[]);
  for(const filler of junctionFillers){
    for(const box of bodies)assert.ok(volumeIntersection(filler,box)<1e-3,'filler overlaps existing masonry');
    assert.ok(!inside([0,filler.min[1]+10,0],filler),'fill enters room centre');
  }
  for(const wall of modelWalls)for(const opening of wall.openings){const point=worldPoint(wall,[opening.x+opening.width/2,opening.y+opening.height/2,-wall.thicknessMm/2]);assert.ok(!junctionFillers.some(box=>inside(point,box)),opening.id);}
});

test('current editable skins stop at current masonry junctions and never penetrate their interior',()=>{
  const current=editableBuildingFaces(),bodies=[...buildingBodies(modelWalls,[]),...junctionFillers];assert.ok(current.length>100);
  for(const face of current)for(const mask of faceBodyMasks(face,bodies))for(const solid of faceSolids(face)){const hit=intersect(mask,solid);assert.ok(!hit||hit.width*hit.height<1e-3,face.id);}
  const old=validateRevision10State(seed()),before=structuredClone(old),restored=validateState(old);
  assert.equal(restored.faceGroupingVersion,11);assert.deepEqual(old,before);assert.deepEqual(validateState(restored),restored);
  for(const face of current)assert.deepEqual(restored.faceFinishes[face.id],old.faceFinishes[face.previousFaceId]);
  assert.equal(editableFacesAtRevision10().length,157,'historical geometry remains available');
});

test('base step bottoms do not duplicate the foundation plane or each other',()=>{
  const foundation=config.parts.find(p=>p.id==='f1-slab'),level=foundation.centerMm[1]+foundation.sizeMm[1]/2;
  const mask={x:foundation.centerMm[0]-foundation.sizeMm[0]/2,y:foundation.centerMm[2]-foundation.sizeMm[2]/2,width:foundation.sizeMm[0],height:foundation.sizeMm[2]};
  for(const patch of stepPatches){
    const n=wallFrame(patch).n;if(n[1]<-.99&&Math.abs(patch.originMm[1]-level)<1e-5){const r={x:patch.originMm[0],y:patch.originMm[2],width:patch.widthMm,height:patch.heightMm};const hit=intersect(mask,r);assert.ok(!hit||hit.width*hit.height<1e-3);}
  }
  for(let i=0;i<stepPatches.length;i++)for(let j=i+1;j<stepPatches.length;j++){
    const a=stepPatches[i],b=stepPatches[j],n=wallFrame(a).n;if(dot(n,wallFrame(b).n)<.99||Math.abs(dot(n,a.originMm)-dot(n,b.originMm))>1e-5)continue;
    const {u,v}=wallFrame(a),delta=b.originMm.map((x,k)=>x-a.originMm[k]);const hit=intersect({x:0,y:0,width:a.widthMm,height:a.heightMm},{x:dot(delta,u),y:dot(delta,v),width:b.widthMm,height:b.heightMm});assert.ok(!hit||hit.width*hit.height<1e-3);
  }
});

test('500 defaults and glass follow live window settings, while existing quotes are preserved',()=>{
  let state=validateState(seed()),rows=buildWindowReport(state),front=rows.find(r=>r.id==='f1-s-window');
  assert.equal(front.pricePerM2,500);assert.equal(front.sashPrice,500);assert.equal(front.glass,'中透 Low-E');assert.equal(front.amountCents,386000);
  assert.equal(windowReportTotals(rows).amountCents,6628100);
  state=updateWindow(state,front.id,{pricePerM2:650,sashPrice:700,sashCount:2,glassType:'high'});rows=buildWindowReport(state);front=rows.find(r=>r.id===front.id);
  assert.equal(front.amountCents,576800);assert.equal(front.glass,'高透 Low-E');assert.equal(windowExportPayload([front],'方案','时间').rows[0].glassType,'high');
  const restored=validateState(state);assert.equal(buildWindowReport(restored).find(r=>r.id===front.id).pricePerM2,650);
  const zero=buildWindowReport(updateWindow(state,front.id,{pricePerM2:0,sashPrice:0})).find(r=>r.id===front.id);assert.equal(zero.amountCents,0);
});

test('Excel-style filters combine checked values, clear selections, and skip their own column when finding options',()=>{
  const rows=[['一层','白色',500],['二层','灰色',650],['二层','白色',500]],filters=[['二层'],['白色']];
  assert.deepEqual(rows.filter(row=>matchesColumnSelections(row,filters)),[rows[2]]);
  assert.deepEqual(rows.filter(row=>matchesColumnSelections(row,filters,1)),[rows[1],rows[2]]);
  assert.equal(matchesColumnSelections(rows[0],[[]]),false);assert.equal(matchesColumnSelections(rows[0],[]),true);assert.equal(matchesColumnSelections(rows[0],[undefined,undefined,['500']]),true);
});
