import { buildingConfig as config } from '../config/building-config.ts';
import { glassPresets } from '../config/window-config.ts';
import { editableBuildingFaces } from './model-surfaces.ts';
import { faceCellLimit,faceFinishLayout,faceFinishRegions,faceGridWall,faceSolids } from './wall-surfaces.ts';
import { wallFrame,worldPoint,dot } from './geometry.ts';
import { resolveWindowFinish,windowGeometry } from './window-finishes.ts';
import { styleFingerprint } from './finish-actions.ts';
import { facadeLabels } from './units.ts';
import { clientTimestamp,materialCatalog,renovationVersion,windowNumber } from './delivery-context.ts';
import { tileDimensions } from '../tile-layout/layout.ts';
import type { Facade, Rect, RenovationState, Vec3 } from '../types';

export const escapeXml=(value:unknown)=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const escape=escapeXml;
export const elevationNameToken='__RENOVATION_PLAN_NAME_3_6__';
const normals:Record<Facade,Vec3>={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0]};
export function elevationLayout(state:RenovationState,facade:Facade,name:string,generatedAt=clientTimestamp()){
 const faces=editableBuildingFaces(),catalog=materialCatalog(faces,state),normal=normals[facade],right:Vec3=[normal[2],0,-normal[0]],items:{depth:number;body:string;rect:Rect;coverage:Rect[];floorId:string;id:string}[]=[],labels:{x:number;y:number;code:string;depth:number}[]=[],defs:string[]=[],visibleWindows:string[]=[];
 const project=(object:{originMm:Vec3;rotationX?:number;rotationY:number},r:Rect,depth:number)=>{const points=[r.x,r.x+r.width].flatMap(x=>[r.y,r.y+r.height].map(y=>worldPoint(object,[x,y,depth])));const xs=points.map(p=>dot(p,right)),ys=points.map(p=>-p[1]);return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};};
 const rect=(r:Rect,fill:string,extra='')=>`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${escape(fill)}" ${extra}/>`;
 const text=(x:number,y:number,value:string,extra='')=>`<text x="${x}" y="${y}" ${extra}>${escape(value)}</text>`;
 const images=new Map<string,string>(),origins:{id:string;code:string;faceId:string;world:Vec3;anchor:{x:number;y:number};direction:string;alignment:string;depth:number}[]=[],originKeys=new Set<string>(),openingItems:{floorId:string;rect:Rect;code:string}[]=[];
 let pieceCount=0;
 for(const face of faces.filter(f=>dot(wallFrame(f).n,normal)>.999))for(const region of faceFinishRegions(face,state)){
  const {finish}=region,material=state.materials.find(m=>m.id===finish.materialId)!,key=JSON.stringify([material.id,styleFingerprint(material,finish)]),code=catalog.find(c=>c.key===key)!.code,depth=face.offsetMm+(material.kind==='paint'?1:Math.max(1,face.claddingMm??config.scene.tileDepthMm)),solids=faceSolids(region.face);
  if(!solids.length)continue;
  const projected=solids.map(r=>project(face,r,depth)),largest=projected.reduce((a,b)=>a.width*a.height>b.width*b.height?a:b),body:string[]=[];
  if(material.kind==='paint')for(const p of projected)body.push(rect(p,material.color));
  else {
   const layout=faceFinishLayout(region.face,faceGridWall(face,config.walls),finish,state,faceCellLimit(face,state,config.scene.maxCellsPerWall)),dimensions=tileDimensions(finish);pieceCount+=layout.pieces.length;
   if(layout.pieces.length){const first=layout.pieces[0],ox=first.x-first.uv[0]*dimensions.width-first.col*(dimensions.width+finish.groutMm),oy=first.y-first.uv[1]*dimensions.height-first.row*(dimensions.height+finish.groutMm),world=worldPoint(face,[ox,oy,depth]),originKey=JSON.stringify([code,world.map(v=>Math.round(v*100)/100)]);
    if(!originKeys.has(originKey)){originKeys.add(originKey);const anchor=worldPoint(face,[first.x,first.y,depth]);origins.push({id:`O${String(origins.length+1).padStart(2,'0')}`,code,faceId:face.id,world,anchor:{x:dot(anchor,right),y:-anchor[1]},direction:finish.direction,alignment:finish.alignment,depth:dot(worldPoint(face,[0,0,depth]),normal)});}}
   let fill=material.color;
   if(material.image&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(material.image)&&layout.pieces.length){
    let imageId=images.get(material.image);if(!imageId){imageId=`texture-${images.size}`;images.set(material.image,imageId);defs.push(`<image id="${imageId}" href="${material.image}" width="1" height="1" preserveAspectRatio="none"/>`);}
    const first=layout.pieces[0],full={x:first.x-first.uv[0]*dimensions.width,y:first.y-first.uv[1]*dimensions.height,width:dimensions.width,height:dimensions.height},p=project(face,full,depth),id=`pattern-${defs.length}`,rotated=finish.direction==='horizontal'?finish.widthMm<finish.heightMm:finish.widthMm>finish.heightMm,transform=rotated?`translate(0 ${dimensions.height}) rotate(-90) scale(${dimensions.height} ${dimensions.width})`:`scale(${dimensions.width} ${dimensions.height})`;
    defs.push(`<pattern id="${id}" x="${p.x}" y="${p.y}" width="${dimensions.width+finish.groutMm}" height="${dimensions.height+finish.groutMm}" patternUnits="userSpaceOnUse"><use href="#${imageId}" transform="${transform}"/></pattern>`);fill=`url(#${id})`;
   }
   for(const p of projected)body.push(rect(p,finish.groutColor));
   for(const piece of layout.pieces)body.push(rect(project(face,piece,depth),fill,`data-piece="${escape(piece.sourceTileId)}"`));
  }
  if(largest.width>=450&&largest.height>=240)body.push(text(largest.x+largest.width/2,largest.y+largest.height/2,code,'text-anchor="middle" class="material-label"'));
  else labels.push({x:largest.x+largest.width/2,y:largest.y+largest.height/2,code,depth:dot(worldPoint(face,[0,0,depth]),normal)});
  items.push({floorId:face.viewGroup??face.floorId,id:face.id,depth:dot(worldPoint(face,[0,0,depth]),normal),body:`<g data-face="${escape(face.id)}" data-material="${code}"><title>${escape(face.id+' · '+material.name+' · 尺寸待核实')}</title>${body.join('')}</g>`,coverage:projected,rect:{x:Math.min(...projected.map(r=>r.x)),y:Math.min(...projected.map(r=>r.y)),width:Math.max(...projected.map(r=>r.x+r.width))-Math.min(...projected.map(r=>r.x)),height:Math.max(...projected.map(r=>r.y+r.height))-Math.min(...projected.map(r=>r.y))}});
 }
 for(const wall of config.walls.filter(w=>!w.rotationX&&dot(wallFrame(w).n,normal)>.999))for(const opening of wall.openings.filter(o=>o.kind!=='balcony')){
  const finish=resolveWindowFinish(opening,state),r=project(wall,opening,-config.openings.depthMm),code=opening.kind==='window'?windowNumber(opening.id):`D${String(config.walls.flatMap(w=>w.openings.filter(o=>o.kind==='door')).findIndex(o=>o.id===opening.id)+1).padStart(2,'0')}`;
  let body=rect(r,opening.kind==='window'?glassPresets[finish.glassType].color:config.openings.doorColor,'stroke="#506056" stroke-width="8"');
  if(opening.kind==='window'){
   visibleWindows.push(opening.id);
   for(const frame of windowGeometry(opening).frames)body+=rect(project(wall,{...frame,x:opening.x+frame.x,y:opening.y+frame.y},-config.openings.depthMm),finish.frameColor);
  }
  body+=text(r.x+r.width/2,r.y+r.height/2,code+' †','text-anchor="middle" class="window-label"');
  if(r.width>650)body+=text(r.x+r.width/2,r.y+r.height/2+100,`${opening.width}×${opening.height} mm †`,'text-anchor="middle" class="window-label"');
  openingItems.push({floorId:wall.floorId,rect:r,code});
  items.push({floorId:wall.floorId,id:opening.id,depth:dot(worldPoint(wall,[opening.x,opening.y,-config.openings.depthMm]),normal),body:`<g data-window="${escape(opening.id)}"><title>${escape(opening.evidence.note)}</title>${body}</g>`,rect:r,coverage:[r]});
 }
 if(!items.length)throw new Error('该立面没有可生成的模型表面。');
 const minX=Math.min(...items.map(i=>i.rect.x)),maxX=Math.max(...items.map(i=>i.rect.x+i.rect.width)),minY=Math.min(...items.map(i=>i.rect.y)),maxY=Math.max(...items.map(i=>i.rect.y+i.rect.height)),margin=1250,diagramWidth=Math.max(12000,maxX-minX+margin*2),left=minX-margin,top=minY-1300,legendTop=maxY+800,legendRows=Math.ceil(catalog.length/2),originTop=legendTop+legendRows*240+260,chainTop=originTop+Math.ceil(origins.length/2)*150+500,detailTop=chainTop+config.floors.length*230+350,height=detailTop-top+2500;
 const dimensions:string[]=[];const line=(x1:number,y1:number,x2:number,y2:number)=>`<path d="M${x1} ${y1}L${x2} ${y2}" class="dimension"/>`;
 dimensions.push(line(minX,minY-300,maxX,minY-300),line(minX,minY-380,minX,minY-200),line(maxX,minY-380,maxX,minY-200),text((minX+maxX)/2,minY-420,`可见包络 ${(maxX-minX).toFixed(0)} mm †`,'text-anchor="middle"'));
 for(const floor of config.floors){const y=-floor.elevationMm,y2=-(floor.elevationMm+floor.heightMm);dimensions.push(line(minX-500,y,minX-500,y2),line(minX-580,y,minX-400,y),line(minX-580,y2,minX-400,y2),text(minX-620,(y+y2)/2,`${floor.label} ${floor.heightMm} †`,'text-anchor="end"'));}
 const visibleLabels=labels.filter(label=>!items.some(item=>item.depth>label.depth+.01&&item.coverage.some(r=>label.x>r.x&&label.x<r.x+r.width&&label.y>r.y&&label.y<r.y+r.height))).sort((a,b)=>a.y-b.y),positions:number[]=[];
 for(const label of visibleLabels)positions.push(Math.max(label.y,(positions.at(-1)??minY-130)+130));
 for(let i=positions.length-1;i>=0;i--)positions[i]=Math.min(positions[i],i===positions.length-1?maxY:positions[i+1]-130);
 visibleLabels.forEach((label,i)=>dimensions.push(line(label.x,label.y,maxX+200,positions[i]),text(maxX+250,positions[i]+20,label.code,'class="material-label"')));
 const legend=catalog.map((entry,index)=>{const x=left+300+(index%2)*(diagramWidth/2),y=legendTop+Math.floor(index/2)*240;return rect({x,y:y-65,width:100,height:100},entry.color,'stroke="#9aa694" stroke-width="3"')+text(x+140,y,`${entry.code} · ${entry.name} · ${entry.color}`)+text(x+140,y+100,entry.kind==='paint'?'连续漆面':`${entry.widthMm}×${entry.heightMm} mm † · ${entry.direction==='horizontal'?'长边横铺 →':'长边竖铺 ↑'} · ${entry.alignment==='edge'?'墙角起铺':'两侧均分'} · 缝${entry.groutMm}mm`);}).join('');
 const bodies=items.sort((a,b)=>a.depth-b.depth).map(i=>i.body).join('');
 const originTable=text(left+250,originTop-170,'起铺原点（世界XYZ / mm †；标签锚定首个可见砖格，不将可见裁片边当作全楼零点）','font-weight="600"')+origins.map((o,i)=>text(left+250+(i%2)*diagramWidth/2,originTop+Math.floor(i/2)*150,`${o.id} · ${o.code} · (${o.world.map(v=>Number(v.toFixed(1))).join(', ')}) † · ${o.direction==='horizontal'?'横铺 →':'竖铺 ↑'} / ${o.alignment==='edge'?'墙角':'均分'}`)).join('');
 const chainData=config.floors.map(floor=>{const parts=items.filter(i=>i.floorId===floor.id);if(!parts.length)return {floor:floor.label,marks:[],segments:[]};const lo=Math.min(...parts.map(i=>i.rect.x)),hi=Math.max(...parts.map(i=>i.rect.x+i.rect.width)),marks=[...new Set([lo,hi,...openingItems.filter(o=>o.floorId===floor.id).flatMap(o=>[o.rect.x,o.rect.x+o.rect.width])].map(n=>Math.round(n*1000)/1000))].sort((a,b)=>a-b);return {floor:floor.label,marks,segments:marks.slice(1).map((n,i)=>Number((n-marks[i]).toFixed(3)))};});
 const chains=text(left+250,chainTop-170,'各层水平投影尺寸链：外缘—洞口边—外缘（mm †；多进退面为投影定位，须复核节点）','font-weight="600"')+chainData.map((c,i)=>text(left+250,chainTop+i*230,`${c.floor}：${c.segments.map(n=>Number(n.toFixed(1))).join(' + ')} = ${Number(((c.marks.at(-1)??0)-(c.marks[0]??0)).toFixed(1))} †`)).join('');
 const isVisible=(item:typeof items[number])=>!items.some(other=>other.depth>item.depth+.01&&other.coverage.some(r=>item.rect.x+item.rect.width/2>r.x&&item.rect.x+item.rect.width/2<r.x+r.width&&item.rect.y+item.rect.height/2>r.y&&item.rect.y+item.rect.height/2<r.y+r.height));
 const narrow=items.filter(i=>i.body.includes('data-face=')&&Math.min(i.rect.width,i.rect.height)>=40&&Math.min(i.rect.width,i.rect.height)<400&&Math.max(i.rect.width,i.rect.height)>=200&&isVisible(i)).sort((a,b)=>a.rect.width*a.rect.height-b.rect.width*b.rect.height),windowItem=items.find(i=>i.body.includes('data-window=')&&isVisible(i)),details=[...narrow.slice(0,2),...(windowItem?[windowItem]:[])];
 const detailWidth=(diagramWidth-800)/3,detailHeight=1450;
 const detailDrawings=text(left+250,detailTop-150,'必要局部详图（自动选取可见窄面与一处洞口；实际模型裁片，尺寸仍待核实）','font-weight="600"')+details.map((item,i)=>{const x=left+250+i*(detailWidth+130),y=detailTop,r=item.rect,pad=Math.max(30,Math.min(r.width,r.height)*.2);return text(x,y+100,`J${i+1} · ${item.id}`,'style="font-size:50px"')+`<svg x="${x}" y="${y+220}" width="${detailWidth}" height="${detailHeight}" viewBox="${r.x-pad} ${r.y-pad} ${r.width+pad*2} ${r.height+pad*2}" preserveAspectRatio="xMidYMid meet" data-detail="${escape(item.id)}">${bodies}</svg>`+rect({x,y:y+220,width:detailWidth,height:detailHeight},'none','stroke="#a4ad9e" stroke-width="4"')+text(x,y+detailHeight+370,`投影包络 ${Number(r.width.toFixed(1))} × ${Number(r.height.toFixed(1))} mm †`);}).join('');
 const originMarks=origins.filter(o=>!items.some(i=>i.depth>o.depth+.01&&i.coverage.some(r=>o.anchor.x>r.x&&o.anchor.x<r.x+r.width&&o.anchor.y>r.y&&o.anchor.y<r.y+r.height))).map(o=>text(o.anchor.x+50,o.anchor.y-60,o.id,'class="origin-label"')).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="${Math.ceil(2400*height/diagramWidth)}" viewBox="${left} ${top} ${diagramWidth} ${height}" role="img" aria-label="${escape(facadeLabels[facade]+'二维排版图')}"><defs><style>text{font-family:Microsoft YaHei,sans-serif;font-size:65px;fill:#303a34}.material-label,.window-label{paint-order:stroke;stroke:white;stroke-width:14px;font-weight:600;font-size:75px}.origin-label{font-size:50px;fill:#7e4a12;paint-order:stroke;stroke:white;stroke-width:8px}.dimension{stroke:#74856d;stroke-width:4;fill:none}</style>${defs.join('')}</defs>${rect({x:left,y:top,width:diagramWidth,height},'#fff')}${text(left+200,top+230,`${facadeLabels[facade]} · 二维排版图`,'font-weight="600" style="font-size:120px"')}${text(left+200,top+420,`方案：${name} · 装修${renovationVersion}/格式1/分面11 · ${generatedAt}（Asia/Shanghai）`)}${text(left+200,top+590,'单位mm；†为图纸/模型/规格设定值，未完成现场或实物核实。正投影图，不作施工放样依据。')}${bodies}${originMarks}${dimensions.join('')}${legend}${originTable}${chains}${detailDrawings}${text(left+250,top+height-410,'说明：编号对应当前方案完整材质/规格/方向；按实际裁砖片段绘制，洞口扣除；不推定裁切余料复用。')}${text(left+250,top+height-240,'立面仅显示朝向该视图的竖向表面，深度遮挡按模型排序；水平地面/天花用料见3D及Excel明细。')}${text(left+250,top+height-80,'图片纹理按铺贴方向示意，不包含3D调色与光影；颜色以材料编号表和实物核对为准。')}</svg>`;
 return {svg,catalog,visibleWindows,pieceCount,origins,chains:chainData,detailIds:details.map(d=>d.id),width:2400,height:Math.ceil(2400*height/diagramWidth)};
}
export async function layoutPng(svg:string,width:number,height:number){
 const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw new Error('浏览器无法生成排版图片。');context.drawImage(image,0,0,width,height);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片导出失败。');return blob;}finally{URL.revokeObjectURL(url);}
}
