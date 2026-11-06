import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { storageKey, validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';
import { rectUnion } from '../src/renovation3d/utils/outline.ts';
import { buildingFaces, faceCellLimit, faceFinishRegions, faceGridWall, faceTileLayout } from '../src/renovation3d/utils/wall-surfaces.ts';

const legacyIds = [
  ...['f1', 'f2', 'f3', 'f4'].flatMap(id => ['front', 'back', 'left', 'right'].map(facade => `${id}-${facade}`)),
  ...['f1', 'f2', 'f3'].map(id => `${id}-porch-back`),
  'terrace-south', 'roof-front', 'roof-back', 'terrace-side--1', 'terrace-side-1', 'roof-side--1', 'roof-side-1',
];
const legacyState = () => ({
  schemaVersion: 1, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: ['f2'], exploded: true,
  finishes: Object.fromEntries(legacyIds.map(id => [id, { ...config.defaultTile, materialId: 'ivory' }])),
});

test('complete 1.0 plans retain custom finishes while new walls get config defaults without changing input', () => {
  const old = legacyState();
  old.materials.push({ id: 'my-tile', name: '自定义砖', color: '#112233', texture: 'custom', image: 'data:image/jpeg;base64,AA==' });
  old.finishes['f2-front'] = { materialId: 'my-tile', widthMm: 300, heightMm: 900, direction: 'vertical', groutMm: 6, groutColor: '#445566', alignment: 'center' };
  const untouched = structuredClone(old);
  const extraWall = { ...config.walls[0], id: 'migration-test-new-wall', openings: [], finishZones: [{ x: 0, y: 0, width: config.walls[0].widthMm, height: config.walls[0].heightMm, materialId: 'basalt' }] };
  config.walls.push(extraWall);
  try {
    const restored = validateState(old);
    assert.equal(Object.keys(old.finishes).length, 26);
    assert.deepEqual(restored.finishes['f2-front'], { ...old.finishes['f2-front'], preserveZoning: false });
    assert.deepEqual(restored.materials, old.materials);
    assert.deepEqual(restored.finishes[extraWall.id], { ...config.defaultTile, materialId: 'basalt', preserveZoning: true });
    assert.deepEqual(restored.hiddenFloors, ['f2']); assert.equal(restored.exploded, true);
    assert.deepEqual(Object.keys(restored.finishes).sort(), config.walls.map(w => w.id).sort());
    assert.deepEqual(old, untouched);
    assert.equal(storageKey, 'renovation3d:1.0:residence');
  } finally { config.walls.pop(); }
});

test('retired legacy walls are removed only after their saved finish is validated', () => {
  const old = legacyState(), wall = config.walls.shift();
  try {
    const restored = validateState(old);
    assert.equal(wall.id in restored.finishes, false);
    old.finishes[wall.id].groutMm = -1;
    assert.throws(() => validateState(old));
  } finally { config.walls.unshift(wall); }
});

test('migration preserves explicit zoning flags and infers defaults without repainting custom finishes', () => {
  const old = legacyState();
  const wall = config.walls.find(w => legacyIds.includes(w.id));
  old.finishes[wall.id].materialId = wall.finishZones[0].materialId;
  assert.equal(validateState(old).finishes[wall.id].preserveZoning, true);
  old.finishes[wall.id].preserveZoning = false;
  assert.equal(validateState(old).finishes[wall.id].preserveZoning, false);
});

test('preserving colour zones supplements missing built-in materials without replacing custom samples', () => {
  const custom = { id: 'my-tile', name: '自定义砖', color: '#112233', texture: 'plain' };
  const saved = { ...legacyState(), materials: [custom], finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: custom.id, preserveZoning: true }])) };
  const restored = validateState(saved);
  assert.deepEqual(restored.materials.find(m => m.id === custom.id), custom);
  for (const w of config.walls) for (const z of w.finishZones) assert.ok(restored.materials.some(m => m.id === z.materialId));
  assert.deepEqual(saved.materials, [custom]);
});

test('cross-building, incomplete and unknown data are rejected without mutating plans', () => {
  const cases = [
    s => { s.buildingId = 'window-business-project'; },
    s => { delete s.finishes['f1-front']; },
    s => { s.finishes['unknown-wall'] = { ...config.defaultTile, materialId: 'ivory' }; },
    s => { s.finishes['f1-front'].materialId = 'unknown-material'; },
    s => { s.finishes['f1-front'].widthMm = 0; },
    s => { s.finishes['f1-front'].groutColor = 'red'; },
    s => { s.finishes['f1-front'].preserveZoning = 'true'; },
    s => { s.materials.push({ ...s.materials[0] }); },
    s => { s.hiddenFloors = ['unknown-floor']; },
    s => { s.finishes = []; },
  ];
  for (const change of cases) {
    const invalid = legacyState(); change(invalid); const original = structuredClone(invalid);
    assert.throws(() => validateState(invalid)); assert.deepEqual(invalid, original);
  }
});

