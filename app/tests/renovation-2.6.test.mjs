// Historical revision-7 contract: retained for migration; current selection rules are tested in renovation-2.7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFacesAtRevision7 as buildingFaces, buildingFacesAtRevision6, faceSolids, faceFinishRegions, faceMetrics } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State as validateState } from '../src/renovation3d/utils/validation.ts';
import { matchesTileStyle, replaceFaces } from '../src/renovation3d/utils/finish-actions.ts';
import { wallFrame } from '../src/renovation3d/utils/geometry.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';

const former=JSON.parse(fs.readFileSync(new URL('./fixtures/renovation-2.5-faces.json',import.meta.url)));
const faces=buildingFaces(config.walls),area=face=>faceSolids(face).reduce((sum,r)=>sum+r.width*r.height,0);
const fresh=()=>({schemaVersion:1,faceGroupingVersion:6,buildingId:config.id,materials:structuredClone(config.materials),hiddenFloors:[],exploded:false,
 finishes:Object.fromEntries(config.walls.map(w=>[w.id,{...config.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}]))});

test('revision 6 migration uses the unchanged real 2.5 geometry and current grouping conserves all exposed area',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(buildingFacesAtRevision6())),former);
 assert.equal(former.length,340);assert.equal(faces.length,313);
 assert.ok(Math.abs(faces.reduce((s,f)=>s+area(f),0)-former.reduce((s,f)=>s+area(f),0))<1e-4);
 assert.equal(new Set(faces.map(f=>f.id)).size,faces.length);
});

test('the first-floor east white beam is one 500mm-high face across the former 180mm slab strip',()=>{
 const face=faces.find(f=>f.id==='f1-right:face:0');
 assert.equal(faceMetrics(face).heightMm,500);
 for(const y of [3500,3700])assert.ok(faceSolids(face).some(r=>intersect(r,{x:1000,y,width:1,height:1})));
 assert.ok(face.members.some(m=>m.previousFaceId==='f1-right:face:0:junction:0:3620'));
 assert.ok(!faces.some(f=>f.id==='f1-right:face:0:junction:0:3620'));
 // Floor levels still divide selection; no vertical face extends across a storey seam.
 for(const f of faces.filter(f=>Math.abs(wallFrame(f).n[1])<1e-5))for(const level of [3800,7100,10400,13700]){
  const ys=faceSolids(f).flatMap(r=>[f.originMm[1]+r.y,f.originMm[1]+r.y+r.height]);
  assert.ok(!(Math.min(...ys)<level-1e-5&&Math.max(...ys)>level+1e-5),f.id);
 }
});

test('all 340 separately painted revision 6 patches retain their exact finish after merging and restore idempotently',()=>{
 const state={...fresh(),faceFinishes:Object.fromEntries(former.map((f,i)=>[f.id,{...config.defaultTile,materialId:'sand',groutColor:`#${i.toString(16).padStart(6,'0')}`,preserveZoning:false}]))};
 const original=structuredClone(state),restored=validateState(state);
 for(const face of faces)for(const region of faceFinishRegions(face,restored))for(const member of region.face.members){
  const id=member.previousFaceId??face.id;
  assert.equal(region.finish.groutColor,state.faceFinishes[id].groutColor,`${face.id} / ${id}`);
 }
 assert.deepEqual(state,original);assert.equal(restored.faceGroupingVersion,7);assert.deepEqual(validateState(restored),restored);
 for(const face of faces){
  const total=faceFinishRegions(face,restored).reduce((sum,r)=>sum+area(r.face),0);
  assert.ok(Math.abs(total-area(face))<1e-5,face.id);
 }
});

test('an old independently painted slab strip does not recolour the rest of its merged face',()=>{
 const state={...fresh(),faceFinishes:{'f1-right:face:0:junction:0:3620':{...config.defaultTile,materialId:'sand',preserveZoning:false}}};
 const restored=validateState(state),face=faces.find(f=>f.id==='f1-right:face:0');
 const regions=faceFinishRegions(face,restored);
 assert.equal(regions.length,2);assert.equal(restored.faceFinishes[face.id],undefined);
 const old=former.find(f=>f.id==='f1-right:face:0:junction:0:3620');
 assert.ok(Math.abs(area(regions.find(r=>r.finish.materialId==='sand').face)-area(old))<1e-5);
 const changed=validateState(replaceFaces(restored,[face],{...config.defaultTile,materialId:'basalt',preserveZoning:false}));
 assert.equal(faceFinishRegions(face,changed).length,1);assert.equal(faceFinishRegions(face,changed)[0].finish.materialId,'basalt');
 assert.throws(()=>validateState({...restored,faceRegionFinishes:{'invented-region':state.faceFinishes[old.id]}}),/分区铺贴数据无效/);
});

test('saved material highlighting matches real finish parameters independently of names and copied IDs',()=>{
 const material={...config.materials[0],id:'saved',name:'原名称'},finish={...config.defaultTile,materialId:'saved',widthMm:45,heightMm:145};
 const style={material,finish};
 assert.equal(matchesTileStyle({...material,id:'imported-copy',name:'新名称'},finish,style),true);
 assert.equal(matchesTileStyle(material,{...finish,heightMm:95},style),false);
 assert.equal(matchesTileStyle(material,{...finish,direction:'vertical'},style),false);
 assert.equal(matchesTileStyle({...material,pricePerM2:1},finish,style),false);
 assert.equal(matchesTileStyle({...material,color:'#123456'},finish,style),false);
});
