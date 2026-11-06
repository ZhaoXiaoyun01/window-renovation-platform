import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Euler, Matrix4, Vector3 } from 'three';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { buildingFaces, faceSolids, openingOffset } from '../src/renovation3d/utils/wall-surfaces.ts';
import { windowGeometry } from '../src/renovation3d/utils/window-finishes.ts';
import { wallBodies } from '../src/renovation3d/utils/geometry.ts';

const wall = id => config.walls.find(w => w.id === id);
const host = wall('f4-front-east'), side = wall('f4-terrace-return');
const opening = host.openings.find(o => o.id === 'f4-s-glass');
const transform = w => new Matrix4().makeRotationFromEuler(new Euler(w.rotationX ?? 0, w.rotationY, 0))
  .setPosition(...w.originMm);
const box = (w, rect, back, front) => new Box3(new Vector3(rect.x, rect.y, back), new Vector3(rect.x + rect.width, rect.y + rect.height, front)).applyMatrix4(transform(w));
const overlapVolume = (a, b) => {
  const size = a.clone().intersect(b).getSize(new Vector3());
  return [size.x, size.y, size.z].every(n => n > 1e-5) ? size.x * size.y * size.z : 0;
};

// Reconstruct the structural boxes used by FaceMesh, including grouped members,
// cutouts and slab coverage. Check actual occupied space, not cutout constants.
function masonry(w) {
  return wallBodies(w).map(({ rect, backMm, frontMm }) => box(w, rect, backMm, frontMm));
}

test('terrace glazing retains its identity and right edge while its approved left jamb grows by 240mm', () => {
  assert.equal(opening.kind, 'window');
  assert.deepEqual([opening.width, opening.height], [3960, 2700]);
  const origin = new Vector3(opening.x, opening.y, openingOffset(host, opening)).applyMatrix4(transform(host));
  assert.deepEqual(origin.toArray(), [940, 10400, 540]);
  assert.ok(buildingFaces(config.walls).some(f => f.id === 'f4-terrace-return:face:0'));
  assert.ok(buildingFaces(config.walls).some(f => f.id === 'f4-front-east:face:0'));
});

test('no adjacent masonry penetrates any terrace window frame or the glazed opening depth', () => {
  const depth = config.openings.depthMm, offset = openingOffset(host, opening);
  const geometry = windowGeometry(opening);
  const frames = geometry.frames.map(r => box(host, { ...r, x: r.x + opening.x, y: r.y + opening.y }, offset - depth, offset));
  const glazing = box(host, opening, offset - depth, offset);
  for (const w of config.walls.filter(w => !w.surfaceOnly && w.floorId === host.floorId)) {
    for (const solid of masonry(w)) {
      for (const frame of frames) assert.equal(overlapVolume(solid, frame), 0, `${w.id} penetrates a window frame`);
      assert.equal(overlapVolume(solid, glazing), 0, `${w.id} obstructs the glazed opening`);
    }
  }
});

test('return wall meets the enclosing jamb and header back without overlapping either', () => {
  const solids = masonry(side), jambBack = host.originMm[2] - host.thicknessMm;
  const headerBottom = host.originMm[1] + opening.y + opening.height;
  const lower = solids.filter(b => b.min.y < headerBottom - 1e-5);
  const upper = solids.filter(b => b.max.y > headerBottom + 1e-5);
  assert.ok(lower.length && upper.length);
  assert.equal(Math.max(...lower.map(b => b.max.z)), jambBack);
  assert.equal(Math.max(...upper.map(b => b.max.z)), host.originMm[2] - host.thicknessMm);
  const front = masonry(host);
  assert.ok(front.some(b => b.min.x === 700 && b.max.x === 940));
  for (const a of solids) for (const b of [...front, ...masonry(wall('roof-fascia'))]) assert.equal(overlapVolume(a, b), 0);
  // The return meets the full-height jamb without a cavity at the junction.
  for (const y of [1, opening.height / 2, opening.height - 1]) {
    assert.ok(lower.some(b => b.min.y <= host.originMm[1] + y && b.max.y >= host.originMm[1] + y && b.max.z === jambBack));
  }
});