test('historical revision7: face replacements survive restoration without changing another face or legacy finishes', () => {
  const saved = legacyState(), faces = buildingFacesAtRevision7();
  const selected = faces.find(face => face.sourceWallIds.length > 1);
  const priorFinish = validateRevision7State(saved).finishes[selected.wallId];
  saved.faceFinishes = { [selected.id]: { ...config.defaultTile, materialId: 'sand', widthMm: 300, heightMm: 900, preserveZoning: false } };
  const original = structuredClone(saved), restored = validateRevision7State(saved);
  assert.deepEqual(restored.faceFinishes, original.faceFinishes);
  assert.equal(faceFinishRegions(selected, restored).length, 1);
  assert.equal(faceFinishRegions(selected, restored)[0].finish.materialId, 'sand');
  assert.deepEqual(saved, original);
  const neighbour = faces.find(face => face.id !== selected.id);
  assert.equal(Object.hasOwn(restored.faceFinishes, neighbour.id), false);
  assert.deepEqual(restored.finishes[selected.wallId], priorFinish);
});

test('historical revision7: merging coplanar walls preserves differing saved materials until the face is replaced', () => {
  const saved = validateRevision7State(legacyState()), face = buildingFacesAtRevision7().find(face => face.sourceWallIds.length > 1);
  for (const wallId of face.sourceWallIds) saved.finishes[wallId] = { ...config.defaultTile, materialId: 'ivory', preserveZoning: false };
  saved.finishes[face.sourceWallIds[1]] = { ...config.defaultTile, materialId: 'sand', preserveZoning: false };
  const regions = faceFinishRegions(face, saved);
  assert.deepEqual(regions.map(region => region.finish.materialId).sort(), ['ivory', 'sand']);
  assert.deepEqual(rectUnion(regions.flatMap(region => region.face.rects)), rectUnion(face.rects));
  const restored = validateRevision7State(saved);
  assert.equal(restored.finishes[face.sourceWallIds[1]].materialId, 'sand');
});

test('unknown face IDs, materials and invalid face parameters reject without modifying saved data', () => {
  const face = buildingFaces(config.walls)[0];
  for (const change of [
    state => { state.faceFinishes['window-business-face'] = { ...config.defaultTile, materialId: 'ivory' }; },
    state => { state.faceFinishes[face.id].materialId = 'missing'; },
    state => { state.faceFinishes[face.id].heightMm = 0; },
    state => { state.faceFinishes[face.id].preserveZoning = 'yes'; },
    state => { state.faceFinishes = []; },
  ]) {
    const invalid = legacyState();
    invalid.faceFinishes = { [face.id]: { ...config.defaultTile, materialId: 'ivory' } };
    change(invalid); const untouched = structuredClone(invalid);
    assert.throws(() => validateState(invalid)); assert.deepEqual(invalid, untouched);
  }
});

test('historical revision7: small-tile legacy finishes restore after terrace splitting and still enforce each face budget', () => {
  const saved = legacyState();
  for (const id of ['f4-left', 'roof-side--1', 'terrace-side--1']) saved.finishes[id] = { ...config.defaultTile, widthMm: 30, heightMm: 40, materialId: 'ivory', preserveZoning: false };
  const restored = validateRevision7State(saved), face = buildingFacesAtRevision7().find(face => face.id === 'f4-left:face:0:part:4760:0');
  const region = faceFinishRegions(face, restored)[0], gridWall = faceGridWall(face, config.walls);
  assert.throws(() => faceTileLayout(region.face, gridWall, region.finish, 1000));
  const layout = faceTileLayout(region.face, gridWall, region.finish, faceCellLimit(region.face, restored, 6000));
  assert.ok(layout.sourceTiles > 1000 && layout.sourceTiles <= 6000);
  restored.faceFinishes[face.id] = region.finish;
  const limit = config.scene.maxCellsPerWall;
  try { config.scene.maxCellsPerWall = 1000; assert.throws(() => validateRevision7State(restored)); }
  finally { config.scene.maxCellsPerWall = limit; }
});

test('old plans default to studio while background changes stay isolated in restored copies', () => {
  const old = legacyState(), untouched = structuredClone(old);
  assert.equal(validateState(old).background, 'studio');
  assert.deepEqual(old, untouched);
  for (const background of ['studio', 'sunny']) assert.equal(validateState({ ...old, background }).background, background);
  assert.throws(() => validateState({ ...old, background: 'unknown' }), /场景背景无效/);
});

test('the total tile budget rejects whole-building overload even when each face is legal', () => {
  const saved = legacyState(), untouched = structuredClone(saved), limit = config.scene.maxTotalCells;
  try {
    config.scene.maxTotalCells = 1;
    assert.throws(() => validateState(saved), /全楼砖格超过1格/);
    assert.deepEqual(saved, untouched);
  } finally { config.scene.maxTotalCells = limit; }
  assert.doesNotThrow(() => validateState(saved));
});

test('historical revision7: old merged inner-wall finishes migrate once without coupling later roof and terrace edits', () => {
  const saved = legacyState(), finish = { ...config.defaultTile, materialId: 'sand', preserveZoning: false };
  const roof = 'roof-side--1-inner:face:0', terrace = 'terrace-side--1-inner:face:0';
  saved.faceFinishes = { [roof]: finish };
  const original = structuredClone(saved), restored = validateRevision7State(saved);
  assert.deepEqual(restored.faceFinishes[terrace], finish); assert.equal(restored.faceGroupingVersion, 7);
  assert.deepEqual(saved, original);
  delete restored.faceFinishes[terrace];
  const next = validateRevision7State(restored);
  assert.equal(next.faceFinishes[terrace], undefined);
  assert.equal(next.faceFinishes[roof].materialId, 'sand');
  assert.throws(() => validateRevision7State({ ...restored, faceGroupingVersion: 8 }), /块面分组版本无效/);
});
