import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { exteriorSurfaces } from '../src/renovation3d/utils/exterior-surfaces.ts';
import { buildingFaces, faceSolids, faceMetrics, faceFinishLayout, faceGridWall } from '../src/renovation3d/utils/wall-surfaces.ts';
import { buildingTileQuantities, tileQuantityTotals } from '../src/renovation3d/utils/tile-quantities.ts';
import { replaceFaces, importTileStyle, tileStyleName } from '../src/renovation3d/utils/finish-actions.ts';
import { validateMaterial, validateRevision9State as validateState, validateTileStyle } from '../src/renovation3d/utils/validation.ts';
import { area, intersect } from '../src/renovation3d/tile-layout/layout.ts';

const faces = buildingFaces(config.walls), wall = id => config.walls.find(w => w.id === id), part = id => config.parts.find(p => p.id === id);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const fresh = () => ({ schemaVersion: 1, buildingId: config.id, faceGroupingVersion: 3, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });

test('touching solids have no selectable buried interface and exposed tops are counted once', () => {
  const parts = [0, 100].map((x, i) => ({ id: `box-${i}`, floorId: 'f1', kind: 'step', centerMm: [x, 50, 0], sizeMm: [100, 100, 100], color: '#ffffff' }));
  const surfaces = exteriorSurfaces([], parts, 0, {}), top = surfaces.filter(s => s.rotationX === -Math.PI / 2);
  close(top.reduce((a, s) => a + s.widthMm * s.heightMm, 0), 20000);
  assert.equal(surfaces.some(s => s.id.includes('east-50') || s.id.includes('west--50')), false);
  assert.equal(surfaces.some(s => s.rotationX === Math.PI / 2), false);
});

test('roof and terrace parapet caps, balcony ceilings and entrance treads are real selectable faces', () => {
  for (const id of ['roof-front', 'roof-back', 'roof-side--1', 'roof-side-1', 'terrace-south', 'terrace-side--1', 'terrace-side-1']) {
    assert.ok(config.walls.some(w => w.id.startsWith(`exposed-${id}-top-`)), id);
  }
  for (const id of ['f2-slab', 'f3-slab', 'f4-slab', 'roof-slab']) assert.ok(config.walls.some(w => w.id.startsWith(`exposed-${id}-bottom-`)), id);
  for (const id of ['entry-platform', 'front-step', 'entry-step-2']) assert.ok(config.walls.some(w => w.id.startsWith(`exposed-${id}-top-`)), id);
  assert.ok(config.walls.filter(w => w.surfaceKind === 'exposed-surface').every(w => w.surfaceOnly && w.claddingMm === 1));
});

test('all generated coplanar sources have no overlapping finish area, including roof corner caps', () => {
  for (const face of faces.filter(f => f.surfaceKind === 'exposed-surface')) {
    for (let i = 0; i < face.members.length; i++) for (const b of face.members.slice(i + 1)) {
      const a = face.members[i];
      for (const x of faceSolids({ ...face, rects: a.rects, holes: a.holes })) for (const y of faceSolids({ ...face, rects: b.rects, holes: b.holes })) assert.equal(intersect(x, y), null, face.id);
    }
    close(faceSolids(face).reduce((sum, r) => sum + area(r), 0), face.members.reduce((sum, m) => sum + faceSolids({ ...face, rects: m.rects, holes: m.holes }).reduce((s, r) => s + area(r), 0), 0));
  }
});

test('third-floor corner follows one actual east wall skin with a separate front jamb and visible net floor', () => {
  const east = wall('f3-right'), side = wall('f3-porch-right'), jamb = wall('f3-balcony-front-jamb'), back = wall('f3-porch-back');
  assert.equal(side.surfaceOnly, true); close(side.originMm[0], east.originMm[0] - east.thicknessMm);
  close(side.widthMm, 1340); close(jamb.widthMm, 260);
  close(side.originMm[0] - jamb.originMm[0], 210);
  close(back.originMm[0] + back.widthMm, side.originMm[0]);
  const floor = faces.find(f => f.id === 'f3-porch-floor:face:0');
  assert.ok(floor.sourceWallIds.includes('f3-porch-floor-side'));
  close(faceMetrics(floor).netAreaMm2, 5710 * 1340);
});

test('third-floor balcony side opening is a door at floor level and dimensions retain their uncertainty', () => {
  const door = wall('f3-porch-left').openings.find(o => o.id === 'f3-balcony-side-door');
  assert.equal(door.kind, 'door'); assert.equal(door.y, 0); assert.equal(door.evidence.status, 'pending');
  assert.match(door.evidence.note, /待复核/); close(door.width, 900); close(door.height, 2800);
});

