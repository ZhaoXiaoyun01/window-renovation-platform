import { rectUnion } from './outline.ts';
import { intersect } from '../tile-layout/layout.ts';
import { rounded, type Bounds } from './geometry.ts';
import type { Rect, Vec3, ViewGroup } from '../types';

type Owner={owner:string;floorId:string;viewGroup?:ViewGroup;color:string};
export type ShellBox=Bounds & Owner;
export type ShellPlane=Owner & {axis:0|1|2;coordinate:number;rect:Rect};
export type ShellPatch=Owner & {axis:0|1|2;sign:1|-1;coordinate:number;rect:Rect;doubleSided?:boolean};
export const shellDirections=[
 {axis:0,sign:1,u:[0,0,-1],v:[0,1,0]}, {axis:0,sign:-1,u:[0,0,1],v:[0,1,0]},
 {axis:2,sign:1,u:[1,0,0],v:[0,1,0]}, {axis:2,sign:-1,u:[-1,0,0],v:[0,1,0]},
 {axis:1,sign:1,u:[1,0,0],v:[0,0,-1]}, {axis:1,sign:-1,u:[1,0,0],v:[0,0,1]},
] as const;
export function shellProjection(box:Bounds,direction:typeof shellDirections[number]):Rect{
 const span=(vector:readonly number[])=>{const axis=vector.findIndex(n=>n!==0);return vector[axis]>0?[box.min[axis],box.max[axis]]:[-box.max[axis],-box.min[axis]];};
 const [x,x2]=span(direction.u),[y,y2]=span(direction.v);return {x,y,width:x2-x,height:y2-y};
}
export function shellCorners(patch:Pick<ShellPatch,'axis'|'sign'|'coordinate'|'rect'>):Vec3[]{
 const {u,v}=shellDirections.find(d=>d.axis===patch.axis&&d.sign===patch.sign)!,r=patch.rect;
 return [[r.x,r.y],[r.x+r.width,r.y],[r.x+r.width,r.y+r.height],[r.x,r.y+r.height]].map(([x,y])=>[0,1,2].map(i=>rounded(u[i]*x+v[i]*y+(i===patch.axis?patch.coordinate:0))) as Vec3);
}
const epsilon=1e-5;
// Boundary of the union: retain air-facing faces, never faces inside another
// solid. Thin floor sheets own coincident caps without inventing slab thickness.
export function solidShell(boxes:ShellBox[],planes:ShellPlane[]=[]):ShellPatch[]{
 const patches:ShellPatch[]=[],claimed=new Map<string,Rect[]>();
 const key=(axis:number,sign:number,c:number)=>`${axis}:${sign}:${rounded(c)}`;
 const add=(patch:ShellPatch,masks:Rect[])=>{
  const k=key(patch.axis,patch.sign,patch.coordinate),old=claimed.get(k)??[];
  const clipped=[...masks,...old].flatMap(mask=>{const r=intersect(patch.rect,mask);return r?[r]:[];});
  const rects=rectUnion([patch.rect],clipped);claimed.set(k,[...old,...rects]);
  for(const rect of rects)patches.push({...patch,rect});
  return rects;
 };
 for(const plane of planes){
  const direction=shellDirections.find(d=>d.axis===plane.axis&&d.sign===1)!;
  const masks=boxes.filter(b=>b.min[plane.axis]<plane.coordinate-epsilon&&b.max[plane.axis]>plane.coordinate+epsilon).map(b=>shellProjection(b,direction));
  const rects=add({...plane,sign:1,doubleSided:true},masks);
  const opposite=shellDirections.find(d=>d.axis===plane.axis&&d.sign===-1)!;
  const reverse=rects.map(rect=>{const points=shellCorners({...plane,sign:1,rect}),box={owner:'sheet',min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))) as Vec3,max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i]))) as Vec3};return shellProjection(box,opposite);});
  const k=key(plane.axis,-1,plane.coordinate);claimed.set(k,[...(claimed.get(k)??[]),...reverse]);
 }
 for(const box of boxes)for(const direction of shellDirections){
  const {axis,sign}=direction,coordinate=sign>0?box.max[axis]:box.min[axis];
  const masks=boxes.filter(other=>other!==box&&(sign>0?other.min[axis]<=coordinate+epsilon&&other.max[axis]>coordinate+epsilon:other.max[axis]>=coordinate-epsilon&&other.min[axis]<coordinate-epsilon)).map(other=>shellProjection(other,direction));
  add({owner:box.owner,floorId:box.floorId,viewGroup:box.viewGroup,color:box.color,axis,sign,coordinate,rect:shellProjection(box,direction)},masks);
 }
 const groups=new Map<string,ShellPatch[]>();
 for(const patch of patches){const k=JSON.stringify([patch.axis,patch.sign,patch.coordinate,patch.floorId,patch.viewGroup,patch.color,!!patch.doubleSided]);groups.set(k,[...(groups.get(k)??[]),patch]);}
 return [...groups.values()].flatMap(group=>rectUnion(group.map(p=>p.rect)).map(rect=>({...group[0],rect})));
}
