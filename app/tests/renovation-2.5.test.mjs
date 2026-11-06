// Historical revision-7 contract: retained for migration; current selection rules are tested in renovation-2.7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFacesAtRevision7 as buildingFaces, faceSolids, faceGridWall, faceTileLayout } from '../src/renovation3d/utils/wall-surfaces.ts';
import { selectionIntersectionLines } from '../src/renovation3d/utils/surface-intersections.ts';
import { dot, wallFrame } from '../src/renovation3d/utils/geometry.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';
import { outlineSegments } from '../src/renovation3d/utils/outline.ts';
import { isObjectVisible, matchesViewScope } from '../src/renovation3d/utils/view-groups.ts';
import { validateRevision7State as validateState } from '../src/renovation3d/utils/validation.ts';
import { replaceFaces } from '../src/renovation3d/utils/finish-actions.ts';

const faces = buildingFaces(config.walls);
const former = JSON.parse(fs.readFileSync(new URL('./fixtures/renovation-2.4-faces.json', import.meta.url)));
const area = rs => rs.reduce((sum, r) => sum + r.width * r.height, 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const fresh = () => ({ schemaVersion: 1, faceGroupingVersion: 6, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], hiddenGroups: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });

// Independent geometric containment against the actual saved 2.4 scene.
function oldParent(face) {
  const { n, u, v } = wallFrame(face), plane = dot(n, face.originMm) + face.offsetMm;
  const hits = former.flatMap(old => {
    if (old.floorId !== face.floorId || dot(n, wallFrame(old).n) < 0.99 || Math.abs(dot(n, old.originMm) + old.offsetMm - plane) > 1e-5) return [];
    const delta = old.originMm.map((a, i) => a - face.originMm[i]), dx = dot(delta, u), dy = dot(delta, v);
    const overlap = faceSolids(face).reduce((sum, r) => sum + faceSolids(old).reduce((n, s) => {
      const p = intersect(r, { ...s, x: s.x + dx, y: s.y + dy }); return n + (p ? p.width * p.height : 0);
    }, 0), 0);
    return overlap > 1e-5 ? [{ old, overlap }] : [];
  });
  assert.equal(hits.length, 1, face.id); close(hits[0].overlap, area(faceSolids(face)));
  return hits[0].old;
}

test('fourth-floor front lintel, its returns and exposed caps remain with the room when the roof is hidden', () => {
  const sources = config.walls.filter(w => w.id === 'roof-fascia' || w.finishSourceFaceId?.startsWith('roof-fascia:face:'));
  assert.ok(sources.length > 2);
  const state = { ...fresh(), hiddenGroups: ['terrace'] };
  for (const source of sources) {
    assert.equal(source.viewGroup, undefined, source.id); assert.equal(isObjectVisible(source, state), true);
    const selected = faces.filter(f => f.sourceWallIds.includes(source.id));
    assert.ok(selected.length, source.id);
    for (const f of selected) { assert.equal(isObjectVisible(f, state), true); assert.equal(matchesViewScope(f, 'f4'), true); }
  }
  assert.equal(isObjectVisible(config.parts.find(p => p.id === 'roof-slab'), state), false);
  assert.equal(isObjectVisible(config.walls.find(w => w.id === 'roof-front'), state), false);
  assert.equal(isObjectVisible(sources[0], { ...state, hiddenFloors: ['f4'] }), false);
});

test('every finite wall, cap and relief-return intersection stops at an independent face boundary', () => {
  assert.equal(new Set(faces.map(f => f.id)).size, faces.length);
  for (const face of faces) for (const other of faces) if (face !== other) {
    assert.deepEqual(selectionIntersectionLines(face, other, config.parts), [], `${face.id} / ${other.id}`);
    const { n, u, v } = wallFrame(face);
    if (dot(n, wallFrame(other).n) < 0.99 || Math.abs(dot(n, other.originMm) + other.offsetMm - dot(n, face.originMm) - face.offsetMm) > 1e-5) continue;
    const d = other.originMm.map((a, i) => a - face.originMm[i]);
    for (const a of faceSolids(face)) for (const b of faceSolids(other)) assert.equal(intersect(a, { ...b, x: b.x + dot(d, u), y: b.y + dot(d, v) }), null, `${face.id} overlaps ${other.id}`);
  }
});

