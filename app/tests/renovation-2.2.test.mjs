import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { baseBuildingFaces, buildingFaces, faceSolids, faceMetrics, faceGridWall, faceTileLayout } from '../src/renovation3d/utils/wall-surfaces.ts';
import { buildingBodies, wallBodies, worldPoint } from '../src/renovation3d/utils/geometry.ts';
import { faceBodyMasks, intersectedFaces } from '../src/renovation3d/utils/surface-intersections.ts';
import { outlineSegments, rectUnion } from '../src/renovation3d/utils/outline.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';
import { replaceFaces } from '../src/renovation3d/utils/finish-actions.ts';
import { validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';

const faces = buildingFaces(config.walls), wall = id => config.walls.find(w => w.id === id);
const area = rs => rs.reduce((sum, r) => sum + r.width * r.height, 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const fresh = () => ({ schemaVersion: 1, faceGroupingVersion: 4, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });

test('both confirmed corner jambs occupy exactly 400mm south by 300mm east without a separate column', () => {
  for (const id of ['f1-front', 'f2-front']) {
    const host = wall(id), jamb = wallBodies(host).filter(b => b.backMm === -360 && b.frontMm === -60);
    assert.ok(jamb.length);
    for (const body of jamb) {
      close(body.rect.width, 400); close(body.frontMm - body.backMm, 300);
      const p = worldPoint(host, [body.rect.x, body.rect.y, body.frontMm]);
      close(p[0], 4700); close(p[2], 6100);
    }
    assert.equal(wall(`${host.floorId}-porch-right`).surfaceOnly, true);
    assert.equal(wallBodies(wall(`${host.floorId}-porch-right`)).length, 0);
  }
});

test('the 200mm deep screen replaces the whole side enclosure and meets the real corner back', () => {
  const screen = config.parts.find(p => p.kind === 'screen');
  assert.deepEqual(screen.sizeMm, [200, 3300, 1200]);
  assert.deepEqual(screen.centerMm, [5000, 1650, 5200]);
  const opening = wall('f1-right').openings.find(o => o.id === 'f1-entry-screen-opening');
  assert.deepEqual([opening.x, opening.width, opening.y, opening.height], [360, 1200, 0, 3300]);
  const box = { min: [4900, 0, 4600], max: [5100, 3300, 5800] };
  for (const body of buildingBodies(config.walls, config.parts)) {
    const overlap = [0, 1, 2].map(i => Math.min(body.max[i], box.max[i]) - Math.max(body.min[i], box.min[i]));
    assert.equal(overlap.every(n => n > 1e-5), false, `${body.owner} blocks the open screen enclosure`);
  }
});

test('all runtime finishes exclude neighbouring solid masks, including all eight previously reported candidates', () => {
  const bodies = buildingBodies(config.walls, config.parts), raw = baseBuildingFaces(config.walls);
  assert.ok(raw.some(f => area(faceSolids(f)) > area(rectUnion(f.rects, [...f.holes, ...faceBodyMasks(f, bodies)])) + 1));
  for (const f of faces) close(area(faceSolids(f)), area(rectUnion(f.rects, [...f.holes, ...faceBodyMasks(f, bodies)])));
  // 2.8 adds only the measured missing return-corner closures after clipping.
  close(faces.reduce((n, f) => n + area(faceSolids(f)), 0), intersectedFaces(raw, config.walls, config.parts).reduce((n, f) => n + area(faceSolids(f)), 0) + 7616);
});

test('historical revision7: each roof joint separates its upper parapet from the floor wall and preserves independent finish changes', () => {
  const faces = buildingFacesAtRevision7();
  const state = validateRevision7State(fresh());
  for (const owner of ['roof-front', 'roof-back', 'roof-side--1', 'roof-side-1']) {
    const upper = faces.find(f => f.sourceWallIds.includes(owner) && faceSolids(f).every(r => r.y + f.originMm[1] >= 13700 - 1e-5));
    assert.ok(upper, owner);
    for (const r of faceSolids(upper)) assert.ok(r.y + upper.originMm[1] >= 13700 - 1e-5);
    const parent = faces.find(f => f.id !== upper.id && f.legacyFaceIds?.some(id => upper.legacyFaceIds.includes(id))
      && faceSolids(f).some(r => r.y + f.originMm[1] < 13700 - 1e-5));
    assert.ok(parent, owner);
    const finish = { ...config.defaultTile, materialId: 'sand', preserveZoning: false };
    const changed = validateRevision7State(replaceFaces(state, [upper], finish));
    assert.deepEqual(changed.faceFinishes[upper.id], finish);
    assert.equal(changed.faceFinishes[parent.id], undefined);
  }
});

test('intersection fragments preserve area and UV dimensions and never introduce duplicate outline segments', () => {
  const fragments = faces.filter(f => f.id.includes(':junction:'));
  assert.ok(fragments.length >= 6);
  for (const f of fragments) {
    const segments = outlineSegments(f.rects, f.holes), keys = segments.map(s => s.map(p => p.join(',')).sort().join('|'));
    assert.equal(new Set(keys).size, keys.length);
    const layout = faceTileLayout(f, faceGridWall(f, config.walls), config.defaultTile);
    close(layout.netAreaMm2, faceMetrics(f).netAreaMm2);
    for (const piece of layout.pieces) {
      close((piece.uv[2] - piece.uv[0]) * 1200, piece.width);
      close((piece.uv[3] - piece.uv[1]) * 600, piece.height);
      for (const hole of f.holes) assert.equal(intersect(piece, hole), null);
    }
  }
});

test('historical revision7: version 3 whole-face replacements migrate to junctions once and later edits stay independent', () => {
  const faces = buildingFacesAtRevision7();
  const child = faces.find(f => f.id === 'roof-fascia:face:0:junction:0:500');
  const saved = { ...fresh(), faceGroupingVersion: 3, faceFinishes: { 'roof-fascia:face:0': { ...config.defaultTile, materialId: 'sand', preserveZoning: false } } };
  const original = structuredClone(saved), restored = validateRevision7State(saved);
  assert.deepEqual(saved, original); assert.equal(restored.faceGroupingVersion, 7);
  assert.equal(restored.faceFinishes[child.id].materialId, 'sand');
  restored.faceFinishes[child.id].materialId = 'ivory';
  assert.equal(validateRevision7State(restored).faceFinishes[child.id].materialId, 'ivory');
  assert.equal(validateRevision7State(restored).faceFinishes['roof-fascia:face:0'].materialId, 'sand');
  assert.deepEqual(validateRevision7State(restored), restored);
});

test('screen colour is isolated and restored, while invalid colours and unknown objects reject', () => {
  const saved = { ...fresh(), partColors: { 'f1-entry-screen': '#aabbcc' } }, before = structuredClone(saved);
  const restored = validateState(saved);
  assert.deepEqual(saved, before); assert.deepEqual(restored.partColors, saved.partColors);
  assert.deepEqual(restored.finishes, before.finishes); assert.deepEqual(validateState(restored), restored);
  for (const partColors of [{ 'f1-entry-screen': 'red' }, { 'f1-slab': '#aabbcc' }, []]) assert.throws(() => validateState({ ...fresh(), partColors }), /格栅颜色数据无效/);
});

test('both earlier screen-return wall IDs retain their own saved finish after the 1200mm opening correction', () => {
  const target = 'relief-f1-right-h-3300--1--4600-6160';
  for (const former of ['relief-f1-right-h-3300--1--6160-6160', 'relief-f1-right-h-3300--1--4560-6160']) {
    const saved = fresh(), finish = { ...config.defaultTile, materialId: 'sand', preserveZoning: false };
    delete saved.finishes[target]; saved.finishes[former] = finish;
    const before = structuredClone(saved), restored = validateState(saved);
    assert.deepEqual(restored.finishes[target], finish);
    assert.deepEqual(saved, before); assert.deepEqual(validateState(restored), restored);
  }
});
