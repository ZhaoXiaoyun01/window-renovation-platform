// Exact 2.7 geometry and migration contract; current corner geometry is tested in 2.8.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFacesAtRevision8 as buildingFaces, buildingFacesAtRevision7, faceSolids, faceFinishRegions, faceMetrics, faceGridWall, faceTileLayout } from '../src/renovation3d/utils/wall-surfaces.ts';
import { mergeCoplanarFaces, projectRects } from '../src/renovation3d/utils/coplanar-faces.ts';
import { validateRevision8State as validateState } from '../src/renovation3d/utils/validation.ts';
import { dot, wallFrame, worldPoint } from '../src/renovation3d/utils/geometry.ts';
import { rectUnion } from '../src/renovation3d/utils/outline.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';
import { visibleFace } from '../src/renovation3d/utils/view-groups.ts';
import { replaceFaces, replaceSameMaterial, styleFingerprint, styleChanged } from '../src/renovation3d/utils/finish-actions.ts';

const previous = JSON.parse(fs.readFileSync(new URL('./fixtures/renovation-2.6-faces.json', import.meta.url)));
const faces = buildingFaces(config.walls), levels = config.floors.map(f => f.elevationMm + f.heightMm);
const area = rs => rs.reduce((sum, r) => sum + r.width * r.height, 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`);
const fresh = () => ({ schemaVersion: 1, faceGroupingVersion: 7, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], hiddenGroups: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });
const touches = (a, b) => {
  const x = Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x), y = Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
  return x>1e-5 && y>=-1e-5 || y>1e-5 && x>=-1e-5;
};
const band = face => {
  const ys = faceSolids(face).flatMap(r => [worldPoint(face,[r.x,r.y,face.offsetMm])[1],worldPoint(face,[r.x+r.width,r.y+r.height,face.offsetMm])[1]]);
  return levels.filter(y => y < (Math.min(...ys)+Math.max(...ys))/2-1e-5).length;
};

test('2.7 preserves exact revision7 geometry and every exposed point while merging connected coplanar pieces', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildingFacesAtRevision7())), previous);
  assert.equal(previous.length, 313); assert.equal(faces.length, 170);
  close(area(faces.flatMap(faceSolids)), 1028463520);
  assert.equal(new Set(faces.map(f=>f.id)).size,faces.length);
  for (const old of previous) {
    const covering = faces.filter(f=>f.mergedFaceIds.includes(old.id)); assert.ok(covering.length,old.id);
    const projected = covering.flatMap(f=>projectRects(f,old,faceSolids(f)));
    close(area(rectUnion(faceSolids(old),projected)),0);
  }
  for (let i=0;i<faces.length;i++) {
    const face=faces[i], a=wallFrame(face), plane=dot(a.n,face.originMm)+face.offsetMm;
    const members=face.members.flatMap(m=>m.rects);
    close(area(members),area(faceSolids(face)));
    for(let j=0;j<members.length;j++)for(const other of members.slice(j+1))assert.equal(intersect(members[j],other),null,face.id);
    for(const other of faces.slice(i+1)) {
      const b=wallFrame(other), aligned=Math.abs(dot(a.n,b.n))>.99;
      if(!aligned || Math.abs(dot(a.n,other.originMm)+other.offsetMm*dot(a.n,b.n)-plane)>1e-5)continue;
      const projected=projectRects(other,face,faceSolids(other));
      for(const r of faceSolids(face))for(const s of projected) {
        assert.equal(intersect(r,s),null,`${face.id} overlaps ${other.id}`);
        if(dot(a.n,b.n)>.99 && (Math.abs(a.n[1])>.99 || band(face)===band(other)))assert.equal(touches(r,s),false,`${face.id} still touches ${other.id}`);
      }
    }
    if(Math.abs(a.n[1])<.99)for(const level of levels){
      const ys=faceSolids(face).flatMap(r=>[worldPoint(face,[r.x,r.y,face.offsetMm])[1],worldPoint(face,[r.x+r.width,r.y+r.height,face.offsetMm])[1]]);
      assert.ok(!(Math.min(...ys)<level-1e-5&&Math.max(...ys)>level+1e-5),face.id);
    }
  }
});

test('injected duplicate and partially overlapping faces are unioned once; disconnected islands and storeys stay separate', () => {
  const source=previous.find(f=>f.id==='f1-right:face:0');
  const copy={...structuredClone(source),id:'duplicate'};
  const partial={...structuredClone(source),id:'partial',rects:source.rects.map(r=>({...r,x:r.x+100}))};
  partial.members=partial.members.map(m=>({...m,rects:m.rects.map(r=>({...r,x:r.x+100}))}));
  const merged=mergeCoplanarFaces([source,copy,partial],config.walls,levels);
  close(area(merged.flatMap(faceSolids)),area(rectUnion([...faceSolids(source),...faceSolids(partial)])));
  close(area(merged.flatMap(f=>f.members.flatMap(m=>m.rects))),area(merged.flatMap(faceSolids)));
  const far={...copy,id:'far',originMm:copy.originMm.map((v,i)=>v+wallFrame(copy).u[i]*50000)};
  assert.equal(mergeCoplanarFaces([source,far],config.walls,levels).length,2);
  assert.equal(mergeCoplanarFaces([source,{...copy,id:'other-storey',floorId:'f2'}],config.walls,levels).length,2);
});

test('every independently finished revision6 patch restores to a single current finish without modifying the snapshot', () => {
  const old=JSON.parse(fs.readFileSync(new URL('./fixtures/renovation-2.5-faces.json',import.meta.url)));
  const state={...fresh(),faceGroupingVersion:6,faceFinishes:Object.fromEntries(old.map((f,i)=>[f.id,{...config.defaultTile,materialId:'sand',groutColor:`#${i.toString(16).padStart(6,'0')}`,preserveZoning:false}]))};
  const before=structuredClone(state),restored=validateState(state);
  assert.deepEqual(state,before);assert.deepEqual(restored.faceRegionFinishes,{});
  for(const face of faces){const regions=faceFinishRegions(face,restored);assert.equal(regions.length,1);assert.equal(regions[0].finish.preserveZoning,false);}
  assert.deepEqual(validateState(restored),restored);
});

