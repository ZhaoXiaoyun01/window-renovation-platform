import { useEffect,useMemo } from 'react';
import { BufferGeometry,Float32BufferAttribute,DoubleSide,FrontSide } from 'three';
import { structuralShell } from '../utils/structural-shell';
import { shellCorners } from '../utils/solid-shell';
import type { RenovationState } from '../types';

export function StructureMesh({state}:{state:RenovationState}){
 const shell=useMemo(()=>structuralShell(state),[state.hiddenFloors,state.hiddenGroups,state.exploded]);
 const meshes=useMemo(()=>{
  const groups=new Map<string,{color:string;doubleSided:boolean;positions:number[]}>();
  for(const patch of shell.patches){const key=`${patch.color}:${!!patch.doubleSided}`,group=groups.get(key)??{color:patch.color,doubleSided:!!patch.doubleSided,positions:[]},points=shellCorners(patch);for(const i of [0,1,2,0,2,3])group.positions.push(...points[i].map(n=>n/1000));groups.set(key,group);}
  return [...groups].map(([key,group])=>{const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(group.positions,3));geometry.computeVertexNormals();return {...group,key,geometry};});
 },[shell]);
 useEffect(()=>()=>meshes.forEach(m=>m.geometry.dispose()),[meshes]);
 return <group name="clean-structural-shell">{meshes.map(mesh=><mesh key={mesh.key} geometry={mesh.geometry} castShadow receiveShadow onClick={e=>e.stopPropagation()}><meshStandardMaterial color={mesh.color} side={mesh.doubleSided?DoubleSide:FrontSide}/></mesh>)}</group>;
}
