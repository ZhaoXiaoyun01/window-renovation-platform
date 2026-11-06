import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFaces, faceGridWall, faceMetrics, faceSolids, faceTileLayout } from '../src/renovation3d/utils/wall-surfaces.ts';
import { reliefReturns } from '../src/renovation3d/utils/relief-returns.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';
import { aggregateTileQuantities, buildingTileQuantities, purchaseTiles, tileQuantityKey, tileQuantityTotals } from '../src/renovation3d/utils/tile-quantities.ts';
import { validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const faces = buildingFaces(config.walls), wall = id => config.walls.find(w => w.id === id);
const state = () => ({ schemaVersion: 1, faceGroupingVersion: 2, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });

test('east real tile joints share one world datum across all floors, relief planes and layout directions', () => {
  for (const alignment of ['edge', 'center']) for (const direction of ['horizontal', 'vertical']) {
    const settings = { ...config.defaultTile, widthMm: 45, heightMm: 145, alignment, direction };
    const width = direction === 'horizontal' ? 145 : 45, height = direction === 'horizontal' ? 45 : 145;
    const px = width + 3, py = height + 3, phase = (size, pitch) => alignment === 'edge' ? 0 : (size - (Math.ceil((size + 3) / pitch) * pitch - 3)) / 2;
    for (const floor of config.floors) for (const face of faces.filter(f => f.sourceWallIds.includes(`${floor.id}-right`))) {
      const layout = faceTileLayout(face, faceGridWall(face, config.walls), settings, config.scene.maxCellsPerWall);
      // Short junction faces may contain only cuts. Their UVs must still trace
      // back to exactly the same world-grid tile as a full tile on another floor.
      assert.ok(layout.pieces.length > 0, face.id);
      for (const tile of layout.pieces) {
        const column = (tile.x - tile.uv[0] * width - face.originMm[2] + 6160 - phase(12320, px)) / px;
        const row = (tile.y - tile.uv[1] * height + face.originMm[1] - phase(14300, py)) / py;
        close(column, Math.round(column)); close(row, Math.round(row));
      }
    }
  }
});

test('the exposed covered-terrace inner wall has its own area and joins a trimmed back wall without reaching the exterior', () => {
  const inner = wall('f4-covered-left-inner'), back = wall('f4-front');
  assert.equal(inner.surfaceOnly, true); assert.equal(inner.surfaceKind, 'inner-wall');
  assert.equal(back.surfaceKind, 'inner-wall'); close(inner.originMm[0], -4900); close(back.originMm[0], -4900);
  close(inner.widthMm, 2200); close(inner.heightMm, 3120);
  close(inner.originMm[2] - inner.widthMm, back.originMm[2]);
  close(back.originMm[0] + back.openings.find(o => o.id === 'f4-s-door').x, -500);
  close(back.originMm[0] + back.openings.find(o => o.id === 'f4-s-window').x, -4330);
  const innerFace = faces.find(f => f.wallId === inner.id), backFace = faces.find(f => f.wallId === back.id);
  assert.deepEqual(innerFace.sourceWallIds, [inner.id]); assert.deepEqual(backFace.sourceWallIds, [back.id]);
  close(faceMetrics(innerFace).netAreaMm2, 2200 * 3100 - 260 * 320);
  assert.ok(!backFace.sourceWallIds.includes('f4-left'));
});

test('historical revision7: old saved plans gain the new inner wall without modifying existing finishes or source snapshots', () => {
  const saved = state(); delete saved.finishes['f4-covered-left-inner'];
  saved.faceFinishes = { 'f4-front:face:0': { ...config.defaultTile, materialId: 'sand', preserveZoning: false } };
  const original = structuredClone(saved), restored = validateRevision7State(saved);
  assert.deepEqual(saved, original); assert.deepEqual(restored.faceFinishes, saved.faceFinishes);
  assert.equal(restored.finishes['f4-covered-left-inner'].materialId, 'basalt');
});

test('same-stock grouping separates sizes and material colours, merges orientation and rounds 5 percent per stock', () => {
  const row = { materialId: 'ivory', widthMm: 45, heightMm: 145, tiles: 20, cuts: 2, narrow: 20, areaMm2: 100000 };
  const input = [row, { ...row, widthMm: 145, heightMm: 45, tiles: 1 }, { ...row, widthMm: 95, tiles: 2 }, { ...row, materialId: 'basalt', tiles: 1 }];
  const original = structuredClone(input), groups = aggregateTileQuantities(input), totals = tileQuantityTotals(groups);
  assert.deepEqual(input, original); assert.equal(groups.length, 3);
  const same = groups.find(g => tileQuantityKey(g) === tileQuantityKey(row));
  assert.equal(same.tiles, 21); assert.equal(purchaseTiles(same.tiles), 23);
  assert.equal(purchaseTiles(20), 21); assert.equal(purchaseTiles(0), 0);
  assert.equal(totals.tiles, 24); assert.equal(totals.purchase, 28); close(totals.area, 0.4);
});

test('quantities deduct complete openings and count actual colour-zone stock without duplicate same-material cells', () => {
  const fixture = { ...wall('f1-front'), id: 'quantity-fixture', tileGridDatum: undefined, originMm: [0, 0, 0], widthMm: 2400, heightMm: 1200,
    openings: [{ id: 'quantity-hole', kind: 'window', x: 0, y: 0, width: 1200, height: 600 }],
    finishZones: [{ x: 0, y: 0, width: 2400, height: 1200, materialId: 'ivory', offsetMm: 0 }] };
  const saved = state(); saved.finishes[fixture.id] = { ...config.defaultTile, groutMm: 0, materialId: 'ivory', preserveZoning: true };
  config.walls.push(fixture);
  try {
    const only = buildingFaces([fixture]), first = buildingTileQuantities(only, saved);
    assert.equal(first.all[0].tiles, 3); assert.equal(tileQuantityTotals(first.all).purchase, 4); close(first.all[0].areaMm2, 2160000);
    fixture.openings = []; fixture.finishZones = [{ x: 0, y: 0, width: 600, height: 1200, materialId: 'ivory', offsetMm: 0 },
      { x: 600, y: 0, width: 600, height: 1200, materialId: 'ivory', offsetMm: 0 }, { x: 1200, y: 0, width: 1200, height: 1200, materialId: 'sand', offsetMm: 0 }];
    const mixed = buildingTileQuantities(buildingFaces([fixture]), saved);
    assert.equal(mixed.all.length, 2);
    for (const group of mixed.all) { assert.equal(group.tiles, 2); assert.equal(group.cuts, 0); close(group.areaMm2, 1440000); }
    assert.equal(tileQuantityTotals(mixed.all).purchase, 6);
  } finally { config.walls.pop(); }
});

test('whole-building totals preserve input and include hidden floors while matching per-face counts', () => {
  const saved = state(); saved.hiddenFloors = ['f2', 'f4'];
  const original = structuredClone(saved), counted = buildingTileQuantities(faces, saved);
  const flattened = aggregateTileQuantities([...counted.byFace.values()].flat());
  assert.deepEqual(counted.all, flattened); assert.deepEqual(saved, original);
  assert.ok(counted.byFace.get('f2-right:face:-60').some(g => g.tiles > 0));
  assert.deepEqual(buildingTileQuantities(faces, { ...saved, hiddenFloors: [] }).all, counted.all);
  close(tileQuantityTotals(counted.all).area, faces.reduce((sum, face) => sum + faceMetrics(face).netAreaMm2 / 1e6, 0));
});

test('historical revision7: a full-width window splits the grey strip into two physical selectable faces without a white backing face', () => {
  const faces = buildingFacesAtRevision7();
  const grey = faces.filter(f => f.sourceWallIds.includes('f3-back') && f.offsetMm === -60);
  assert.equal(grey.length, 2);
  assert.deepEqual(grey.map(f => faceMetrics(f).netAreaMm2).sort((a, b) => a - b), [640000, 784000]);
  assert.ok(grey.every(f => faceMetrics(f).openingPerimeterMm === 0));
  for (const f of config.floors.slice(0, 3)) for (const side of ['front', 'back', 'left', 'right']) {
    const painted = faces.filter(face => face.sourceWallIds.includes(`${f.id}-${side}`));
    for (let i = 0; i < painted.length; i++) for (const other of painted.slice(i + 1)) {
      for (const a of faceSolids(painted[i])) for (const b of faceSolids(other)) assert.equal(intersect(a, b), null, `${painted[i].id} / ${other.id}`);
    }
  }
});

test('60mm returns meet the actual high and low finish planes and provide selectable stock area', () => {
  const sample = { ...wall('f1-front'), id: 'step-fixture', originMm: [0, 0, 0], rotationY: 0, openings: [], surfaceCuts: [], widthMm: 1200, heightMm: 1200,
    finishZones: [{ x: 0, y: 0, width: 600, height: 1200, materialId: 'ivory', offsetMm: 0 },
      { x: 600, y: 0, width: 600, height: 1200, materialId: 'basalt', offsetMm: -60 }] };
  const [step] = reliefReturns([sample], 8, 60);
  assert.equal(step.surfaceKind, 'relief-return'); assert.equal(step.surfaceOnly, true); assert.equal(step.claddingMm, 0);
  assert.deepEqual(step.originMm, [600, 0, 8]); close(step.widthMm, 60); close(step.heightMm, 1200);
  close(step.originMm[2] - Math.sin(step.rotationY) * step.widthMm, -52);
  const configured = config.walls.filter(w => w.surfaceKind === 'relief-return');
  assert.ok(configured.length > 30);
  for (const w of configured) {
    assert.ok(Math.abs(w.widthMm - 60) < 1e-6 || Math.abs(w.heightMm - 60) < 1e-6, w.id);
    assert.ok(faces.some(face => face.sourceWallIds.includes(w.id) && faceMetrics(face).netAreaMm2 > 0), w.id);
  }
  for (const face of faces.filter(f => f.surfaceKind === 'relief-return')) assert.equal(face.facade, wall(face.wallId).facade);
  const glassWall = faces.find(f => f.sourceWallIds.includes('f4-front-east'));
  close(faceMetrics(glassWall).heightMm, 2780);
  assert.ok(wall('f4-front-east').surfaceCuts.some(cut => cut.y === 2800 && cut.height === 500));
});

test('historical revision7: 1.4 face replacements migrate once to separated pieces and new returns inherit their adjacent finish', () => {
  const faces = buildingFacesAtRevision7();
  const saved = state(); saved.finishes = Object.fromEntries(Object.entries(saved.finishes).filter(([id]) => !id.startsWith('relief-')));
  const finish = { ...config.defaultTile, widthMm: 45, heightMm: 145, materialId: 'sand', preserveZoning: false };
  saved.faceFinishes = { 'f3-back:face:-60': finish, 'f3-back:face:0': { ...finish, materialId: 'ivory' } };
  const original = structuredClone(saved), restored = validateRevision7State(saved);
  assert.deepEqual(saved, original); assert.equal(restored.faceGroupingVersion, 7);
  const additional = faces.find(f => f.legacyFaceId === 'f3-back:face:-60');
  assert.deepEqual(restored.faceFinishes[additional.id], finish);
  const step = config.walls.find(w => w.surfaceKind === 'relief-return' && w.finishSourceFaceId === 'f3-back:face:0');
  assert.equal(restored.finishes[step.id].widthMm, 45); assert.equal(restored.finishes[step.id].heightMm, 145);
  assert.equal(restored.finishes[step.id].materialId, 'ivory');
  restored.faceFinishes['f3-back:face:-60'] = { ...finish, materialId: 'basalt' };
  const again = validateRevision7State(restored);
  assert.equal(again.faceFinishes[additional.id].materialId, 'sand');
});