test('fourth-floor 440mm patch and terrace wall share selection; horizontal return fragments merge across source kinds', () => {
  const patch=faces.find(f=>f.mergedFaceIds.includes('f4-right:face:0'));
  assert.ok(patch.mergedFaceIds.includes('f4-right:face:0:view:terrace'));
  assert.ok(faces.some(f=>Math.abs(wallFrame(f).n[1])>.99 && new Set(f.mergedFaceIds.map(id=>previous.find(p=>p.id===id).surfaceKind)).size>1));
  const hiddenRoom=visibleFace(patch,{hiddenFloors:['f4'],hiddenGroups:[]}),hiddenTerrace=visibleFace(patch,{hiddenFloors:[],hiddenGroups:['terrace']});
  assert.equal(hiddenRoom.id,patch.id);assert.equal(hiddenTerrace.id,patch.id);
  close(area(faceSolids(hiddenRoom))+area(faceSolids(hiddenTerrace)),area(faceSolids(patch)));
  assert.equal(visibleFace(patch,{hiddenFloors:['f4'],hiddenGroups:['terrace']}),undefined);
});

test('legacy mixed finishes choose the largest complete style deterministically, without snapshot mutation or recurring migration', () => {
  const state=fresh(), face=faces.find(f=>f.mergedFaceIds.length>2), members=face.mergedFaceIds.map(id=>previous.find(p=>p.id===id));
  const largest=members.sort((a,b)=>area(faceSolids(b))-area(faceSolids(a))||a.id.localeCompare(b.id))[0];
  state.faceFinishes=Object.fromEntries(members.map((f,i)=>[f.id,{...config.defaultTile,materialId:'sand',groutColor:`#${i.toString(16).padStart(6,'0')}`,preserveZoning:false}]));
  const original=structuredClone(state), restored=validateState(state);
  assert.deepEqual(restored.faceFinishes[face.id],state.faceFinishes[largest.id]);
  assert.deepEqual(state,original);assert.equal(restored.faceGroupingVersion,8);assert.deepEqual(restored.faceRegionFinishes,{});
  assert.deepEqual(validateState(restored),restored);
  for(const f of faces)assert.equal(faceFinishRegions(f,restored).length,1);
  const replacement={...config.defaultTile,materialId:'basalt',widthMm:45,heightMm:145,preserveZoning:false};
  const changed=validateState(replaceFaces(restored,[face],replacement));
  assert.deepEqual(faceFinishRegions(face,changed)[0].finish,replacement);
  for(const f of faces.filter(f=>f.id!==face.id))assert.deepEqual(changed.faceFinishes[f.id],restored.faceFinishes[f.id]);
  const bulk=validateState(replaceSameMaterial(changed,faces,'sand',face.id,replacement).state);
  for(const f of faces)assert.equal(faceFinishRegions(f,bulk).length,1);
});

test('current defaults have one finish per face and actual tile UVs retain complete coverage around openings and world datum', () => {
  const state=validateState(fresh());
  assert.equal(Object.keys(state.faceFinishes).length,faces.length);
  for(const f of faces){
    const regions=faceFinishRegions(f,state);assert.equal(regions.length,1);assert.equal(regions[0].finish.preserveZoning,false);
    const layout=faceTileLayout(f,faceGridWall(f,config.walls),{...config.defaultTile,groutMm:0},30000);
    close(layout.tileAreaMm2,faceMetrics(f).netAreaMm2);
    for(const p of layout.pieces){close((p.uv[2]-p.uv[0])*1200,p.width);close((p.uv[3]-p.uv[1])*600,p.height);for(const hole of f.holes)assert.equal(intersect(p,hole),null);}
  }
});

test('save dirty gate ignores sample IDs and automatic names, detects all meaningful fields, reverts and successful-save baseline', () => {
  const material=config.materials[0],finish={...config.defaultTile,materialId:material.id},baseline=styleFingerprint(material,finish);
  assert.equal(styleChanged(baseline,{...material,id:'copy',name:'复制'},finish),false);
  assert.equal(styleChanged(baseline,material,finish,'自动名称',material.name,'自动名称'),false);
  assert.equal(styleChanged(baseline,material,finish,material.name,material.name),false);
  assert.equal(styleChanged(baseline,material,finish,'新名称',material.name),true);
  for(const patch of [{color:'#123456'},{pricePerM2:123},{image:'new-image',texture:'custom'}])assert.equal(styleChanged(baseline,{...material,...patch},finish),true);
  for(const patch of [{widthMm:145},{heightMm:45},{direction:'vertical'},{groutMm:5},{groutColor:'#123456'},{alignment:'center'}])assert.equal(styleChanged(baseline,material,{...finish,...patch}),true);
  assert.equal(styleChanged(baseline,material,finish),false);
  const edited={...finish,widthMm:145};assert.equal(styleChanged(styleFingerprint(material,edited),material,edited),false);
  const paint={...material,kind:'paint',texture:'plain'};
  assert.equal(styleChanged(styleFingerprint(paint,finish),paint,{...finish,widthMm:45}),false);
});
