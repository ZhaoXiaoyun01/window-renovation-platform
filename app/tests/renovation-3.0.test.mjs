import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { editableFacesAtRevision10 as editableBuildingFaces, modelSurfaces, baseLevelMm, floorOffsetMm } from '../src/renovation3d/utils/model-surfaces.ts';
import { buildingFaces, faceSolids, faceTileSolids } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision10State as validateState, validateRevision9State } from '../src/renovation3d/utils/validation.ts';
import { worldPoint, wallFrame, dot } from '../src/renovation3d/utils/geometry.ts';
import { projectRects } from '../src/renovation3d/utils/coplanar-faces.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';
import { isObjectVisible, visibleFace, matchesViewScope } from '../src/renovation3d/utils/view-groups.ts';
import { buildMaterialReport, reportTotals } from '../src/renovation3d/utils/material-report.ts';
import { buildWindowReport, updateWindow, windowReportTotals, windowExportPayload } from '../src/renovation3d/utils/window-report.ts';
import { matchesReportFilters } from '../src/renovation3d/utils/report-filters.ts';
import { sunlight, timeLabel } from '../src/renovation3d/utils/sunlight.ts';
import { amountCents } from '../src/renovation3d/utils/money.ts';

const seed = () => ({schemaVersion:1,faceGroupingVersion:7,buildingId:config.id,materials:structuredClone(config.materials),hiddenFloors:[],hiddenGroups:[],exploded:false,
  finishes:Object.fromEntries(config.walls.map(w=>[w.id,{...config.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}]))});
const faces=editableBuildingFaces();
const points=face=>faceSolids(face).flatMap(r=>[r.x,r.x+r.width].flatMap(x=>[r.y,r.y+r.height].map(y=>worldPoint(face,[x,y,face.offsetMm]))));

test('base owns every ground interface, remains independent of first-floor visibility and explosion',()=>{
  const state=validateState(seed()),base=faces.filter(f=>f.viewGroup==='base');assert.ok(base.length);
  for(const f of base)assert.ok(points(f).every(p=>p[1]<=baseLevelMm+1e-5),f.id);
  for(const f of faces.filter(f=>f.floorId==='f1'&&f.viewGroup!=='base'))assert.ok(points(f).every(p=>p[1]>=baseLevelMm-1e-5),f.id);
  assert.ok(base.some(f=>points(f).every(p=>Math.abs(p[1])<1e-5)),'shared interface is base');
  assert.ok(base.every(f=>isObjectVisible(f,{...state,hiddenFloors:['f1']})));
  assert.ok(base.every(f=>!visibleFace(f,{...state,hiddenGroups:['base']})));
  assert.ok(base.every(f=>matchesViewScope(f,'base')&&!matchesViewScope(f,'f1')));
  assert.equal(floorOffsetMm('f1','base'),0);assert.equal(floorOffsetMm('f1'),1800);
});

test('model has only exterior categories, zero plate edge skins and zero room construction caps',()=>{
  for(const f of faces){
    assert.ok(['wall','ceiling','floor'].includes(f.category));
    assert.ok(!f.sourceWallIds.some(id=>/^exposed-(f[234]|roof)-slab-(east|west|north|south|top)-/.test(id)),f.id);
    if(f.category==='ceiling'){
      assert.ok([3800,7100,10400,13700].includes(f.originMm[1]),f.id);
      assert.ok(f.members.every(m=>!m.viewGroup));
      assert.ok(f.sourceWallIds.every(id=>/slab-bottom/.test(id)));
    }
    if(Math.abs(wallFrame(f).n[1])<.01){const floor=config.floors.find(p=>p.id===f.floorId);if(!f.viewGroup)assert.ok(points(f).every(p=>p[1]>=floor.elevationMm-1e-5&&p[1]<=floor.elevationMm+floor.heightMm+1e-5),f.id);}
  }
  const old=buildingFaces(config.walls),copy=structuredClone(old);modelSurfaces(old);assert.deepEqual(old,copy);
});

test('all coplanar editable skins remain nonoverlapping after removal of slab thickness',()=>{
  for(const face of faces){
    const area=face.rects.reduce((sum,r)=>sum+r.width*r.height,0), owned=face.members.flatMap(m=>m.rects).reduce((sum,r)=>sum+r.width*r.height,0);
    assert.ok(Math.abs(area-owned)<1e-3,`duplicate member area: ${face.id}`);
    for(let i=0;i<face.rects.length;i++)for(let j=i+1;j<face.rects.length;j++){const p=intersect(face.rects[i],face.rects[j]);assert.ok(!p||p.width*p.height<1e-3,`self overlap: ${face.id}`);}
  }
  for(let i=0;i<faces.length;i++)for(let j=i+1;j<faces.length;j++){
    const a=faces[i],b=faces[j],n=wallFrame(a).n;
    if(dot(n,wallFrame(b).n)<.999||Math.abs(dot(n,a.originMm)+a.offsetMm-dot(n,b.originMm)-b.offsetMm)>1e-5)continue;
    for(const r of faceSolids(a))for(const s of projectRects(b,a,faceSolids(b))){const p=intersect(r,s);assert.ok(!p||p.width*p.height<1e-3,`${a.id} overlaps ${b.id}`);}
  }
});

