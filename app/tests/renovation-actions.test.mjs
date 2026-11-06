import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';
import { buildingFaces, faceFinishRegions, faceJointBands, faceMetrics, faceGridWall, faceTileLayout } from '../src/renovation3d/utils/wall-surfaces.ts';
import { importTileStyle, materialPrice, replaceFaces, replaceSameMaterial, tileStyleName } from '../src/renovation3d/utils/finish-actions.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';
import { outlineSegments } from '../src/renovation3d/utils/outline.ts';

const faces = buildingFaces(config.walls);
const fresh = () => validateState({ schemaVersion: 1, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });
const replacement = { ...config.defaultTile, materialId: 'sand', widthMm: 300, heightMm: 900, preserveZoning: false };

test('bulk replacement uses the pre-preview material and preserves neighbours, windows and source input', () => {
  const initial = fresh(), selected = faces.find(f => faceFinishRegions(f, initial).every(r => r.finish.materialId === 'basalt'));
  const windowId = config.walls.flatMap(w => w.openings).find(o => o.kind === 'window').id;
  initial.windowFinishes = { [windowId]: { frameColor: '#112233', glassType: 'low' } };
  const original = structuredClone(initial), preview = replaceFaces(initial, [selected], replacement);
  const result = replaceSameMaterial(preview, faces, 'basalt', selected.id, replacement), restored = validateState(result.state);
  const expected = faces.filter(f => faceFinishRegions(f, initial).some(r => r.finish.materialId === 'basalt'));
  assert.equal(result.count, expected.length);
  for (const face of faces) if (!expected.includes(face)) assert.deepEqual(faceFinishRegions(face, restored), faceFinishRegions(face, initial));
  assert.deepEqual(restored.windowFinishes, initial.windowFinishes);
  assert.deepEqual(initial, original);
});

test('historical revision7: bulk replacement preserves a different material in a merged legacy face', () => {
  const faces = buildingFacesAtRevision7();
  const initial = fresh(), mixed = faces.find(f => f.sourceWallIds.length > 1 && f.members.length > 1);
  initial.faceGroupingVersion = 7; initial.faceFinishes = {};
  mixed.sourceWallIds.forEach((id, i) => { initial.finishes[id] = { ...config.defaultTile, materialId: i ? 'ivory' : 'basalt', preserveZoning: false }; });
  const selected = faces.find(f => f.id !== mixed.id && faceFinishRegions(f, initial).every(r => r.finish.materialId === 'basalt'));
  const restored = validateRevision7State(replaceSameMaterial(initial, faces, 'basalt', selected.id, replacement).state);
  const regions = faceFinishRegions(mixed, restored);
  assert.ok(regions.some(r => r.finish.materialId === 'sand'));
  assert.ok(regions.some(r => r.finish.materialId === 'ivory'));
  assert.equal(restored.finishes[mixed.wallId].materialId, 'basalt');
});

test('saved styles keep real dimensions and import colliding material IDs without changing prior faces', () => {
  const initial = fresh(), original = structuredClone(initial), material = { ...initial.materials[0], color: '#123456', pricePerM2: 88 };
  const style = { id: 'style-test', name: '自定义规格', material, finish: { ...replacement, materialId: material.id, widthMm: 450, heightMm: 1200 }, createdAt: '2026-10-06', updatedAt: '2026-10-06' };
  const imported = importTileStyle(initial, style);
  assert.notEqual(imported.finish.materialId, material.id);
  assert.equal(imported.state.materials.at(-1).color, '#123456');
  const selected = faces[0], restored = validateState(replaceFaces(imported.state, [selected], imported.finish));
  assert.deepEqual(faceFinishRegions(selected, restored)[0].finish, imported.finish);
  for (const face of faces.slice(1)) assert.deepEqual(faceFinishRegions(face, restored), faceFinishRegions(face, initial));
  assert.deepEqual(initial, original);
  assert.equal(tileStyleName(initial.materials[0]), `${initial.materials[0].name} · 修改1`);
  const reused = importTileStyle(imported.state, style);
  assert.equal(reused.state.materials.length, imported.state.materials.length);
  assert.equal(reused.finish.materialId, imported.finish.materialId);
});

