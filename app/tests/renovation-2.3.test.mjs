import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFaces, faceSolids, openingOffset } from '../src/renovation3d/utils/wall-surfaces.ts';
import { buildingBodies, planeRect, wallFrame, wallBodies, pointBounds, worldPoint } from '../src/renovation3d/utils/geometry.ts';
import { rectUnion } from '../src/renovation3d/utils/outline.ts';
import { validateRevision9State as validateState } from '../src/renovation3d/utils/validation.ts';
import { windowGeometry } from '../src/renovation3d/utils/window-finishes.ts';

const wall = id => config.walls.find(w => w.id === id), faces = buildingFaces(config.walls);
const area = rs => rs.reduce((sum, r) => sum + r.width * r.height, 0);

test('the screen head is closed by real beam volume and a complete selectable soffit', () => {
  const screen = config.parts.find(p => p.id === 'f1-entry-screen');
  const [depth, height, width] = screen.sizeMm, [x, y, z] = screen.centerMm, top = y + height / 2;
  const footprint = { x: x - depth / 2, y: z - width / 2, width: depth, height: width };
  const soffits = faces.filter(f => wallFrame(f).n[1] < -0.99).flatMap(f => faceSolids(f).flatMap(r => {
    const b = planeRect(f, r, f.offsetMm);
    return Math.abs(b.min[1] - top) < 1e-5 ? [{ x: b.min[0], y: b.min[2], width: b.max[0] - b.min[0], height: b.max[2] - b.min[2] }] : [];
  }));
  assert.equal(area(rectUnion([footprint], soffits)), 0);
  const beams = buildingBodies(config.walls, config.parts).filter(b => b.owner === 'f1-right' && b.min[1] === top);
  assert.ok(beams.some(b => b.min[0] === 4700 && b.max[0] === 5160 && b.min[2] === 4600 && b.max[2] === 6100));
  assert.deepEqual(screen.sizeMm, [200, 3300, 1200]);
});

test('a recessed head locates the whole frame even when the opening centre is in the white zone', () => {
  const host = wall('f2-back'), opening = host.openings.find(o => o.id === 'f2-n-stair');
  assert.equal(openingOffset(host, opening), -60);
  assert.equal(openingOffset({ finishZones: [...host.finishZones].reverse() }, opening), -60);
  assert.equal(openingOffset(wall('f3-back'), wall('f3-back').openings[0]), -60);
  assert.equal(openingOffset(host, host.openings.find(o => o.id === 'f2-n-window')), 0);
  const fixture = { finishZones: [{ x: 0, y: 0, width: 100, height: 100, offsetMm: 0 },
    { x: 100, y: 100, width: 100, height: 100, offsetMm: -60 }] };
  assert.equal(openingOffset(fixture, { x: 0, y: 0, width: 100, height: 100 }), 0);
});

test('recessing the north window exposes its actual sill return rather than leaving an open edge', () => {
  const sill = faces.find(f => f.sourceWallIds.includes('exposed-f2-back-top-4800'));
  assert.ok(sill);
  assert.equal(area(faceSolids(sill)), 800 * 60);
  assert.equal(wallFrame(sill).n[1], 1);
});

test('all window frames clear their host and neighbouring structural solids after depth placement', () => {
  const bodies = buildingBodies(config.walls, config.parts);
  for (const host of config.walls) for (const opening of host.openings.filter(o => o.kind === 'window')) {
    const offset = openingOffset(host, opening);
    for (const frame of windowGeometry(opening).frames) {
      const bounds = pointBounds([offset - config.openings.depthMm, offset].flatMap(z => [
        [opening.x + frame.x, opening.y + frame.y, z], [opening.x + frame.x + frame.width, opening.y + frame.y + frame.height, z],
      ].map(p => worldPoint(host, p))));
      for (const body of bodies) assert.equal([0, 1, 2].every(i => Math.min(bounds.max[i], body.max[i]) - Math.max(bounds.min[i], body.min[i]) > 1e-5), false, `${opening.id} intersects ${body.owner}`);
    }
  }
});

test('the third-floor side door reaches the adjacent window head and its masonry opening follows', () => {
  const host = wall('f3-porch-left'), door = host.openings.find(o => o.id === 'f3-balcony-side-door');
  const adjacent = wall('f3-porch-back').openings.find(o => o.id === 'f3-balcony-door');
  assert.equal(door.y, 0); assert.equal(door.height, 2800); assert.equal(door.width, 900);
  assert.equal(host.originMm[1] + door.y + door.height, wall('f3-porch-back').originMm[1] + adjacent.y + adjacent.height);
  const probe = { x: door.x, y: 2200, width: door.width, height: 600 };
  assert.equal(area(rectUnion([probe], wallBodies(host).map(b => b.rect))), area([probe]));
  assert.match(door.evidence.note, /上沿/); assert.match(door.evidence.note, /待复核/);
});

test('historical revision7: the two retired north reveal fragments retain their saved finish without repeat migration', () => {
  const finish = { ...config.defaultTile, materialId: 'sand', preserveZoning: false };
  const saved = { schemaVersion: 1, faceGroupingVersion: 4, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
    finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])),
    faceFinishes: Object.fromEntries(['east-1150', 'west--1950'].map(side => [`exposed-f3-back-${side}:face:0:part:0:2500`, finish])) };
  const before = structuredClone(saved), restored = validateRevision7State(saved);
  for (const side of ['east-1150', 'west--1950']) assert.deepEqual(restored.faceFinishes[`exposed-f3-back-${side}:face:0`], finish);
  assert.deepEqual(saved, before); assert.deepEqual(validateRevision7State(restored), restored);
});
