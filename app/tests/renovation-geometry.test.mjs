import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig } from '../src/renovation3d/config/building-config.ts';
import { area, clipHoles, intersect } from '../src/renovation3d/tile-layout/layout.ts';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const wall = id => {
  const found = buildingConfig.walls.find(w => w.id === id);
  assert.ok(found, `missing wall ${id}`);
  return found;
};
const part = id => {
  const found = buildingConfig.parts.find(p => p.id === id);
  assert.ok(found, `missing part ${id}`);
  return found;
};
const endpoint = w => [w.originMm[0] + Math.cos(w.rotationY) * w.widthMm, w.originMm[1], w.originMm[2] - Math.sin(w.rotationY) * w.widthMm];
const samePoint = (a, b) => a.forEach((v, i) => close(v, b[i]));
const bounds = p => p.centerMm.map((v, i) => [v - p.sizeMm[i] / 2, v + p.sizeMm[i] / 2]);

test('finish zones cover every wall once without overlap or missing edges', () => {
  for (const w of buildingConfig.walls) {
    const rectangle = { x: 0, y: 0, width: w.widthMm, height: w.heightMm };
    assert.ok(w.finishZones.length > 0, w.id);
    close(w.finishZones.reduce((sum, z) => sum + area(z), 0), area(rectangle));
    w.finishZones.forEach((z, i) => {
      assert.ok(z.width > 0 && z.height > 0, w.id);
      assert.ok(Number.isFinite(z.offsetMm), w.id);
      assert.deepEqual(intersect(z, rectangle), { x: z.x, y: z.y, width: z.width, height: z.height });
      for (const other of w.finishZones.slice(i + 1)) assert.equal(intersect(z, other), null, w.id);
    });
  }
});

test('mixed white and grey facade zones have a physical 60 mm relief', () => {
  const mixed = buildingConfig.walls.filter(w => w.finishZones.some(z => z.materialId === 'ivory') && w.finishZones.some(z => z.materialId === 'basalt'));
  assert.ok(mixed.length >= 8, 'relief must occur around multiple facades and floors');
  for (const w of mixed) {
    for (const z of w.finishZones) assert.equal(z.offsetMm, z.materialId === 'basalt' ? -60 : 0, w.id);
  }
  for (const facade of ['back', 'left', 'right']) assert.ok(mixed.some(w => w.facade === facade), facade);
  assert.ok(wall('f2-front').finishZones.every(z => z.offsetMm === -60));
  assert.ok(wall('f3-front').finishZones.every(z => z.offsetMm === 0));
});

test('all independent openings remain inside their wall and do not overlap', () => {
  const ids = new Set();
  for (const w of buildingConfig.walls) {
    w.openings.forEach((o, i) => {
      assert.equal(ids.has(o.id), false, o.id); ids.add(o.id);
      assert.ok(o.width > 0 && o.height > 0 && o.x >= 0 && o.y >= 0, o.id);
      assert.ok(o.x + o.width <= w.widthMm && o.y + o.height <= w.heightMm, o.id);
      for (const other of w.openings.slice(i + 1)) assert.equal(intersect(o, other), null, o.id);
    });
  }
});

test('balcony returns connect their back walls to the actual facade finish plane', () => {
  for (const floorId of ['f1', 'f2', 'f3']) {
    const front = wall(`${floorId}-front`), back = wall(`${floorId}-porch-back`);
    const left = wall(`${floorId}-porch-left`), right = wall(`${floorId}-porch-right`);
    const opening = front.openings.find(o => o.kind === 'balcony');
    assert.ok(opening);
    const depth = floorId === 'f2' ? 1540 : floorId === 'f1' ? 1560 : 1600, frontZ = front.originMm[2] + (floorId === 'f2' ? -60 : 0);
    close(left.widthMm, depth); close(right.widthMm, floorId === 'f3' ? depth - front.thicknessMm : floorId === 'f1' ? depth - 60 : depth);
    samePoint(endpoint(left), back.originMm);
    if (floorId === 'f2') samePoint(endpoint(back), [wall('f2-right').originMm[0] - 60, back.originMm[1], right.originMm[2]]);
    else if (floorId === 'f3') samePoint(right.originMm, endpoint(back));
    else close(right.originMm[0], 4700);
    samePoint(left.originMm, [front.originMm[0] + opening.x, front.originMm[1], frontZ]);
    samePoint(endpoint(right), floorId === 'f3' ? [wall('f3-right').originMm[0] - wall('f3-right').thicknessMm, front.originMm[1], frontZ - front.thicknessMm] : [front.originMm[0] + opening.x + opening.width, front.originMm[1], frontZ - (floorId === 'f1' ? 60 : 0)]);
    for (const w of [back, left, right]) close(w.heightMm, front.heightMm);
  }
});

