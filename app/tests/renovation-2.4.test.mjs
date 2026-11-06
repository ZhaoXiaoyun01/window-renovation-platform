import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { baseBuildingFaces, buildingFaces, faceSolids } from '../src/renovation3d/utils/wall-surfaces.ts';
import { intersectedFaces, splitAtLevels } from '../src/renovation3d/utils/surface-intersections.ts';
import { buildingBodies, wallFrame, planeRect } from '../src/renovation3d/utils/geometry.ts';
import { rectUnion } from '../src/renovation3d/utils/outline.ts';
import { isObjectVisible, matchesViewScope } from '../src/renovation3d/utils/view-groups.ts';
import { validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';
import { buildingTileQuantities } from '../src/renovation3d/utils/tile-quantities.ts';

const faces = buildingFaces(config.walls), wall = id => config.walls.find(w => w.id === id);
const area = rs => rs.reduce((sum, r) => sum + r.width * r.height, 0);
const fresh = () => ({ schemaVersion: 1, faceGroupingVersion: 5, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], hiddenGroups: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });

test('the entire inner lintel and corner meet a real continuous soffit, beyond the screen envelope', () => {
  const footprint = { x: 4700, y: 4600, width: 400, height: 1500 };
  const soffits = faces.filter(f => wallFrame(f).n[1] < -0.99).flatMap(f => faceSolids(f).flatMap(r => {
    const b = planeRect(f, r, f.offsetMm);
    return b.min[1] === 3300 ? [{ x: b.min[0], y: b.min[2], width: b.max[0] - b.min[0], height: b.max[2] - b.min[2] }] : [];
  }));
  const occupiedBelow = buildingBodies(config.walls, config.parts).filter(b => b.min[1] < 3300 && b.max[1] >= 3300).map(b => ({ x: b.min[0], y: b.min[2], width: b.max[0] - b.min[0], height: b.max[2] - b.min[2] }));
  assert.equal(area(rectUnion([footprint], [...soffits, ...occupiedBelow])), 0);
  assert.ok(buildingBodies(config.walls, config.parts).some(b => b.owner === 'f1-right' && b.min[0] === 4700 && b.max[0] === 5160 && b.min[1] === 3300 && b.max[1] === 3620 && b.min[2] === 4600 && b.max[2] === 6100));
});

test('the fourth-floor room and terrace/roof toggle independently in both directions', () => {
  const room = wall('f4-front-east'), roof = config.parts.find(p => p.id === 'roof-slab'), terrace = wall('terrace-south');
  for (const object of [roof, terrace, wall('f4-roof-floor'), wall('f4-terrace-floor')]) assert.equal(object.viewGroup, 'terrace');
  assert.equal(room.viewGroup, undefined);
  const state = fresh(); state.hiddenGroups = ['terrace'];
  assert.equal(isObjectVisible(room, state), true); assert.equal(isObjectVisible(roof, state), false); assert.equal(isObjectVisible(terrace, state), false);
  state.hiddenGroups = []; state.hiddenFloors = ['f4'];
  assert.equal(isObjectVisible(room, state), false); assert.equal(isObjectVisible(roof, state), true);
  state.hiddenGroups = ['terrace']; assert.equal(isObjectVisible(roof, state), false);
});

test('historical revision7: view splitting preserves area and assigns each selectable face to only one visibility group', () => {
  const faces = buildingFacesAtRevision7();
  const original = splitAtLevels(intersectedFaces(baseBuildingFaces(config.walls), config.walls, config.parts), config.floors.map(f => f.elevationMm + f.heightMm));
  assert.ok(Math.abs(original.reduce((n, f) => n + area(faceSolids(f)), 0) - faces.reduce((n, f) => n + area(faceSolids(f)), 0)) < 1e-5);
  for (const face of faces) for (const member of face.members) {
    if (area(rectUnion(member.rects, [...member.holes, ...face.holes])) > 1e-5) assert.equal(wall(member.wallId).viewGroup, face.viewGroup, face.id);
  }
  assert.ok(faces.some(f => f.id.includes(':view:terrace')));
});

test('historical revision7: material scopes split the room and terrace while hiding keeps whole-building quantities unchanged', () => {
  const faces = buildingFacesAtRevision7();
  const room = faces.filter(f => matchesViewScope(f, 'f4')), terrace = faces.filter(f => matchesViewScope(f, 'terrace'));
  assert.ok(room.length && terrace.length);
  assert.ok(room.every(f => f.floorId === 'f4' && !f.viewGroup)); assert.ok(terrace.every(f => f.viewGroup === 'terrace'));
  assert.equal(room.some(f => terrace.some(other => other.id === f.id)), false);
  const state = fresh(), before = buildingTileQuantities(faces, state);
  assert.deepEqual(buildingTileQuantities(faces, { ...state, hiddenGroups: ['terrace'], hiddenFloors: ['f4'] }), before);
});

test('historical revision7: old merged finish overrides inherit into terrace once; later edits stay independent', () => {
  const faces = buildingFacesAtRevision7();
  const child = faces.find(f => f.id.endsWith(':view:terrace')), parent = child.legacyFaceIds.find(id => faces.some(f => f.id === id));
  assert.ok(parent);
  const state = { ...fresh(), faceGroupingVersion: 4, faceFinishes: { [parent]: { ...config.defaultTile, materialId: 'sand', preserveZoning: false } } };
  const before = structuredClone(state), restored = validateRevision7State(state);
  assert.equal(restored.faceGroupingVersion, 7); assert.equal(restored.faceFinishes[child.id].materialId, 'sand'); assert.deepEqual(state, before);
  restored.faceFinishes[child.id].materialId = 'concrete';
  assert.equal(validateRevision7State(restored).faceFinishes[child.id].materialId, 'concrete'); assert.equal(validateRevision7State(restored).faceFinishes[parent].materialId, 'sand');
  assert.deepEqual(validateRevision7State(restored), restored);
});

test('hidden terrace state restores independently and rejects unknown groups without mutating the input', () => {
  const state = { ...fresh(), hiddenFloors: ['f2'], hiddenGroups: ['terrace'] }, before = structuredClone(state), restored = validateState(state);
  assert.deepEqual(restored.hiddenGroups, ['terrace']); assert.deepEqual(restored.hiddenFloors, ['f2']); assert.deepEqual(state, before);
  const legacy = fresh(); delete legacy.hiddenGroups; assert.deepEqual(validateState(legacy).hiddenGroups, []);
  for (const hiddenGroups of ['terrace', ['f4'], ['unknown'], ['terrace', 'terrace']]) assert.throws(() => validateState({ ...fresh(), hiddenGroups }), /显示分组数据无效/);
});

test('historical revision7: upgrading revision 4 does not repaint an existing independently defaulted junction child', () => {
  const faces = buildingFacesAtRevision7();
  const parent = 'roof-fascia:face:0', child = 'roof-fascia:face:0:junction:0:500';
  assert.ok(faces.some(f => f.id === child));
  const state = { ...fresh(), faceGroupingVersion: 4, faceFinishes: { [parent]: { ...config.defaultTile, materialId: 'sand', preserveZoning: false } } };
  const restored = validateRevision7State(state);
  assert.equal(restored.faceFinishes[parent].materialId, 'sand'); assert.equal(restored.faceFinishes[child], undefined);
  assert.deepEqual(validateRevision7State(restored), restored);
});