test('porch soffit turns no longer wrap around the entire building as one selected face', () => {
  for (const face of faces.filter(f => f.surfaceKind === 'exposed-surface' || f.surfaceKind === 'relief-return')) {
    const directions = face.sourceWallIds.flatMap(id => {
      const sourceId = config.walls.find(w => w.id === id).finishSourceFaceId?.split(':face:')[0];
      const source = config.walls.find(w => w.id === sourceId);
      return source ? [wallFrame(source).n.map(n => Math.round(n)).join(':')] : [];
    });
    assert.ok(new Set(directions).size <= 1, face.id);
  }
  const left = faces.find(f => f.sourceWallIds.includes('exposed-f1-front-bottom--3300'));
  const right = faces.find(f => f.sourceWallIds.includes('exposed-f1-right-bottom--3300'));
  assert.ok(left && right); assert.notEqual(left.id, right.id);
  const changed = replaceFaces(fresh(), [right], { ...config.defaultTile, materialId: 'sand', preserveZoning: false });
  assert.equal(changed.faceFinishes[right.id].materialId, 'sand'); assert.equal(changed.faceFinishes[left.id], undefined);
});

test('splitting preserves every former patch area and each cut tile UV, with no duplicate selection edges', () => {
  const totals = new Map();
  for (const face of faces) {
    const parent = oldParent(face); totals.set(parent.id, (totals.get(parent.id) ?? 0) + area(faceSolids(face)));
    const edges = outlineSegments(face.rects, face.holes).map(line => line.map(p => p.join(',')).sort().join('|'));
    assert.equal(new Set(edges).size, edges.length);
    for (const p of faceTileLayout(face, faceGridWall(face, config.walls), config.defaultTile).pieces) {
      close((p.uv[2] - p.uv[0]) * 1200, p.width); close((p.uv[3] - p.uv[1]) * 600, p.height);
    }
  }
  for (const old of former) close(totals.get(old.id), area(faceSolids(old)));
});

test('all 239 independent 2.4 finishes migrate by actual geometry, including renamed terrace anchors, without input mutation', () => {
  const state = { ...fresh(), faceGroupingVersion: 5, faceFinishes: Object.fromEntries(former.map((f, i) => [f.id, {
    ...config.defaultTile, materialId: 'sand', groutColor: `#${i.toString(16).padStart(6, '0')}`, preserveZoning: false,
  }])) }, original = structuredClone(state), restored = validateState(state);
  for (const face of faces) assert.deepEqual(restored.faceFinishes[face.id], state.faceFinishes[oldParent(face).id], face.id);
  assert.equal(Object.keys(restored.faceFinishes).length, faces.length);
  assert.deepEqual(state, original); assert.equal(restored.faceGroupingVersion, 7); assert.deepEqual(validateState(restored), restored);
  const child = faces.find(f => f.id !== oldParent(f).id), neighbour = faces.find(f => f.id !== child.id && oldParent(f).id === oldParent(child).id);
  const retained = structuredClone(restored.faceFinishes[neighbour.id]); delete restored.faceFinishes[child.id];
  const again = validateState(restored);
  assert.equal(again.faceFinishes[child.id], undefined); assert.deepEqual(again.faceFinishes[neighbour.id], retained);
});

test('upgrading an untouched 2.4 scene does not copy a neighbouring override into independently defaulted patches', () => {
  const state = { ...fresh(), faceGroupingVersion: 5, faceFinishes: {} };
  assert.deepEqual(validateState(state).faceFinishes, {});
  const old = former.find(f => f.id === 'exposed-f4-left-bottom--13200:face:0');
  state.faceFinishes[old.id] = { ...config.defaultTile, materialId: 'sand', preserveZoning: false };
  const restored = validateState(state);
  for (const face of faces) assert.equal(restored.faceFinishes[face.id]?.materialId, oldParent(face).id === old.id ? 'sand' : undefined);
});