test('balcony rails align with the recessed opening and both return walls', () => {
  for (const floorId of ['f2', 'f3']) {
    const front = wall(`${floorId}-front`), rail = bounds(part(`${floorId}-rail`));
    const opening = front.openings.find(o => o.kind === 'balcony');
    close(rail[0][0], front.originMm[0] + opening.x);
    close(rail[0][1], front.originMm[0] + opening.x + opening.width);
    assert.ok(rail[2][0] >= front.originMm[2] - 1600 && rail[2][1] <= front.originMm[2]);
  }
});

test('fourth-floor slab is continuous with a 60 mm structural inset behind terrace parapets', () => {
  const slab = bounds(part('f4-slab'));
  const floor = buildingConfig.floors.find(f => f.id === 'f4');
  close(slab[1][1], floor.elevationMm);
  close(slab[0][1] - slab[0][0], 10200);
  close(slab[2][1] - slab[2][0], 12200);
  close(slab[2][0] - wall('f4-back').originMm[2], 60);
  close(wall('terrace-south').originMm[2] - slab[2][1], 60);
  for (const w of buildingConfig.walls.filter(w => w.id.startsWith('terrace-'))) {
    for (const point of [w.originMm, endpoint(w)]) {
      assert.ok(point[0] >= slab[0][0] - 60 - 1e-6 && point[0] <= slab[0][1] + 60 + 1e-6, w.id);
      assert.ok(point[2] >= slab[2][0] - 60 - 1e-6 && point[2] <= slab[2][1] + 60 + 1e-6, w.id);
      close(point[1], slab[1][1]);
    }
  }
  assert.equal(buildingConfig.parts.some(p => p.id === 'terrace-slab'), false, 'the terrace must not leave a separate slab gap');
});

test('facades remain aligned, upper slabs are inset and the base projects one metre beyond the building', () => {
  for (const floorId of ['f1', 'f2', 'f3', 'f4']) {
    const slab = bounds(part(`${floorId}-slab`));
    close(wall(`${floorId}-back`).originMm[2], -6160);
    close(wall(`${floorId}-left`).originMm[0], -5160);
    close(wall(`${floorId}-right`).originMm[0], 5160);
    const halfWidth = floorId === 'f1' ? 6160 : 5100, halfDepth = floorId === 'f1' ? 7160 : 6100;
    close(slab[0][0], -halfWidth); close(slab[0][1], halfWidth);
    close(slab[2][0], -halfDepth); close(slab[2][1], halfDepth);
    if (floorId === 'f1') { close(slab[0][1] - 5160, 1000); close(slab[2][1] - 6160, 1000); }
    if (floorId !== 'f4') close(wall(`${floorId}-front`).originMm[2], 6160);
  }
});

test('rear white planes and grey vertical strips cross floor beams without artificial white bands', () => {
  const finishAt = (w, x, y) => w.finishZones.find(z => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height);
  for (const floorId of ['f2', 'f3']) {
    const back = wall(`${floorId}-back`);
    for (const y of [0, back.heightMm - 1]) {
      assert.equal(finishAt(back, 2000, y).materialId, 'ivory');
      assert.equal(finishAt(back, 3600, y).materialId, floorId === 'f2' && y === 0 ? 'ivory' : 'basalt');
      assert.equal(finishAt(back, 3600, y).offsetMm, floorId === 'f2' && y === 0 ? 0 : -60);
    }
    for (const [facade, x] of [['left', 4000], ['right', 6800]]) {
      const side = wall(`${floorId}-${facade}`);
      for (const y of [0, side.heightMm - 1]) assert.equal(finishAt(side, x, y).materialId, 'basalt');
    }
  }
  assert.ok(wall('f2-front').finishZones.every(z => z.materialId === 'basalt' && z.offsetMm === -60));
});

