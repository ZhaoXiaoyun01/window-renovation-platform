import { buildingConfig as config } from '../config/building-config.ts';
import { faceFinishRegions } from './wall-surfaces.ts';
import { styleFingerprint } from './finish-actions.ts';
import type { RenovationState, WallFace } from '../types';
export const renovationVersion='4.1';
export const clientTimestamp=()=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
const windowIds=config.walls.flatMap(w=>w.openings.filter(o=>o.kind==='window').map(o=>o.id));
export const windowNumber=(id:string)=>`W${String(windowIds.indexOf(id)+1).padStart(2,'0')}`;
export function deliveryMetadata(basePlanId=''){return {applicationVersion:renovationVersion,schemaVersion:1,faceGroupingVersion:11,basePlanId,source:config.source,measurementBasis:'当前编辑模型；净面积扣除洞口；每个排版格计整片，跨面余料不复用；先预留后整箱；分层与整楼分别进位。',dimensionNote:'模型尺寸或图纸标注值尚需现场复核；不得将估算/推导尺寸当作已核实施工尺寸。',snapshotType:'当前编辑快照；保存ID仅表示来源，不表示未保存修改已写入历史。'};}
export function materialCatalog(faces:WallFace[],state:RenovationState){
 const entries=new Map<string,{key:string;materialId:string;name:string;color:string;kind:'tile'|'paint';widthMm:number;heightMm:number;direction:'horizontal'|'vertical';alignment:'edge'|'center';groutMm:number;groutColor:string}>();
 for(const face of faces)for(const {finish} of faceFinishRegions(face,state)){const material=state.materials.find(m=>m.id===finish.materialId)!;const key=JSON.stringify([material.id,styleFingerprint(material,finish)]);if(!entries.has(key))entries.set(key,{key,materialId:material.id,name:material.name,color:material.color,kind:material.kind??'tile',widthMm:material.kind==='paint'?0:finish.widthMm,heightMm:material.kind==='paint'?0:finish.heightMm,direction:finish.direction,alignment:finish.alignment,groutMm:finish.groutMm,groutColor:finish.groutColor});}
 return [...entries.values()].sort((a,b)=>a.key.localeCompare(b.key)).map((entry,index)=>({...entry,code:`M${String(index+1).padStart(2,'0')}`}));
}