test('45×95mm tiles replace all original basalt faces while neighbours retain their materials', () => {
  const initial = fresh(), selected = faces.find(f => faceFinishRegions(f, initial).every(r => r.finish.materialId === 'basalt'));
  const small = { ...replacement, widthMm: 45, heightMm: 95, groutMm: 3 };
  const result = replaceSameMaterial(replaceFaces(initial, [selected], small), faces, 'basalt', selected.id, small), restored = validateState(result.state);
  const expected = faces.filter(f => faceFinishRegions(f, initial).some(r => r.finish.materialId === 'basalt'));
  assert.equal(result.count, expected.length);
  let cells = 0;
  for (const face of expected) {
    for (const region of faceFinishRegions(face, restored)) {
      if (region.finish.materialId !== small.materialId) continue;
      const layout = faceTileLayout(region.face, faceGridWall(face, config.walls), region.finish, config.scene.maxCellsPerWall);
      for (const p of layout.pieces) {
        assert.ok(Math.abs((p.uv[2] - p.uv[0]) * 95 - p.width) < 1e-6);
        assert.ok(Math.abs((p.uv[3] - p.uv[1]) * 45 - p.height) < 1e-6);
      }
      cells += layout.sourceTiles;
    }
  }
  assert.ok(cells > 6000);
  for (const face of faces) if (!expected.includes(face)) assert.deepEqual(faceFinishRegions(face, restored), faceFinishRegions(face, initial));
});

test('manual prices and window finishes restore while invalid records are rejected without mutation', () => {
  const saved = fresh(), windowId = config.walls.flatMap(w => w.openings).find(o => o.kind === 'window').id;
  saved.materials[0].pricePerM2 = 235.5;
  saved.windowFinishes = { [windowId]: { frameColor: '#ABCDEF', glassType: 'high' } };
  const restored = validateState(saved);
  assert.equal(materialPrice(restored.materials[0]), 235.5);
  assert.deepEqual(restored.windowFinishes, saved.windowFinishes);
  for (const mutate of [s => { s.materials[0].pricePerM2 = -1; }, s => { s.windowFinishes[windowId].glassType = 'fake-vlt'; }, s => { s.windowFinishes['entry-door'] = s.windowFinishes[windowId]; }, s => { s.faceRegionFinishes = { unknown: replacement }; }]) {
    const invalid = structuredClone(saved); mutate(invalid); const before = structuredClone(invalid);
    assert.throws(() => validateState(invalid)); assert.deepEqual(invalid, before);
  }
});

test('floor seams cut real tiles without introducing internal selection edges', () => {
  const face = faces.find(f => f.floorId === 'f3' && f.wallId === 'f3-front'), bands = faceJointBands(face);
  assert.equal(bands.length, 1); assert.equal(bands[0].height, config.scene.floorJointMm);
  const layout = faceTileLayout(face, faceGridWall(face, config.walls), config.defaultTile);
  for (const piece of layout.pieces) for (const band of bands) assert.equal(intersect(piece, band), null);
  assert.equal(layout.netAreaMm2, faceMetrics(face).netAreaMm2);
  assert.ok(!outlineSegments(face.rects, face.holes).some(([a, b]) => a[1] === config.scene.floorJointMm && b[1] === config.scene.floorJointMm));
});

test('covered and open terrace floor shares selection and retains real tile UVs', () => {
  const terrace = faces.filter(f => f.surfaceKind === 'outdoor-floor' && f.sourceWallIds.some(id => id.includes('terrace-floor')));
  assert.equal(terrace.length, 1); assert.ok(terrace[0].members.some(m => m.viewGroup === 'terrace')); assert.ok(terrace[0].members.some(m => !m.viewGroup));
  assert.equal(terrace.reduce((sum, f) => sum + faceMetrics(f).netAreaMm2, 0), 66920000);
  for (const face of terrace) {
    const layout = faceTileLayout(face, faceGridWall(face, config.walls), { ...config.defaultTile, groutMm: 0 });
    assert.equal(layout.netAreaMm2, faceMetrics(face).netAreaMm2);
    for (const p of layout.pieces) assert.ok(Math.abs((p.uv[2] - p.uv[0]) * 1200 - p.width) < 1e-6);
    assert.deepEqual(faceJointBands(face), []);
  }
});