test('entrance has a full landing, two exposed treads and three equal rises down to the site base', () => {
  const landing = part('entry-platform'), upper = part('front-step'), lower = part('entry-step-2'), base = part('f1-slab');
  const top = p => p.centerMm[1] + p.sizeMm[1] / 2, front = p => p.centerMm[2] + p.sizeMm[2] / 2, back = p => p.centerMm[2] - p.sizeMm[2] / 2;
  close(top(landing), 0); close(top(upper), -150); close(top(lower), -300); close(top(base), -450);
  close(front(landing), back(upper)); close(front(upper), back(lower));
  close(upper.sizeMm[0], 1800); close(upper.sizeMm[2], 300); close(landing.sizeMm[0], 10320);
  close(base.sizeMm[0], 12320); close(base.sizeMm[2], 14320);
});

test('paint has continuous solids and no tile cells, cuts or grout subdivision at any retained tile size', () => {
  const state = fresh(), face = faces.find(f => f.id === 'f1-front:face:0'), grid = faceGridWall(face, config.walls);
  const base = { ...config.defaultTile, materialId: 'paint', preserveZoning: false };
  const a = faceFinishLayout(face, grid, base, state, 1), b = faceFinishLayout(face, grid, { ...base, widthMm: 20, heightMm: 20, groutMm: 20 }, state, 1);
  assert.deepEqual(a, b); assert.equal(a.sourceTiles, 0); assert.equal(a.cutTiles, 0); assert.equal(a.narrowPieces, 0);
  close(a.netAreaMm2, faceMetrics(face).netAreaMm2);
  assert.ok(a.pieces.length > 0); assert.ok(a.pieces.every(p => !face.holes.some(h => intersect(p, h))));
});

test('mixed material quantities retain tile purchasing and report paint area without imaginary paint tiles', () => {
  const initial = fresh(), face = faces.find(f => f.id === 'f1-front:face:0');
  const next = replaceFaces(initial, [face], { ...config.defaultTile, materialId: 'paint', preserveZoning: false });
  const quantities = buildingTileQuantities(faces, next), row = quantities.byFace.get(face.id)[0], totals = tileQuantityTotals(quantities.all);
  assert.equal(row.kind, 'paint'); assert.equal(row.tiles, 0); assert.equal(row.widthMm, 0); assert.equal(row.heightMm, 0);
  close(quantities.byFace.get(face.id)[0].areaMm2, faceMetrics(face).netAreaMm2);
  close(totals.paintArea, tileQuantityTotals(buildingTileQuantities(faces, initial).all).paintArea + faceMetrics(face).netAreaMm2 / 1e6);
  assert.ok(totals.tiles > 0); close(tileQuantityTotals([row]).purchaseArea, 0);
});

test('paint style and restoration preserve material kind and cannot be mistaken for an identically coloured tile', () => {
  const state = fresh(), material = { ...config.materials.find(m => m.id === 'paint'), id: 'paint-style', pricePerM2: 100, color: '#b7a48c' };
  const style = validateTileStyle({ id: 'style', name: '暖色漆面', material, finish: { ...config.defaultTile, materialId: material.id }, createdAt: '2026-10-18', updatedAt: '2026-10-18' });
  const imported = importTileStyle(state, style);
  assert.equal(imported.state.materials.find(m => m.id === imported.finish.materialId).kind, 'paint');
  assert.equal(tileStyleName(material), `${material.name} · 修改1`);
  const face = faces.find(f => f.id === 'f1-front:face:0'), saved = replaceFaces(imported.state, [face], imported.finish), original = structuredClone(saved);
  assert.equal(validateState(saved).faceFinishes[face.id].materialId, imported.finish.materialId); assert.deepEqual(saved, original);
  assert.throws(() => validateMaterial({ ...material, texture: 'stone' }), /纯色/);
});

test('a full 24-material old plan gains the new paint defaults without dropping any original samples', () => {
  const saved = fresh();
  saved.materials = saved.materials.filter(m => m.kind !== 'paint');
  while (saved.materials.length < 24) saved.materials.push({ id: `old-${saved.materials.length}`, name: '原样例', color: '#abcdef', texture: 'plain' });
  saved.finishes = Object.fromEntries(Object.entries(saved.finishes).filter(([id]) => !id.startsWith('exposed-')));
  const original = structuredClone(saved), restored = validateState(saved);
  assert.deepEqual(saved, original);
  for (const material of saved.materials) assert.deepEqual(restored.materials.find(m => m.id === material.id), material);
  assert.ok(restored.materials.some(m => m.kind === 'paint')); assert.equal(restored.materials.length, 25);
});