test('second-floor side balcony opens through the return and connects to the front glass rail', () => {
  assert.equal(wall('f1-right').openings.some(o => o.id === 'f1-e-door'), false);
  const side = wall('f2-right'), inner = wall('f2-porch-right');
  const sideOpening = side.openings.find(o => o.id === 'f2-e-balcony');
  const innerOpening = inner.openings.find(o => o.id === 'f2-porch-side-opening');
  assert.equal(sideOpening.kind, 'balcony'); assert.equal(innerOpening.kind, 'balcony');
  close(sideOpening.width, 1240); close(innerOpening.width, 1240);
  close(sideOpening.x, 300); close(inner.widthMm - innerOpening.width, 300);
  close(sideOpening.y, innerOpening.y); close(sideOpening.height, innerOpening.height);
  close(side.originMm[2] - sideOpening.x, inner.originMm[2] + innerOpening.x + innerOpening.width);
  close(side.originMm[2] - sideOpening.x - sideOpening.width, inner.originMm[2] + innerOpening.x);
  const frontRail = part('f2-rail'), sideRail = bounds(part('f2-side-rail'));
  close(sideRail[0][1], side.originMm[0] - 60);
  assert.ok(sideRail[0][0] > bounds(frontRail)[0][1], 'the front wall return separates the two rail ends');
  close(sideRail[2][1], side.originMm[2] - sideOpening.x);
  close(sideRail[2][0], inner.originMm[2]);
  assert.deepEqual(sideRail[1], bounds(frontRail)[1]);
});

test('the restored second-floor column side contributes its full visible area to the east face', () => {
  const side = wall('f2-right'), opening = side.openings.find(o => o.id === 'f2-e-balcony');
  const column = { x: 0, y: opening.y, width: 200, height: opening.height };
  assert.equal(intersect(column, opening), null);
  close(clipHoles(column, side.openings).reduce((sum, r) => sum + area(r), 0), 540000);
});

test('the first-floor recessed rear-west corner meets without a projecting grey strip', () => {
  const back = wall('f1-back'), west = wall('f1-left');
  const point = (w, x) => [w.originMm[0] + Math.cos(w.rotationY) * x - Math.sin(w.rotationY) * 60,
    w.originMm[1], w.originMm[2] - Math.sin(w.rotationY) * x - Math.cos(w.rotationY) * 60];
  samePoint(point(back, back.widthMm - 60), point(west, 60));
  for (const w of [back, west]) {
    close(w.surfaceCuts[0].height, 3300);
    assert.ok(w.openings.every(o => intersect(o, w.surfaceCuts[0]) === null));
  }
});

test('the fourth-floor glass stops at the east wall and the adjacent narrow opening remains a door', () => {
  const east = wall('f4-front-east'), glass = east.openings.find(o => o.id === 'f4-s-glass');
  close(east.originMm[0] + glass.x, 940); close(east.originMm[0] + glass.x + glass.width, 4900);
  close(wall('f4-right').originMm[0] - wall('f4-right').thicknessMm, 4900);
  close(glass.width, 3960); close(glass.height, 2700);
  assert.equal(wall('f4-front').openings.find(o => o.id === 'f4-s-door').kind, 'door');
});

test('east narrow windows stay inside the grey strip and the top grey strip has no invented window', () => {
  for (const floorId of ['f2', 'f3']) {
    const opening = wall(`${floorId}-right`).openings.find(o => o.id === `${floorId}-e-narrow`);
    const shift = floorId === 'f2' ? 60 : 0;
    close(opening.x - (6060 - shift), 70);
    close(7400 - shift - opening.x - opening.width, 70);
    close(opening.width, 1200); close(opening.height, 1500);
    assert.equal(opening.evidence.status, 'pending');
  }
  const top = wall('f4-right');
  const grey = top.finishZones.filter(z => z.materialId === 'basalt');
  assert.ok(grey.length > 0);
  for (const opening of top.openings) for (const z of grey) assert.equal(intersect(opening, z), null);
});

test('top roof projects 60 mm beyond the outer front wall and meets its fascia', () => {
  const roof = bounds(part('roof-slab')), front = wall('f4-front-east');
  close(roof[2][1] - front.originMm[2], 60);
  close(roof[2][0], wall('f4-back').originMm[2]);
  close(roof[1][1], front.originMm[1] + front.heightMm);
  close(wall('roof-front').originMm[2], roof[2][1]);
  close(wall('roof-fascia').originMm[2], roof[2][1]);
  close(wall('roof-fascia').originMm[1] + wall('roof-fascia').heightMm, roof[1][1]);
});

