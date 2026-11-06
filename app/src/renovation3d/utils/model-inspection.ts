import { buildingConfig as config } from '../config/building-config.ts';
import { editableBuildingFaces, modelWalls, junctionFillers, firstFloorClosurePatches } from './model-surfaces.ts';
import { buildingBodies, dot, planeRect, wallFrame, type Bounds } from './geometry.ts';
import { projectRects } from './coplanar-faces.ts';
import { faceBodyMasks } from './surface-intersections.ts';
import { faceSolids,resolveFaceFinish } from './wall-surfaces.ts';
import { structuralShell } from './structural-shell.ts';
import { intersect } from '../tile-layout/layout.ts';
import { rectUnion } from './outline.ts';
import type { RenovationState, WallFace } from '../types';

export type ModelIssue = { id: string; category: string; certainty: 'certain' | 'review'; title: string; evidence: string; faceIds: string[]; bounds: Bounds; repair?: 'unused-cover' };
const canonical = editableBuildingFaces();
const boundsOf = (face: WallFace) => { const boxes = faceSolids(face).map(r => planeRect(face, r, face.offsetMm)); return { owner: face.id, min: [0,1,2].map(i => Math.min(...boxes.map(b => b.min[i]))) as Bounds['min'], max: [0,1,2].map(i => Math.max(...boxes.map(b => b.max[i]))) as Bounds['max'] }; };
const area = (rects: WallFace['rects']) => rects.reduce((n,r) => n+r.width*r.height,0);
export function inspectModel(state: RenovationState, faces = canonical) {
  const issues: ModelIssue[] = [], bodies = [...buildingBodies(modelWalls, []), ...junctionFillers];
  const renderDepth=(face:WallFace)=>state.materials.find(m=>m.id===resolveFaceFinish(face,state).materialId)?.kind==='paint'?1:Math.max(1,face.claddingMm??config.scene.tileDepthMm);
  const add = (face: WallFace, category: string, title: string, evidence: string, certainty: ModelIssue['certainty'] = 'certain', other?: WallFace, source = '') => issues.push({ id: `${category}:${face.id}${other ? ':'+other.id : source ? ':'+source : ''}`, category, title, evidence, certainty, faceIds: [face.id, ...(other ? [other.id] : [])], bounds: boundsOf(face) });
  for (const [i,face] of faces.entries()) {
    const solids = faceSolids(face), n = wallFrame(face).n, masks = faceBodyMasks(face, bodies);
    const buried = solids.reduce((sum,r) => sum+area(masks.flatMap(m => { const p=intersect(r,m); return p?[p]:[]; })),0);
    if (buried>1) add(face,'penetration','装修面进入实体',`实体内部覆盖 ${(buried/1e6).toFixed(6)}㎡，应在相交边界停止。`);
    const expected = canonical.find(f => f.id===face.id);
    if (!expected) add(face,'indoor','非室外许可面','此面不在当前室外可铺贴面集合，不能据此认定室内可铺贴。');
    if (expected && (face.floorId!==expected.floorId || face.viewGroup!==expected.viewGroup)) add(face,'floor','楼层或底座归属不符',`许可归属 ${expected.viewGroup??expected.floorId}，当前 ${face.viewGroup??face.floorId}。`);
    for(const other of faces.slice(i+1)) {
      const otherN=wallFrame(other).n;
      if(Math.abs(dot(n,otherN))<.999 || Math.abs(dot(n,face.originMm)+face.offsetMm+renderDepth(face)-dot(n,other.originMm)-dot(n,otherN)*(other.offsetMm+renderDepth(other)))>1e-4) continue;
      const overlap=area(solids.flatMap(r=>projectRects(other,face,faceSolids(other)).flatMap(s=>{const p=intersect(r,s);return p?[p]:[];})));
      if(overlap>1) add(face,'overlap','共面重复覆盖',`重叠面积 ${(overlap/1e6).toFixed(6)}㎡；只检查实际实体面，合法洞口不参与。`,'certain',other);
    }
  }
  for(const expected of canonical) {
    const n=wallFrame(expected).n;
    const covered=faces.filter(f=>dot(n,wallFrame(f).n)>.999&&Math.abs(dot(n,f.originMm)+f.offsetMm-dot(n,expected.originMm)-expected.offsetMm)<1e-4).flatMap(f=>projectRects(f,expected,faceSolids(f)));
    const missing=area(rectUnion(faceSolids(expected),covered));
    if(missing>1) add(expected,'missing','已建模室外面缺失',`相对当前标准模型缺少 ${(missing/1e6).toFixed(6)}㎡；未将门窗或封底作为缺面。`);
  }
  const wallPairs=new Set<string>();
  for(let i=0;i<bodies.length;i++) for(const b of bodies.slice(i+1)) {
    const a=bodies[i];if(a.owner===b.owner||a.owner.startsWith('join-')||b.owner.startsWith('join-'))continue;
    const low=a.min.map((v,k)=>Math.max(v,b.min[k])),high=a.max.map((v,k)=>Math.min(v,b.max[k]));
    if(low.some((v,k)=>high[k]-v<1))continue;
    const key=[a.owner,b.owner].sort().join(':');if(wallPairs.has(key))continue;wallPairs.add(key);

  }
  for(const wall of modelWalls.filter(w=>!w.surfaceOnly&&w.evidence.status==='pending')) {
    const face=faces.find(f=>f.sourceWallIds.includes(wall.id));if(face)add(face,'evidence','尺寸或定位待核实',`${wall.id}：${wall.evidence.note}`,'review',undefined,wall.id);
  }
  const allowed = new Set(faces.map(f=>f.id));
  for(const id of Object.keys(state.faceFinishes??{})) if(!allowed.has(id)) issues.push({id:`unused:${id}`,category:'indoor',certainty:'certain',title:'非许可覆盖记录',evidence:'此覆盖ID不属于当前室外面；不会把它显示为合法室内铺贴。可显式清理，历史方案不回写。',faceIds:[],bounds:{owner:id,min:[-5160,0,-6160],max:[5160,3800,6160]},repair:'unused-cover'});
  const shell=structuralShell();
  return { issues, mergedJunctions:wallPairs.size,structuralPatches:shell.patches.length,removedStructuralArea:shell.removedArea/1e6,legalOpenings: config.walls.flatMap(w=>w.openings).length, structuralClosures: firstFloorClosurePatches.length+config.parts.filter(p=>p.kind==='slab').length, faceCount:faces.length };
}
export function repairIssue(state: RenovationState, issue: ModelIssue) {
  if(issue.certainty!=='certain'||issue.repair!=='unused-cover')throw new Error('该项没有经验证的自动修复规则，请人工复核。');
  const faceFinishes={...state.faceFinishes};delete faceFinishes[issue.id.slice(7)];return {...state,faceFinishes};
}
