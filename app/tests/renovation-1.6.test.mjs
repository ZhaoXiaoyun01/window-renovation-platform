import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFaces, faceMetrics, faceSolids } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';

const faces = buildingFaces(config.walls), wall = id => config.walls.find(w => w.id === id);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const edgeAt = (id, offset, y, end) => {
  const w = wall(id), solids = buildingFacesAtRevision7().filter(f => f.sourceWallIds.includes(id) && f.offsetMm === offset).flatMap(faceSolids)
    .filter(r => y >= r.y && y < r.y + r.height);
  const x = end ? Math.max(...solids.map(r => r.x + r.width)) : Math.min(...solids.map(r => r.x));
  return [w.originMm[0] + Math.cos(w.rotationY) * x + Math.sin(w.rotationY) * offset,
    w.originMm[2] - Math.sin(w.rotationY) * x + Math.cos(w.rotationY) * offset];
};

test('historical revision7: ground north-east and south-east wall faces meet without projecting corner column strips', () => {
  const faces = buildingFacesAtRevision7();
  for (const y of [100, 1200, 3200]) {
    const north = edgeAt('f1-back', -60, y, false), eastNorth = edgeAt('f1-right', -60, y, true);
    const south = edgeAt('f1-front', -60, y, true);
    const screen = config.parts.find(p => p.id === 'f1-entry-screen');
    const eastSouth = [screen.centerMm[0] + screen.sizeMm[0] / 2, screen.centerMm[2] + screen.sizeMm[2] / 2 + 300];
    north.forEach((n, i) => close(n, eastNorth[i]));
    south.forEach((n, i) => close(n, eastSouth[i]));
    close(north[0], 5100); close(north[1], -6100);
    close(south[0], 5100); close(south[1], 6100);
  }
});

test('historical revision7: corner trimming preserves the complete upper white ring beam and existing saved face identifiers', () => {
  for (const side of ['front', 'back', 'left', 'right']) {
    const id = `f1-${side}`, w = wall(id), a = edgeAt(id, 0, 3500, false), b = edgeAt(id, 0, 3500, true);
    close(Math.hypot(b[0] - a[0], b[1] - a[1]), w.widthMm);
  }
  assert.ok(config.walls.some(w => w.id === 'relief-f1-back-h-3300--1--5160-5100'));
  assert.ok(config.walls.some(w => w.id === 'relief-f1-right-h-3300--1--4600-6160'));
  const saved = { schemaVersion: 1, faceGroupingVersion: 3, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
    finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])),
    faceFinishes: { 'f1-right:face:-60': { ...config.defaultTile, widthMm: 45, heightMm: 145, materialId: 'basalt', preserveZoning: false } } };
  const original = structuredClone(saved), restored = validateRevision7State(saved);
  assert.deepEqual(saved, original); assert.deepEqual(restored.faceFinishes['f1-right:face:-60'], saved.faceFinishes['f1-right:face:-60']);
  assert.deepEqual(validateRevision7State(restored), restored);
});

test('historical revision7: the second-floor balcony back wall closes the 210mm gap and the side is not a duplicate column body', () => {
  const faces = buildingFacesAtRevision7();
  const back = wall('f2-porch-back'), east = wall('f2-right'), inner = wall('f2-balcony-right-inner'), jamb = wall('f2-porch-right');
  close(inner.originMm[0], east.originMm[0] - east.thicknessMm);
  close(inner.originMm[0] - jamb.originMm[0], 200);
  close(back.originMm[2], inner.originMm[2]);
  assert.equal(jamb.surfaceOnly, true); assert.equal(inner.surfaceOnly, true);
  const face = faces.find(f => f.sourceWallIds.includes(back.id)), visible = faceSolids(face);
  const inFace = (worldX, y) => visible.some(r => worldX - face.originMm[0] >= r.x && worldX - face.originMm[0] <= r.x + r.width && y > r.y && y < r.y + r.height);
  assert.ok(inFace(4800, 1450)); assert.ok(inFace(5000, 1450));
  assert.equal(inFace(5000, 50), false, 'the buried east-wall portion is not counted below the side opening');
  close(faceMetrics(faces.find(f => f.wallId === jamb.id)).netAreaMm2, 300 * 2700);
});

test('the second-floor balcony floor is one selectable surface excluding the solid front sill', () => {
  const face = faces.find(f => f.id === 'f2-porch-floor:face:0'), metrics = faceMetrics(face), solid = faceSolids(face);
  assert.ok(face.sourceWallIds.includes('f2-porch-floor-side'));
  close(metrics.netAreaMm2, 5510 * 1340 + 200 * 1240);
  close(metrics.outerPerimeterMm, 14100); close(metrics.openingPerimeterMm, 0);
  assert.ok(solid.some(r => 5600 > r.x && 5600 < r.x + r.width && 400 > r.y && 400 < r.y + r.height));
  assert.equal(solid.some(r => 5600 > r.x && 5600 < r.x + r.width && 100 > r.y && 100 < r.y + r.height), false);
});

test('new balcony surfaces inherit old finishes without rewriting the saved scheme', () => {
  const finish = { ...config.defaultTile, widthMm: 100, heightMm: 300, materialId: 'sand', preserveZoning: false };
  const saved = { schemaVersion: 1, faceGroupingVersion: 3, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
    finishes: Object.fromEntries(config.walls.filter(w => !['f2-balcony-right-inner', 'f2-porch-floor-side'].includes(w.id)).map(w => [w.id,
      { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])),
    faceFinishes: { 'f2-porch-right:face:0': finish, 'f2-porch-floor:face:0': finish } };
  const original = structuredClone(saved), restored = validateState(saved);
  assert.deepEqual(saved, original);
  for (const id of ['f2-balcony-right-inner', 'f2-porch-floor-side']) assert.deepEqual(restored.finishes[id], finish);
});