test('structural wall caps meet the covering slab underside without coplanar top faces', () => {
  for (const w of buildingConfig.walls.filter(w => /^f[1-4]-/.test(w.id) && !w.surfaceOnly)) {
    const index = buildingConfig.floors.findIndex(f => f.id === w.floorId);
    const covering = bounds(part(index === 3 ? 'roof-slab' : `${buildingConfig.floors[index + 1].id}-slab`));
    close(w.originMm[1] + w.heightMm - w.topCoveredMm, covering[1][0]);
  }
});

test('the first-floor 500 mm white beam wraps every facade on the outer datum', () => {
  for (const facade of ['front', 'back', 'left', 'right']) {
    const w = wall(`f1-${facade}`);
    const top = w.finishZones.filter(z => z.y + z.height > 3300);
    close(top.reduce((sum, z) => sum + (intersect(z, { x: 0, y: 3300, width: w.widthMm, height: 500 })?.width ?? 0), 0), w.widthMm);
    assert.ok(top.every(z => z.materialId === 'ivory' && z.offsetMm === 0));
  }
});

test('second-floor grey front corners and balcony return ends meet their side planes', () => {
  const front = wall('f2-front'), left = wall('f2-left'), right = wall('f2-right');
  close(front.originMm[0], left.originMm[0] + 60);
  close(endpoint(front)[0], right.originMm[0] - 60);
  close(front.originMm[2] - 60, endpoint(left)[2]);
  close(front.originMm[2] - 60, right.originMm[2]);
  close(wall('f2-porch-left').originMm[2], right.originMm[2]);
  close(endpoint(wall('f2-porch-right'))[2], right.originMm[2]);
  assert.ok(bounds(part('f2-rail'))[2][1] <= right.originMm[2]);
});

test('the top rear-west grey L meets at its recessed corner without adding or cutting window openings', () => {
  const back = wall('f4-back'), west = wall('f4-left');
  const cases = [[back, 5960, 9860], [west, 0, 60]];
  for (const [w, start, visibleX] of cases) {
    const band = w.finishZones.find(z => z.x === start && z.y === 1000 && z.height === 1500 && z.materialId === 'basalt');
    assert.ok(band, w.id); assert.equal(band.offsetMm, -60);
    assert.equal(w.surfaceCuts.length, 1);
    for (const opening of w.openings) assert.equal(intersect(opening, w.surfaceCuts[0]), null, opening.id);
    const visible = clipHoles(band, [...w.openings, ...w.surfaceCuts]);
    assert.equal(visible.length, 1); close(visible[0].x, visibleX); close(visible[0].width, 400); close(visible[0].height, 1500);
  }
  const world = (w, x) => [w.originMm[0] + Math.cos(w.rotationY) * x - Math.sin(w.rotationY) * 60, w.originMm[1] + 1000, w.originMm[2] - Math.sin(w.rotationY) * x - Math.cos(w.rotationY) * 60];
  samePoint(world(back, back.widthMm - 60), world(west, 60));
  samePoint(world(back, back.widthMm - 60), [-5100, 11400, -6100]);
  assert.deepEqual(back.openings.map(o => o.id), ['f4-n-stair', 'f4-n-window']);
  assert.deepEqual(west.openings.map(o => o.id), ['f4-w-a', 'f4-w-b']);
  assert.equal(wall('f3-back').surfaceCuts, undefined); assert.equal(wall('f3-left').surfaceCuts, undefined);
  assert.ok(buildingConfig.notes.some(note => note.includes('用户文字称三层') && note.includes('四层')));
});

test('west stair-window grey caps are independently keyed 800 by 600 mm surfaces', () => {
  for (const floorId of ['f2', 'f3']) {
    const w = wall(`${floorId}-left`), cap = w.finishZones.filter(z => z.faceKey === 'west-stair-cap');
    assert.equal(cap.length, 1);
    const visible = clipHoles(cap[0], w.openings);
    assert.equal(visible.length, 1);
    close(visible[0].width, 800); close(visible[0].height, 600);
    close(visible[0].y, 1200); assert.equal(cap[0].offsetMm, -60);
  }
});

