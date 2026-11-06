import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { validateState } from '../src/renovation3d/utils/validation.ts';
import { buildWindowReport, updateWindow, windowExportPayload, windowRowValues } from '../src/renovation3d/utils/window-report.ts';
import { captureWindowType, replaceSameWindows, matchingWindows } from '../src/renovation3d/utils/window-actions.ts';
import { glassUpgrades } from '../src/renovation3d/utils/glass-upgrades.ts';
import { resolveWindowFinish } from '../src/renovation3d/utils/window-finishes.ts';
import { recordWindowQuote, quoteInfo } from '../src/renovation3d/utils/window-quotes.ts';
import { EditHistory, sameEdits } from '../src/renovation3d/utils/edit-history.ts';
import { comparePlans } from '../src/renovation3d/utils/plan-comparison.ts';

const windows = config.walls.flatMap(w => w.openings).filter(o => o.kind === 'window');
const seed = () => validateState({ schemaVersion:1,buildingId:config.id,materials:config.materials,finishes:Object.fromEntries(config.walls.map(w=>[w.id,{...config.defaultTile,materialId:w.finishZones[0].materialId,preserveZoning:true}])),hiddenFloors:[],exploded:false });
const group = state => { const source=windows.find(o=>captureWindowType(o,state).ids.length>1); assert.ok(source);return {source,baseline:captureWindowType(source,state)}; };

test('old window snapshots retain original totals and valid quote evidence without an upgrade',()=>{
 let s=seed();s=recordWindowQuote(s,windows[0].id,'confirmed','旧报价','2026-10-26',true);
 const old=structuredClone(s),row=buildWindowReport(validateState(s))[0];
 assert.equal(row.upgradeAmountCents,0);assert.equal(row.glassUpgrade,undefined);
 assert.equal(row.amountCents,Math.round((row.area*500+row.sashCount*500)*100));
 assert.equal(quoteInfo(windows[0],resolveWindowFinish(windows[0],s)).status,'confirmed');assert.deepEqual(s,old);
});
test('all four LOWE upgrade presets add full window area cost, allow zero/custom prices and remove cleanly',()=>{
 const s=seed(),id='f1-s-window',before=buildWindowReport(s).find(r=>r.id===id);
 assert.deepEqual(Object.values(glassUpgrades),[28,55,203,350]);
 for(const [spec,pricePerM2] of Object.entries(glassUpgrades)){
  const next=updateWindow(s,id,{glassUpgrade:{spec,pricePerM2}}),row=buildWindowReport(next).find(r=>r.id===id);
  assert.equal(row.amountCents-before.amountCents,Math.round(before.area*pricePerM2*100));
  assert.deepEqual(windowExportPayload([row],'升级','2026-11-05').rows[0].glassUpgrade,{spec,pricePerM2});
  assert.equal(windowRowValues(row).length,15);assert.equal(windowRowValues(row).at(-1),row.amountCents/100);
  assert.equal(buildWindowReport(updateWindow(next,id,{glassUpgrade:undefined})).find(r=>r.id===id).amountCents,before.amountCents);
 }
 const free=buildWindowReport(updateWindow(s,id,{glassUpgrade:{spec:'6',pricePerM2:0}})).find(r=>r.id===id);assert.equal(free.amountCents,before.amountCents);
 for(const glassUpgrade of [{spec:5,pricePerM2:28},{spec:'7',pricePerM2:28},{spec:'5',pricePerM2:-1},{spec:'5',pricePerM2:NaN},{spec:'5',pricePerM2:1000001},null])assert.throws(()=>updateWindow(s,id,{glassUpgrade}));
});
test('upgrade specification and custom price invalidate previous confirmed quotes and appear in comparison',()=>{
 let s=recordWindowQuote(seed(),windows[0].id,'confirmed','商家已确认','2026-11-05',true);
 const next=updateWindow(s,windows[0].id,{glassUpgrade:{spec:'6',pricePerM2:55}});
 assert.equal(quoteInfo(windows[0],resolveWindowFinish(windows[0],next)).status,'stale');
 assert.equal(comparePlans(s,next).windowChanges.length,1);
 const quoted=recordWindowQuote(next,windows[0].id,'merchant','升级报价单','2026-11-05',false);
 assert.equal(quoteInfo(windows[0],resolveWindowFinish(windows[0],quoted)).status,'merchant');
 const changed=updateWindow(quoted,windows[0].id,{glassUpgrade:{spec:'6',pricePerM2:56}});
 assert.equal(quoteInfo(windows[0],resolveWindowFinish(windows[0],changed)).status,'stale');
});
test('batch replacement is disabled before edits and copies all finish/pricing fields, retains names and old quotes',()=>{
 let s=seed();const {source,baseline}=group(s),target=windows.find(o=>o.id===baseline.ids.find(id=>id!==source.id));
 assert.equal(replaceSameWindows(s,source,baseline).state,s);
 s=updateWindow(s,target.id,{name:'保留本樘窗名'});s=recordWindowQuote(s,target.id,'merchant','原目标报价','2026-10-26',false);
 s=updateWindow(s,source.id,{frameColor:'#123456',glassType:'high',sashCount:3,pricePerM2:777,sashPrice:99,glassUpgrade:{spec:'8',pricePerM2:201.25}});
 s=recordWindowQuote(s,source.id,'confirmed','来源报价','2026-11-05',true);
 const before=structuredClone(s),result=replaceSameWindows(s,source,baseline),finish=resolveWindowFinish(target,result.state);
 assert.equal(result.count,baseline.ids.length-1);assert.equal(finish.name,'保留本樘窗名');
 for(const key of ['frameColor','glassType','sashCount','pricePerM2','sashPrice','glassUpgrade'])assert.deepEqual(finish[key],s.windowFinishes[source.id][key]);
 assert.equal(finish.quotes[0].source,'原目标报价');assert.equal(finish.quotes[1].configuration.openingId,target.id);
 assert.match(finish.quotes[1].source,/沿用W/);assert.equal(finish.quotes[1].status,'merchant');assert.equal(finish.quotes[1].checked,false);
 assert.equal(quoteInfo(target,finish).status,'merchant');assert.deepEqual(s,before);assert.deepEqual(validateState(result.state),result.state);
 const h=new EditHistory(s);h.update(result.state);assert.ok(sameEdits(h.travel(),s));assert.ok(sameEdits(h.travel(true),result.state));
});
test('quote-only edits can propagate and windows independently edited since selection are not overwritten',()=>{
 const s=seed(),{source,baseline}=group(s),target=baseline.ids.find(id=>id!==source.id);
 const quoted=recordWindowQuote(s,source.id,'merchant','统一报价','2026-11-05',false);
 assert.ok(replaceSameWindows(quoted,source,baseline).count>0);
 const changed=updateWindow(quoted,target,{pricePerM2:123});const result=replaceSameWindows(changed,source,baseline);
 assert.equal(result.state.windowFinishes[target].pricePerM2,123);
 assert.equal(result.count,baseline.ids.length-2);assert.ok(!matchingWindows(changed,baseline.key).includes(target));
});
