import type { Vec3 } from '../types';
export type CameraPose={source:string;position:Vec3;target:Vec3};
export class CameraLink{
 private listeners=new Set<(pose:CameraPose)=>void>();
 subscribe(listener:(pose:CameraPose)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 emit(pose:CameraPose){for(const listener of this.listeners)listener(pose);}
}
