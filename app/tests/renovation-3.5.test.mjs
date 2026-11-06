import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as c } from '../src/renovation3d/config/building-config.ts';
import { validateState } from '../src/renovation3d/utils/validation.ts';
import { elevationLayout } from '../src/renovation3d/utils/elevation-layout.ts';
import { materialCatalog,windowNumber } from '../src/renovation3d/utils/delivery-context.ts';
import { editableBuildingFaces } from '../src/renovation3d/utils/model-surfaces.ts';
import { faceCellLimit,faceFinishLayout,faceFinishRegions,faceGridWall } from '../src/renovation3d/utils/wall-surfaces.ts';
import { wallFrame,dot } from '../src/renovation3d/utils/geometry.ts';
import { buildMaterialReport,reportExportPayload } from '../src/renovation3d/utils/material-report.ts';
import { buildWindowReport,windowExportPayload } from '../src/renovation3d/utils/window-report.ts';
const seed=()=>validateState({schemaVersion:1,faceGroupingVersion:7,buildingId:c.id,materials:c.materials,finishes:Object.fromEntries(c.walls.map(w=>[w.id,{...c.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}])),hiddenFloors:[],exploded:false});
test('all elevations use actual layout pieces, code/catalog/window dimensions and explicit uncertainty without mutation',()=>{
 const s=seed(),before=structuredClone(s),faces=editableBuildingFaces(),normals={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0]};
 for(const [facade,normal] of Object.entries(normals)){
  const result=elevationLayout(s,facade,'方案<script>&"','2026-10-23 12:00:00'),expected=faces.filter(f=>dot(wallFrame(f).n,normal)>.999).reduce((n,face)=>n+faceFinishRegions(face,s).reduce((sum,r)=>sum+(s.materials.find(m=>m.id===r.finish.materialId).kind==='paint'?0:faceFinishLayout(r.face,faceGridWall(face,c.walls),r.finish,s,faceCellLimit(face,s,c.scene.maxCellsPerWall)).pieces.length),0),0);
  assert.equal(result.pieceCount,expected);assert.equal(result.width,2400);assert.ok(result.height>2000);assert.match(result.svg,/待.*核实/);assert.match(result.svg,/4\.1/);assert.ok(!result.svg.includes('<script>'));assert.ok(result.svg.includes('&lt;script&gt;&amp;&quot;'));
  assert.deepEqual(result.catalog,materialCatalog(faces,s));for(const id of result.visibleWindows){assert.ok(result.svg.includes(windowNumber(id)));const o=c.walls.flatMap(w=>w.openings).find(o=>o.id===id);assert.ok(result.svg.includes(`${o.width}×${o.height}`)||o.width<=650);}
 }
 assert.deepEqual(s,before);
});
test('delivery payloads retain numeric rows, source IDs, consistent material codes and unverified dimension provenance',()=>{
 const s=seed(),report=buildMaterialReport(editableBuildingFaces(),s),payload=reportExportPayload(report,'方案','2026-10-23','saved-id');assert.equal(payload.metadata.applicationVersion,'4.1');assert.equal(payload.metadata.basePlanId,'saved-id');assert.deepEqual(payload.catalog.map(r=>r.code),report.catalog.map(r=>r.code));
 const rows=buildWindowReport(s),windows=windowExportPayload(rows,'方案','2026-10-23');assert.equal(windows.rows.length,38);assert.ok(windows.rows.every(r=>r.code.startsWith('W')&&r.dimensionStatus.includes('待')&&r.dimensionNote));assert.equal(windows.rows[0].pricePerM2,500);
});
test('image textures share one embedded source and rotate with the same tile direction as 3D',()=>{
 const s=seed(),image='data:image/jpeg;base64,/9j/2Q==';
 s.materials=s.materials.map(m=>({...m,image}));
 for(const id of Object.keys(s.faceFinishes))s.faceFinishes[id]={...s.faceFinishes[id],widthMm:600,heightMm:1200,direction:'horizontal'};
 const horizontal=elevationLayout(s,'front','图片方向');
 assert.equal((horizontal.svg.match(/<image /g)||[]).length,1);assert.ok((horizontal.svg.match(/<use /g)||[]).length>1);assert.match(horizontal.svg,/rotate\(-90\) scale\(600 1200\)/);
 for(const id of Object.keys(s.faceFinishes))s.faceFinishes[id].direction='vertical';
 const vertical=elevationLayout(s,'front','图片方向');assert.ok(!vertical.svg.includes('rotate(-90)'));assert.match(vertical.svg,/transform="scale\(600 1200\)"/);
});
