import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFaces, buildingFacesAtRevision8, faceSolids, faceFinishRegions } from '../src/renovation3d/utils/wall-surfaces.ts';
import { projectRects } from '../src/renovation3d/utils/coplanar-faces.ts';
import { validateRevision9State as validateState, validateRevision8State } from '../src/renovation3d/utils/validation.ts';
import { rectUnion } from '../src/renovation3d/utils/outline.ts';
import { dot, wallFrame } from '../src/renovation3d/utils/geometry.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';
import { replaceFaces } from '../src/renovation3d/utils/finish-actions.ts';
import { joinReturnCorners } from '../src/renovation3d/utils/return-corners.ts';

const old=JSON.parse(fs.readFileSync(new URL('./fixtures/renovation-2.7-faces.json',import.meta.url))),faces=buildingFaces(config.walls);
const area=rs=>rs.reduce((s,r)=>s+r.width*r.height,0),close=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);
const marked='relief-f1-front-h-3800-1--5100-5100:face:0:part:68:0';
const fresh=()=>({schemaVersion:1,faceGroupingVersion:8,buildingId:config.id,materials:structuredClone(config.materials),hiddenFloors:[],exploded:false,
  finishes:Object.fromEntries(config.walls.map(w=>[w.id,{...config.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}]))});

test('2.8 retains exact 2.7 migration geometry and fills only the missing 7616mm2 of return corners',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(buildingFacesAtRevision8())),old);
  assert.equal(old.length,170);assert.equal(faces.length,168);
  close(area(faces.flatMap(faceSolids))-area(old.flatMap(faceSolids)),7616);
  for(const previous of old){
    const targets=faces.filter(f=>f.mergedFaceIds.includes(previous.id));assert.ok(targets.length,previous.id);
    close(area(rectUnion(faceSolids(previous),targets.flatMap(f=>projectRects(f,previous,faceSolids(f))))),0);
  }
  for(const face of faces){
    const previous=face.mergedFaceIds.map(id=>old.find(f=>f.id===id));
    const added=rectUnion(faceSolids(face),previous.flatMap(f=>projectRects(f,face,faceSolids(f))));
    if(added.length)assert.ok([3300,3800].includes(face.originMm[1]),face.id);
    close(area(face.members.flatMap(m=>m.rects)),area(faceSolids(face)));
  }
});

test('the marked 0.61m2 strip, both side strips and their finished corners are one connected face',()=>{
  const face=faces.find(f=>f.mergedFaceIds.includes(marked));
  assert.ok(face.mergedFaceIds.includes('relief-f1-front-h-3800-1--5100-5100:face:0'));
  assert.ok(face.mergedFaceIds.includes('relief-f1-front-h-3800-1--5100-5100:face:0:part:10276:68'));
  const axes=wallFrame(face);
  for(const world of [[5140,3800,6140],[-5140,3800,6140],[5000,3800,6140],[5140,3800,5900]]){
    const delta=world.map((v,i)=>v-face.originMm[i]),x=dot(delta,axes.u),y=dot(delta,axes.v);
    assert.ok(faceSolids(face).some(r=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height),world.join(','));
  }
});

test('all current faces and their members remain disjoint, including opposite normals and actual rendering depth',()=>{
  for(let i=0;i<faces.length;i++){
    const face=faces[i],members=face.members.flatMap(m=>m.rects),a=wallFrame(face);
    for(let k=0;k<members.length;k++)for(const r of members.slice(k+1))assert.equal(intersect(members[k],r),null,face.id);
    for(const other of faces.slice(i+1)){
      const b=wallFrame(other),orientation=dot(a.n,b.n);if(Math.abs(orientation)<.99)continue;
      for(const rendering of [false,true]){
        const depth=f=>f.offsetMm+(rendering?Math.max(f.claddingMm??config.scene.tileDepthMm,1):0);
        if(Math.abs(dot(a.n,other.originMm)+depth(other)*orientation-dot(a.n,face.originMm)-depth(face))>1e-5)continue;
        for(const r of faceSolids(face))for(const s of projectRects(other,face,faceSolids(other)))assert.equal(intersect(r,s),null,`${face.id} / ${other.id}`);
      }
    }
  }
});

test('revision8 different finishes migrate deterministically, replace the entire corner once, and preserve history',()=>{
  const state=validateRevision8State(fresh()),face=faces.find(f=>f.mergedFaceIds.includes(marked));
  for(const id of face.mergedFaceIds)state.faceFinishes[id]={...config.defaultTile,materialId:id===marked?'sand':'basalt',preserveZoning:false};
  const original=structuredClone(state),restored=validateState(state);
  assert.equal(restored.faceGroupingVersion,9);assert.deepEqual(state,original);assert.deepEqual(validateState(restored),restored);
  assert.equal(restored.faceFinishes[face.id].materialId,'basalt');assert.deepEqual(restored.faceRegionFinishes,{});
  const finish={...config.defaultTile,materialId:'ivory',widthMm:45,heightMm:145,preserveZoning:false};
  const changed=validateState(replaceFaces(restored,[face],finish));
  assert.deepEqual(faceFinishRegions(face,changed),[{face,finish}]);
  assert.deepEqual(validateState(changed),changed);
  for(const f of faces.filter(f=>f.id!==face.id))assert.deepEqual(changed.faceFinishes[f.id],restored.faceFinishes[f.id]);
});

test('corner closure is limited to perpendicular returns at the same height and tile-depth endpoint gap',()=>{
  const source=id=>({...config.walls[0],id,surfaceOnly:true,rotationY:id==='back-a'?0:Math.PI/2});
  const walls=[source('back-a'),source('back-b'),{...source('return-a'),surfaceKind:'relief-return',rotationX:-Math.PI/2,finishSourceFaceId:'back-a:face:0'},
    {...source('return-b'),surfaceKind:'relief-return',rotationX:-Math.PI/2,finishSourceFaceId:'back-b:face:0'}];
  const make=(id,rect)=>{const zone={...rect,materialId:'ivory',offsetMm:0};return {...old.find(f=>f.id===marked),id,originMm:[0,100,0],wallId:id,
    rotationX:-Math.PI/2,rotationY:0,rects:[rect],holes:[],zones:[zone],sourceWallIds:[id],members:[{wallId:id,sourceFaceId:id,offsetMm:0,shiftMm:[0,0],rects:[rect],holes:[],zones:[zone]}]};};
  const a=make('return-a',{x:0,y:0,width:100,height:60});
  const b=make('return-b',{x:108,y:68,width:60,height:100});
  assert.equal(joinReturnCorners([a,b],walls,[],8,[]).length,1);
  const far=make('return-b',{x:109,y:69,width:60,height:100});
  assert.equal(joinReturnCorners([a,far],walls,[],8,[]).length,2);
  assert.equal(joinReturnCorners([a,{...b,originMm:[0,101,0]}],walls,[],8,[]).length,2);
  const parallel=walls.map(w=>w.id==='back-b'?{...w,rotationY:0}:w);
  assert.equal(joinReturnCorners([a,b],parallel,[],8,[]).length,2);
});