test('outdoor floors are upward surfaces with no added solid or window holes and no overlaps', () => {
  const surfaces = buildingConfig.walls.filter(w => w.surfaceKind === 'outdoor-floor');
  assert.equal(surfaces.length, 8);
  const rect = w => ({ x: w.originMm[0], y: w.originMm[2] - w.heightMm, width: w.widthMm, height: w.heightMm });
  surfaces.forEach((w, i) => {
    assert.equal(w.surfaceOnly, true); assert.equal(w.rotationX, -Math.PI / 2); assert.equal(w.rotationY, 0);
    assert.deepEqual(w.openings, []);
    for (const other of surfaces.slice(i + 1)) if (w.originMm[1] === other.originMm[1]) assert.equal(intersect(rect(w), rect(other)), null);
  });
  for (const floorId of ['f1', 'f2', 'f3']) {
    const f = wall(`${floorId}-porch-floor`), back = wall(`${floorId}-porch-back`), side = wall(`${floorId}-porch-left`);
    close(f.originMm[2] - f.heightMm, back.originMm[2]);
    close(f.originMm[2], side.originMm[2]);
    if (floorId === 'f2') close(f.widthMm + wall('f2-porch-floor-side').widthMm, back.widthMm - (wall('f2-right').thicknessMm - 60));
    else if (floorId === 'f3') close(f.widthMm + wall('f3-porch-floor-side').widthMm, back.widthMm);
    else close(f.widthMm, back.widthMm - 200);
  }
  close(wall('f4-terrace-floor').originMm[2] - wall('f4-terrace-floor').heightMm, wall('f4-covered-terrace-floor').originMm[2]);
  close(wall('f4-roof-floor').originMm[1], bounds(part('roof-slab'))[1][1]);
});

test('seven parapet inner surfaces face into the outdoor floors without duplicating masonry', () => {
  const inner = buildingConfig.walls.filter(w => w.surfaceKind === 'inner-wall' && /^(roof|terrace)-/.test(w.id));
  assert.equal(inner.length, 7);
  for (const w of inner) {
    const outer = wall(w.id.replace(/-inner$/, ''));
    assert.equal(w.surfaceOnly, true); assert.deepEqual(w.openings, []);
    close(w.heightMm, outer.heightMm);
    close(Math.cos(w.rotationY) + Math.cos(outer.rotationY), 0);
    close(Math.sin(w.rotationY) + Math.sin(outer.rotationY), 0);
    const delta = [w.originMm[0] - outer.originMm[0], w.originMm[2] - outer.originMm[2]];
    close(Math.abs(delta[0] * Math.sin(outer.rotationY) + delta[1] * Math.cos(outer.rotationY)), outer.thicknessMm);
  }
  assert.equal(buildingConfig.walls.some(w => w.id === 'roof-fascia-inner'), false);
  assert.equal(buildingConfig.scene.floorJointMm, 20);
  assert.deepEqual(buildingConfig.materials.filter(m => m.kind !== 'paint').map(m => m.pricePerM2), [120, 180, 80, 100]);
});

test('fourth-floor recessed west wall and east glass wall join through a 2200 mm return', () => {
  const west = wall('f4-front'), east = wall('f4-front-east'), side = wall('f4-terrace-return');
  close(east.originMm[2] - west.originMm[2], 2200);
  close(side.widthMm, 2200);
  samePoint(endpoint(west), side.originMm);
  samePoint(endpoint(side), east.originMm);
  close(west.widthMm + east.widthMm + wall('f4-left').thicknessMm + 60, buildingConfig.floors.find(f => f.id === 'f4').footprintMm.width);
});

test('slabs do not duplicate another slab with coincident top and bottom surfaces', () => {
  const slabs = buildingConfig.parts.filter(p => p.kind === 'slab');
  slabs.forEach((p, i) => {
    const a = bounds(p);
    for (const q of slabs.slice(i + 1)) {
      const b = bounds(q);
      if (a[1][0] !== b[1][0] || a[1][1] !== b[1][1]) continue;
      const overlap = Math.min(a[0][1], b[0][1]) > Math.max(a[0][0], b[0][0]) && Math.min(a[2][1], b[2][1]) > Math.max(a[2][0], b[2][0]);
      assert.equal(overlap, false, `${p.id} and ${q.id} have coincident slab surfaces`);
    }
  });
});
