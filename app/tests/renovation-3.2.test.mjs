import test from 'node:test';
import assert from 'node:assert/strict';
import { firstFloorClosurePatches, editableBuildingFaces, modelWalls, junctionFillers } from '../src/renovation3d/utils/model-surfaces.ts';
import { buildingBodies, planeRect, worldPoint } from '../src/renovation3d/utils/geometry.ts';
import { faceSolids } from '../src/renovation3d/utils/wall-surfaces.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';

const groundRect = box => ({ x: box.min[0], y: box.min[2], width: box.max[0]-box.min[0], height: box.max[2]-box.min[2] });
const patches = firstFloorClosurePatches.map(p => groundRect(planeRect(p, { x:0, y:0, width:p.widthMm, height:p.heightMm }, 0)));
test('first-floor closure fills the indoor L shape and leaves the entrance porch empty', () => {
  assert.deepEqual(patches, [
    { x:-4960, y:-5960, width:9920, height:10360 },
    { x:-4960, y:4400, width:3950, height:1560 },
  ]);
  const contains = (x,z) => patches.some(r => x>r.x && x<r.x+r.width && z>r.y && z<r.y+r.height);
  assert.ok(contains(0,0)); assert.ok(contains(-3000,5500));
  assert.equal(contains(1000,5500),false,'outdoor entrance is not closed');
  assert.equal(contains(5120,0),false,'no new strip outside the wall');
  assert.ok(firstFloorClosurePatches.every(p => worldPoint(p,[0,0,0])[1]===0));
});
test('first-floor closure has no overlap with itself, exterior ground skins or masonry footprints', () => {
  const masonry=[...buildingBodies(modelWalls.filter(w=>w.floorId==='f1').map(w=>({...w,openings:[]})),[]),...junctionFillers]
    .filter(b=>b.min[1]<=0&&b.max[1]>0).map(groundRect);
  const floors=editableBuildingFaces().filter(f=>f.rotationX && Math.abs(f.originMm[1])<1e-5)
    .flatMap(f=>faceSolids(f).map(r=>groundRect(planeRect(f,r,0))));
  for(let i=0;i<patches.length;i++)for(const mask of [...patches.slice(i+1),...masonry,...floors]){
    const hit=intersect(patches[i],mask);assert.ok(!hit||hit.width*hit.height<1e-4);
  }
  assert.equal(editableBuildingFaces().length,136,'structural closure does not add selectable or billable surfaces');
});
