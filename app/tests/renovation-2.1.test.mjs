import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFaces, faceSolids, faceFinishRegions } from '../src/renovation3d/utils/wall-surfaces.ts';
import { buildingBodies } from '../src/renovation3d/utils/geometry.ts';
import { screenBars } from '../src/renovation3d/utils/screen-geometry.ts';
import { validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';

const wall = id => config.walls.find(w => w.id === id), faces = buildingFaces(config.walls);
const zoneAt = (id, x, y) => wall(id).finishZones.find(z => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height);
const fresh = () => ({ schemaVersion: 1, faceGroupingVersion: 3, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });

test('top L bands turn at the parapet top and their lower white edges align with the third floor', () => {
  const top = wall('terrace-side-1').heightMm;
  assert.equal(top, 1200);
  for (const [id, x, neighbour] of [['f4-right', 439, 441], ['f4-left', 4761, 4759]]) {
    assert.deepEqual([zoneAt(id, x, top - 1).materialId, zoneAt(id, x, top - 1).offsetMm], ['ivory', 0]);
    assert.deepEqual([zoneAt(id, x, top).materialId, zoneAt(id, x, top).offsetMm], ['basalt', -60]);
    assert.equal(zoneAt(id, neighbour, top - 1).materialId, 'basalt');
  }
  const thirdEast = wall('f3-right'), fourthEast = wall('f4-right');
  assert.equal(thirdEast.originMm[2] - 6060, fourthEast.originMm[2] - 440);
  assert.equal(wall('f3-left').originMm[2] + 4760, wall('f4-left').originMm[2] + 4760);
  for (const id of ['relief-f4-left-v--1400--1-10400-11600', 'relief-f4-right-v--100-1-10400-11600']) {
    assert.equal(wall(id).widthMm, 60); assert.equal(wall(id).heightMm, top);
    assert.ok(faces.some(f => f.sourceWallIds.includes(id)));
  }
});

test('only the north stair window lower patch becomes flush white while the upper patch stays grey', () => {
  assert.deepEqual([zoneAt('f2-back', 3600, 500).materialId, zoneAt('f2-back', 3600, 500).offsetMm], ['ivory', 0]);
  assert.deepEqual([zoneAt('f2-back', 3600, 2800).materialId, zoneAt('f2-back', 3600, 2800).offsetMm], ['basalt', -60]);
  assert.equal(zoneAt('f3-back', 3600, 500).materialId, 'basalt');
});

test('second-floor narrow glazing follows both edges of its neighbouring full-height window only on that floor', () => {
  const host = wall('f2-porch-back'), narrow = host.openings.find(o => o.id === 'f2-balcony-slot'), wide = host.openings.find(o => o.id === 'f2-balcony-door');
  assert.deepEqual([narrow.y, narrow.height, narrow.width], [100, 2700, 600]);
  assert.equal(narrow.y, wide.y); assert.equal(narrow.y + narrow.height, wide.y + wide.height);
  assert.equal(wall('f3-porch-back').openings.find(o => o.id === 'f3-balcony-slot').height, 2200);
});

test('the ground corner recess, screen and porch return end on the same south plane and retain the white beam', () => {
  assert.deepEqual([zoneAt('f1-front', 10000, 1000).materialId, zoneAt('f1-front', 10000, 1000).offsetMm], ['basalt', -60]);
  const screen = config.parts.find(p => p.kind === 'screen'), side = wall('f1-porch-right');
  assert.equal(screen.centerMm[2] + screen.sizeMm[2] / 2, 5800);
  assert.equal(side.originMm[2] + side.widthMm, 6100);
  assert.equal(screen.centerMm[0] + screen.sizeMm[0] / 2, 5100);
  assert.deepEqual([zoneAt('f1-front', 10000, 3500).materialId, zoneAt('f1-front', 10000, 3500).offsetMm], ['ivory', 0]);
});

test('historical revision7: the screen has real gaps, an actual masonry opening and no solid envelope or tile surface over it', () => {
  const faces = buildingFacesAtRevision7();
  const screen = config.parts.find(p => p.kind === 'screen'), bars = screenBars(screen), opening = wall('f1-right').openings.find(o => o.id === 'f1-entry-screen-opening');
  assert.deepEqual([opening.x, opening.width, opening.height], [360, 1200, 3300]);
  for (const face of faces.filter(f => f.sourceWallIds.includes('f1-right') && f.offsetMm === -60)) for (const solid of faceSolids(face)) assert.equal(intersect(solid, opening), null);
  assert.equal(config.walls.some(w => w.id.startsWith('exposed-f1-entry-screen')), false);
  assert.equal(buildingBodies([], [screen]).length, 0);
  assert.ok(bars.length > 6);
  for (const bar of bars) bar.centerMm.forEach((n, i) => assert.ok(Math.abs(n) + bar.sizeMm[i] / 2 <= screen.sizeMm[i] / 2 + 1e-6));
  const slats = bars.slice(4).sort((a, b) => a.centerMm[2] - b.centerMm[2]);
  for (let i = 1; i < slats.length; i++) assert.ok(slats[i].centerMm[2] - slats[i - 1].centerMm[2] > slats[i].sizeMm[2]);
});

test('historical revision7: restoring the former north grey finish cannot recolour the newly white lower patch and is idempotent', () => {
  const faces = buildingFacesAtRevision7();
  for (const old of ['f2-back:face:-60', 'f2-back:face:0:north-stair-flush']) {
    const saved = fresh(); saved.faceFinishes = { [old]: { ...config.defaultTile, materialId: 'sand', preserveZoning: false } };
    const before = structuredClone(saved), restored = validateRevision7State(saved);
    assert.deepEqual(saved, before); assert.deepEqual(validateRevision7State(restored), restored);
    const white = faces.find(f => f.id === 'f2-back:face:0');
    assert.ok(faceFinishRegions(white, restored).every(r => r.finish.materialId === 'ivory'));
    assert.equal(restored.faceFinishes['f2-back:face:-60:north-stair-upper'].materialId, 'sand');
  }
});
