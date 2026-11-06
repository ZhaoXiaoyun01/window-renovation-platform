import test from 'node:test';
import assert from 'node:assert/strict';
import {solidShell,shellCorners,shellProjection,shellDirections} from '../src/renovation3d/utils/solid-shell.ts';
import {structuralShell} from '../src/renovation3d/utils/structural-shell.ts';
import {pointBounds,dot} from '../src/renovation3d/utils/geometry.ts';
import {subtractBox} from '../src/renovation3d/utils/model-structure.ts';
import {floorOffsetMm,editableBuildingFaces} from '../src/renovation3d/utils/model-surfaces.ts';
import {rectUnion} from '../src/renovation3d/utils/outline.ts';
import {intersect} from '../src/renovation3d/tile-layout/layout.ts';
import {cameraNavigation,cameraLimits} from '../src/renovation3d/utils/camera-navigation.ts';
import {buildingConfig as c} from '../src/renovation3d/config/building-config.ts';
import {inspectModel} from '../src/renovation3d/utils/model-inspection.ts';
const box=(owner,min,max)=>({owner,min,max,floorId:'f1',color:'#aaaaaa'}),area=patches=>patches.reduce((s,p)=>s+p.rect.width*p.rect.height,0);
const volume=patches=>patches.reduce((sum,p)=>sum+p.sign*p.coordinate*p.rect.width*p.rect.height/3,0);
function noBuried(patches,boxes){for(const p of patches){const d=shellDirections.find(d=>d.axis===p.axis&&d.sign===p.sign);for(const b of boxes){const masked=p.doubleSided?b.min[p.axis]<p.coordinate-1e-5&&b.max[p.axis]>p.coordinate+1e-5:p.sign>0?b.min[p.axis]<=p.coordinate+1e-5&&b.max[p.axis]>p.coordinate+1e-5:b.max[p.axis]>=p.coordinate-1e-5&&b.min[p.axis]<p.coordinate-1e-5;if(masked){const overlap=intersect(p.rect,shellProjection(b,d));assert.ok(!overlap||overlap.width*overlap.height<1e-5,`buried patch ${p.owner}/${b.owner}`);}}}}
function noDuplicates(patches){for(let i=0;i<patches.length;i++)for(const q of patches.slice(i+1)){const p=patches[i];if(p.axis!==q.axis||Math.abs(p.coordinate-q.coordinate)>1e-5)continue;const bounds={...pointBounds(shellCorners(q)),owner:q.owner},r=shellProjection(bounds,shellDirections.find(d=>d.axis===p.axis&&d.sign===p.sign)),hit=intersect(p.rect,r);assert.ok(!hit||hit.width*hit.height<1e-5,`duplicate ${p.owner}/${q.owner}`);}}
test('solid union removes identical, buried and touching faces while preserving closed external volume',()=>{
 const a=box('a',[0,0,0],[10,10,10]);for(const [others,expectedArea,expectedVolume] of [[[a],600,1000],[[box('inside',[2,2,2],[8,8,8])],600,1000],[[box('touch',[10,0,0],[20,10,10])],1000,2000],[[box('overlap',[5,0,0],[15,10,10])],800,1500]]){const boxes=[a,...others],patches=solidShell(boxes);assert.equal(area(patches),expectedArea);assert.equal(volume(patches),expectedVolume);noBuried(patches,boxes);noDuplicates(patches);}
});
test('an L junction keeps its concave air-facing return without an internal wall or open cut',()=>{
 const boxes=[box('a',[0,0,0],[10,20,4]),box('b',[0,0,0],[4,20,10])],patches=solidShell(boxes);assert.equal(area(patches),928);assert.ok(Math.abs(volume(patches)-1280)<1e-8);noBuried(patches,boxes);noDuplicates(patches);assert.ok(patches.some(p=>p.coordinate===4));
});
test('single floor sheets own coincident caps and exclude portions buried inside walls',()=>{
 const boxes=[box('wall',[0,0,0],[10,20,4])],planes=[{owner:'floor',floorId:'f1',color:'#ffffff',axis:1,coordinate:10,rect:{x:-2,y:-12,width:14,height:14}},{owner:'cap',floorId:'f1',color:'#ffffff',axis:1,coordinate:20,rect:{x:0,y:-4,width:10,height:4}}],patches=solidShell(boxes,planes);noBuried(patches,boxes);noDuplicates(patches);assert.ok(patches.some(p=>p.owner==='cap'));assert.ok(!patches.some(p=>!p.doubleSided&&p.axis===1&&p.sign===1&&p.coordinate===20));
});
test('actual model shells have no buried or duplicated surface, also after hiding or exploding floors',()=>{
 for(const state of [{hiddenFloors:[],hiddenGroups:[],exploded:false},{hiddenFloors:['f2'],hiddenGroups:[],exploded:false},{hiddenFloors:[],hiddenGroups:['base'],exploded:false},{hiddenFloors:[],hiddenGroups:[],exploded:true}]){const shell=structuralShell(state);assert.ok(shell.removedArea>0);noBuried(shell.patches,shell.boxes);noDuplicates(shell.patches);for(const expected of solidShell(shell.boxes)){const direction=shellDirections.find(d=>d.axis===expected.axis&&d.sign===expected.sign),cover=shell.patches.filter(p=>p.axis===expected.axis&&Math.abs(p.coordinate-expected.coordinate)<1e-5&&(p.sign===expected.sign||p.doubleSided)).map(p=>shellProjection({...pointBounds(shellCorners(p)),owner:p.owner},direction));assert.ok(rectUnion([expected.rect],cover).reduce((n,r)=>n+r.width*r.height,0)<1e-4,`missing boundary ${expected.owner}`);}assert.equal(editableBuildingFaces().length,136);}
 const whole=structuralShell(),closed=solidShell(whole.boxes);let expected=0;for(let i=0;i<whole.boxes.length;i++){let pending=[whole.boxes[i]];for(const previous of whole.boxes.slice(0,i))pending=pending.flatMap(p=>subtractBox(p,previous));expected+=pending.reduce((sum,p)=>sum+p.max.reduce((v,n,k)=>v*(n-p.min[k]),1),0);}assert.ok(Math.abs(volume(closed)-expected)<1,`${volume(closed)} versus ${expected}`);
 const exploded=structuralShell({hiddenFloors:[],hiddenGroups:[],exploded:true});whole.boxes.forEach((b,i)=>assert.equal(exploded.boxes[i].min[1]-b.min[1],floorOffsetMm(b.floorId,b.viewGroup)));
 const state={materials:c.materials,finishes:Object.fromEntries(c.walls.map(w=>[w.id,{...c.defaultTile,materialId:w.finishZones[0].materialId}]))},report=inspectModel(state);assert.equal(report.issues.filter(i=>i.category==='wall').length,0);assert.ok(report.mergedJunctions>0);assert.ok(report.issues.some(i=>i.category==='evidence'&&i.certainty==='review'));
});
test('inspection zoom cannot re-execute a stale focus and reset restores the building-centred orbit',()=>{
 const bounds=structuralShell().bounds,base={position:[22,19.5,32],target:[0,6.5,0]},command={view:'perspective',sequence:1,focus:{owner:'issue',min:[-5000,0,6000],max:[-4800,3800,6200]}},focused=cameraNavigation(base,command,bounds),zoom=cameraNavigation(focused,{...command,zoom:.8},bounds),distance=pose=>Math.hypot(...pose.position.map((n,i)=>n-pose.target[i]));assert.ok(Math.abs(distance(zoom)-distance(focused)*.8)<1e-8);assert.deepEqual(zoom.target,focused.target);
 let close=zoom;for(let i=0;i<40;i++)close=cameraNavigation(close,{view:'perspective',sequence:i,zoom:.8},bounds);assert.ok(Math.abs(distance(close)-cameraLimits.min)<1e-8);assert.ok(distance(close)<5);
 const reset=cameraNavigation(close,{view:'perspective',sequence:99},bounds);assert.deepEqual(reset.target,bounds.min.map((n,i)=>(n+bounds.max[i])/2000));assert.deepEqual(reset,cameraNavigation(base,{view:'perspective',sequence:0},bounds));assert.equal(cameraNavigation(reset,{view:'right',sequence:100},bounds).position[0]-reset.target[0],32);
});
