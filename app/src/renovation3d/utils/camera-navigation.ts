import { buildingConfig as config } from '../config/building-config.ts';
import type { Bounds } from './geometry.ts';
import type { Vec3,View } from '../types';
export type CameraCommand={view:View;sequence:number;zoom?:number;focus?:Bounds};
export type CameraPose={position:Vec3;target:Vec3};
export const cameraLimits={min:.4,max:90};
export function cameraNavigation(pose:CameraPose,command:CameraCommand,bounds:Bounds):CameraPose{
 if(command.zoom){
  const offset=pose.position.map((n,i)=>n-pose.target[i]),distance=Math.hypot(...offset),next=Math.max(cameraLimits.min,Math.min(cameraLimits.max,distance*command.zoom));
  return {target:[...pose.target],position:offset.map((n,i)=>pose.target[i]+n*(distance?next/distance:1)) as Vec3};
 }
 const box=command.focus??bounds,target=box.min.map((n,i)=>(n+box.max[i])/2000) as Vec3;
 if(command.focus){const d=Math.max(1,...box.max.map((n,i)=>(n-box.min[i])/1000*1.8));return {target,position:target.map((n,i)=>n+d*[1,.65,1][i]) as Vec3};}
 const r=config.scene.cameraMm[2]/1000,offset:Record<View,Vec3>={perspective:[config.scene.cameraMm[0]/1000,(config.scene.cameraMm[1]-config.scene.targetMm[1])/1000,r],front:[0,0,r],back:[0,0,-r],left:[-r,0,0],right:[r,0,0]};
 return {target,position:target.map((n,i)=>n+offset[command.view][i]) as Vec3};
}