test('revision 9 recovers into strict faces without mutating saved finishes or losing per-face choices',()=>{
  const old=validateRevision9State(seed());for(const [i,id] of Object.keys(old.faceFinishes).entries())old.faceFinishes[id]={...old.faceFinishes[id],widthMm:600+(i%2)*100};
  const copy=structuredClone(old),current=validateState(old);assert.equal(current.faceGroupingVersion,10);assert.deepEqual(old,copy);
  for(const face of faces)assert.deepEqual(current.faceFinishes[face.id],old.faceFinishes[face.previousFaceId]);
  assert.deepEqual(validateState(current),current);assert.deepEqual(current.materials,old.materials);
  assert.throws(()=>validateState({...current,sunHour:19}));assert.throws(()=>validateState({...current,hiddenGroups:['base','base']}));
});

test('material totals include covered exterior skins and exclude all structural closure/indoor areas',()=>{
  const state=validateState(seed()),report=buildMaterialReport(faces,state),total=reportTotals(report.summary);
  const actual=faces.reduce((sum,f)=>sum+faceTileSolids(f).reduce((n,r)=>n+r.width*r.height/1e6,0),0);
  assert.ok(Math.abs(total.area-actual)<1e-6);assert.ok(report.regions.find(r=>r.id==='base').rows.length);
  assert.ok(report.details.every(r=>faces.some(f=>f.id===r.faceId)));
  assert.deepEqual(buildMaterialReport(faces,{...state,hiddenFloors:['f1','f2','f3','f4'],hiddenGroups:['base','terrace']}),report);
});

test('independent window table prices opening sashes per item, keeps missing quotes unknown and persists edits',()=>{
  const state=validateState(seed()),before=structuredClone(state),initial=buildWindowReport(state);
  assert.equal(initial.length,config.walls.reduce((n,w)=>n+w.openings.filter(o=>o.kind==='window').length,0));
  assert.ok(initial.every(r=>r.pricePerM2===500&&r.sashPrice===500));
  let next=updateWindow(state,'f1-s-window',{name:'南面定制窗',pricePerM2:500,sashPrice:100,sashCount:2});
  const row=buildWindowReport(next).find(r=>r.id==='f1-s-window');assert.equal(row.area,6.72);assert.equal(row.amountCents,356000);
  assert.equal(windowReportTotals([row]).amountCents,356000);
  assert.deepEqual(validateState(next).windowFinishes,next.windowFinishes);assert.deepEqual(state,before);
  next=updateWindow(next,row.id,{sashCount:0,sashPrice:undefined});assert.equal(buildWindowReport(next).find(r=>r.id===row.id).amountCents,336000);
  assert.equal(windowExportPayload([row],'方案','时间').rows[0].sashCount,2);
  assert.throws(()=>updateWindow(state,row.id,{sashCount:1.5}));assert.throws(()=>updateWindow(state,row.id,{pricePerM2:-1}));assert.throws(()=>updateWindow(state,row.id,{name:' '}));
});

test('column filters match literal text, numeric comparisons/ranges and unknown prices predictably',()=>{
  assert.ok(matchesReportFilters(['一层',3560],['一','>=3500']));assert.ok(matchesReportFilters(['#AABBCC',6.72],['aabb','6..7']));
  assert.ok(!matchesReportFilters(['待报价'],['>=0']));assert.ok(!matchesReportFilters([5],['2..4']));assert.ok(!matchesReportFilters([5],['invalid']));
});

test('sunlight preview moves from east through south to west, with quarter-hour labels',()=>{
  const morning=sunlight(6),noon=sunlight(12),evening=sunlight(18);
  assert.ok(morning.position[0]>0&&evening.position[0]<0);assert.ok(Math.abs(noon.position[0])<1e-5&&noon.position[2]>0);
  assert.ok(noon.position[1]>morning.position[1]);assert.equal(timeLabel(8.25),'08:15');
});

test('decimal estimates avoid binary rounding errors and match half-up Excel cents',()=>{
  assert.equal(amountCents([[10.075]]),1008);assert.equal(amountCents([[4.015]]),402);
  assert.equal(amountCents([[1550,1300,1e-6,5],[2,100]]),21008);
  assert.equal(amountCents([[1e-7,1e7]]),100);assert.equal(amountCents([[0,1e6]]),0);
  const state=validateState(seed()),face=faces[0],rect={x:0,y:0,width:1000,height:1000};
  const square={...face,originMm:[0,0,0],rotationX:-Math.PI/2,rotationY:0,rects:[rect],holes:[],members:[{...face.members[0],rects:[rect],holes:[]}]};
  state.materials.find(m=>m.id==='paint').pricePerM2=10.075;
  state.faceFinishes[face.id]={...config.defaultTile,materialId:'paint',preserveZoning:false};
  assert.equal(buildMaterialReport([square],state).summary[0].amountCents,1008);
});
