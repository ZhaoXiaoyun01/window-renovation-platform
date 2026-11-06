import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { validateState } from '../src/renovation3d/utils/validation.ts';
import { editableBuildingFaces } from '../src/renovation3d/utils/model-surfaces.ts';
import { EditHistory } from '../src/renovation3d/utils/edit-history.ts';
import { inspectModel,repairIssue } from '../src/renovation3d/utils/model-inspection.ts';
const state=()=>validateState({schemaVersion:1,faceGroupingVersion:7,buildingId:config.id,materials:config.materials,finishes:Object.fromEntries(config.walls.map(w=>[w.id,{...config.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}])),hiddenFloors:[],exploded:false});
test('edit history groups a drag, preserves view, branches redo and resets only on plan load',()=>{
 const initial=state(),h=new EditHistory(initial);h.begin();for(let i=0;i<20;i++)h.update({...h.current,partColors:{screen:`#0000${i.toString(16).padStart(2,'0')}`}});h.end();assert.equal(h.past.length,1);
 h.update({...h.current,hiddenFloors:['f2'],exploded:true});assert.equal(h.past.length,1);h.travel();assert.equal(h.current.partColors,initial.partColors);assert.deepEqual(h.current.hiddenFloors,['f2']);assert.equal(h.current.exploded,true);h.travel(true);assert.equal(h.current.partColors.screen,'#000013');
 h.travel();h.update({...h.current,partColors:{screen:'#ffffff'}});assert.equal(h.future.length,0);h.replace(initial);assert.equal(h.past.length,0);assert.equal(h.future.length,0);
});
test('inspection distinguishes current faces, intentional openings, injected duplicate/missing/wrong floor and uncertain joins',()=>{
 const s=state(),faces=editableBuildingFaces(),report=inspectModel(s);assert.equal(report.issues.filter(i=>i.certainty==='certain').length,0);assert.ok(report.legalOpenings>38);assert.ok(report.structuralClosures>0);
 const duplicate={...faces[0],id:'injected-duplicate'};assert.ok(inspectModel(s,[...faces,duplicate]).issues.some(i=>i.category==='overlap'));
 assert.ok(inspectModel(s,faces.slice(1)).issues.some(i=>i.category==='missing'));
 assert.ok(inspectModel(s,[{...faces[0],floorId:'f4'},...faces.slice(1)]).issues.some(i=>i.category==='floor'));
 const extra={...s,faceFinishes:{...s.faceFinishes,'indoor-injected':s.faceFinishes[faces[0].id]}},before=structuredClone(extra),issue=inspectModel(extra).issues.find(i=>i.repair);assert.ok(issue);const fixed=repairIssue(extra,issue);assert.ok(!fixed.faceFinishes['indoor-injected']);assert.deepEqual(extra,before);assert.throws(()=>repairIssue(s,report.issues.find(i=>i.certainty==='review')));
});
