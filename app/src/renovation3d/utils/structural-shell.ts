import { buildingConfig as config } from '../config/building-config.ts';
import { modelWalls,junctionFillers,firstFloorClosurePatches,partViewGroup,floorOffsetMm } from './model-surfaces.ts';
import { buildingBodies,planeRect,type Bounds } from './geometry.ts';
import { isObjectVisible } from './view-groups.ts';
import { solidShell,shellProjection,shellDirections,type ShellBox,type ShellPlane } from './solid-shell.ts';
import type { RenovationState,Vec3 } from '../types';

type Display=Pick<RenovationState,'hiddenFloors'|'hiddenGroups'|'exploded'>;
const cache=new Map<string,ReturnType<typeof buildShell>>();
function buildShell(state:Display){
 const boxes:ShellBox[]=[],planes:ShellPlane[]=[],viewBounds:Bounds[]=[];
 const shift=(floorId:string,viewGroup?:string)=>state.exploded?floorOffsetMm(floorId,viewGroup):0;
 const moved=(box:Bounds,offset:number)=>({...box,min:box.min.map((n,i)=>n+(i===1?offset:0)) as Vec3,max:box.max.map((n,i)=>n+(i===1?offset:0)) as Vec3});
 for(const wall of modelWalls.filter(w=>isObjectVisible(w,state)))for(const body of buildingBodies([wall],[]))boxes.push({...moved(body,shift(wall.floorId,wall.viewGroup)),floorId:wall.floorId,viewGroup:wall.viewGroup,color:config.structureColor});
 for(const fill of junctionFillers.filter(b=>!state.hiddenFloors.includes(b.floorId)))boxes.push({...moved(fill,shift(fill.floorId)),floorId:fill.floorId,color:config.structureColor});
 for(const part of config.parts){
  const viewGroup=partViewGroup(part);if(!isObjectVisible({...part,viewGroup},state))continue;
  const offset=shift(part.floorId,viewGroup),box=moved({owner:part.id,min:part.centerMm.map((n,i)=>n-part.sizeMm[i]/2) as Vec3,max:part.centerMm.map((n,i)=>n+part.sizeMm[i]/2) as Vec3},offset);
  viewBounds.push(box);
  if(part.kind==='step')boxes.push({...box,floorId:part.floorId,viewGroup,color:part.color});
  if(part.kind==='slab')planes.push({owner:part.id,floorId:part.floorId,viewGroup,color:part.color,axis:1,coordinate:box.max[1],rect:shellProjection(box,shellDirections[4])});
 }
 if(!state.hiddenFloors.includes('f1')&&(state.exploded||state.hiddenGroups?.includes('base')))for(const patch of firstFloorClosurePatches){
  const box=moved({...planeRect(patch,{x:0,y:0,width:patch.widthMm,height:patch.heightMm},0),owner:patch.id},shift('f1'));
  planes.push({owner:patch.id,floorId:'f1',color:patch.color,axis:1,coordinate:box.min[1],rect:shellProjection(box,shellDirections[4])});
 }
 const patches=solidShell(boxes,planes),rawArea=boxes.reduce((sum,b)=>{const [x,y,z]=b.max.map((n,i)=>n-b.min[i]);return sum+2*(x*y+x*z+y*z);},0)+planes.reduce((sum,p)=>sum+p.rect.width*p.rect.height,0),shellArea=patches.reduce((sum,p)=>sum+p.rect.width*p.rect.height,0);
 const extents=[...boxes,...viewBounds];
 const bounds:Bounds=extents.length?{owner:'building',min:[0,1,2].map(i=>Math.min(...extents.map(b=>b.min[i]))) as Vec3,max:[0,1,2].map(i=>Math.max(...extents.map(b=>b.max[i]))) as Vec3}:{owner:'building',min:[-1000,0,-1000],max:[1000,1000,1000]};
 return {boxes,planes,patches,bounds,rawArea,shellArea,removedArea:rawArea-shellArea};
}
export function structuralShell(state:Display={hiddenFloors:[],hiddenGroups:[],exploded:false}){
 const key=`${[...state.hiddenFloors].sort().join(',')}|${[...(state.hiddenGroups??[])].sort().join(',')}|${state.exploded}`;
 let shell=cache.get(key);if(!shell){shell=buildShell(state);if(cache.size>=16)cache.delete(cache.keys().next().value!);cache.set(key,shell);}return shell;
}
