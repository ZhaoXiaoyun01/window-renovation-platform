import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { retiredFaces, retiredWalls } from '../src/renovation3d/config/geometry-compat.ts';
import { buildingFaces, faceGridWall, faceJointBands, faceSolids, faceTileLayout } from '../src/renovation3d/utils/wall-surfaces.ts';
import { tileStyleName } from '../src/renovation3d/utils/finish-actions.ts';
import { validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';
import { buildingBodies } from '../src/renovation3d/utils/geometry.ts';
import { faceBodyMasks } from '../src/renovation3d/utils/surface-intersections.ts';

const faces = buildingFaces(config.walls), wall = id => config.walls.find(w => w.id === id);
const fresh = () => ({ schemaVersion: 1, faceGroupingVersion: 3, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });

test('the two missing south balcony windows cut the back wall at drawing sill heights and retain separate glazing IDs', () => {
  for (const [floor, sill, height] of [['f2', 100, 2700], ['f3', 600, 2200]]) {
    const host = wall(`${floor}-porch-back`), opening = host.openings.find(o => o.id === `${floor}-balcony-slot`);
    assert.deepEqual([opening.kind, opening.x, opening.y, opening.width, opening.height], ['window', 0, sill, 600, height]);
    const face = faces.find(f => f.sourceWallIds.includes(host.id));
    for (const solid of faceSolids(face)) assert.equal(intersect(solid, opening), null);
    assert.ok(host.openings.some(o => o.id === `${floor}-balcony-door`));
  }
});

test('top grey bands reach the front corners and fold onto the recessed inner wall without an outer white strip', () => {
  const greyAt = (w, x, y) => w.finishZones.find(z => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height);
  for (const [id, x] of [['f4-left', 6699], ['f4-right', 1]]) {
    assert.equal(greyAt(wall(id), x, 2000).materialId, 'basalt');
    assert.equal(greyAt(wall(id), x, 2000).offsetMm, -60);
    assert.equal(greyAt(wall(id), x, 2900).materialId, 'ivory');
  }
  assert.ok(wall('f4-covered-left-inner').finishZones.every(z => z.materialId === 'basalt' && z.offsetMm === 0));
  const east = wall('f4-front-east');
  assert.equal(east.originMm[0] + east.widthMm, wall('f4-right').originMm[0] - 60);
});

test('roof parapet exteriors have a 20mm joint at 13700mm and no actual tile crosses its gap', () => {
  for (const owner of ['roof-front', 'roof-back', 'roof-side--1', 'roof-side-1']) {
    const face = faces.find(f => f.sourceWallIds.includes(owner));
    const band = faceJointBands(face).find(r => r.y + face.originMm[1] === 13700);
    assert.ok(band, owner); assert.equal(band.height, 20);
    for (const piece of faceTileLayout(face, faceGridWall(face, config.walls), config.defaultTile).pieces) assert.equal(intersect(piece, band), null);
  }
});

test('the grey covered-terrace inner finish stops at the actual roof fascia instead of extending inside the beam', () => {
  const face = faces.find(f => f.sourceWallIds.includes('f4-covered-left-inner'));
  const fascia = buildingBodies(config.walls.filter(w => w.id === 'roof-fascia'), []);
  for (const solid of faceSolids(face)) for (const mask of faceBodyMasks(face, fascia)) assert.equal(intersect(solid, mask), null);
});

test('the second-floor north upper patch is recessed with its two selectable 60mm returns', () => {
  const grey = faces.filter(f => f.sourceWallIds.includes('f2-back') && f.faceKey === 'north-stair-upper');
  assert.equal(grey.length, 1); assert.ok(grey.every(f => f.offsetMm === -60));
  assert.equal(config.walls.filter(w => /^relief-f2-back-v-/.test(w.id)).length, 2);
});

test('historical revision7: specific retired geometry inherits saved finishes once in memory while invalid retired parameters still reject', () => {
  const saved = fresh(), finish = { ...config.defaultTile, materialId: 'sand', widthMm: 45, heightMm: 145, preserveZoning: false };
  saved.finishes['relief-f2-back-v--1150--1-3800-4800'] = finish;
  saved.faceFinishes = { 'f2-back:face:-60': finish, 'f4-right:face:0': finish };
  const before = structuredClone(saved), restored = validateRevision7State(saved);
  assert.deepEqual(saved, before); assert.equal(restored.faceGroupingVersion, 7);
  assert.deepEqual(restored.faceFinishes['f2-back:face:-60:north-stair-upper'], finish);
  assert.deepEqual(restored.faceFinishes['f4-right:face:0:part:5560:0'], finish);
  restored.faceFinishes['f4-right:face:0'] = { ...finish, materialId: 'ivory' };
  assert.deepEqual(validateRevision7State(restored).faceFinishes['f4-right:face:0:part:5560:0'], finish);
  const invalid = structuredClone(saved); invalid.finishes['relief-f2-back-v--1150--1-3800-4800'].groutMm = -1;
  assert.throws(() => validateRevision7State(invalid));
  assert.throws(() => validateRevision7State({ ...fresh(), faceRegionFinishes: { 'relief-f2-back-v--1150--1-3800-4800:face:999': finish } }));
});

test('historical revision7: compatibility targets exist and are exact IDs rather than a permissive unknown-face pattern', () => {
  const faces = buildingFacesAtRevision7();
  for (const id of Object.values(retiredWalls).filter(Boolean)) assert.ok(wall(id), id);
  for (const id of Object.values(retiredFaces).filter(Boolean)) assert.ok(faces.some(f => f.id === id), id);
  assert.throws(() => validateRevision7State({ ...fresh(), faceFinishes: { 'f2-back:face:-61': { ...config.defaultTile, materialId: 'ivory' } } }));
});

test('custom names retain their original name and increment only the modification suffix across sibling versions', () => {
  assert.equal(tileStyleName({ name: '深灰岩板' }), '深灰岩板 · 修改1');
  assert.equal(tileStyleName({ name: '深灰岩板 · 修改1' }, [{ name: '深灰岩板 · 修改3' }, { name: '浅灰水泥 · 修改99' }]), '深灰岩板 · 修改4');
  assert.equal(tileStyleName({ name: '旧材料 45×145mm' }), '旧材料 45×145mm · 修改1');
});
