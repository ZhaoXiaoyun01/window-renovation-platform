import { buildingFacesAtRevision7 } from '../src/renovation3d/utils/wall-surfaces.ts';
import { validateRevision7State } from '../src/renovation3d/utils/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { area, intersect, layoutTiles } from '../src/renovation3d/tile-layout/layout.ts';
import { outlineSegments, rectUnion } from '../src/renovation3d/utils/outline.ts';
import { buildingFaces, wallFaces, faceSolids, faceMetrics, faceTileLayout, faceGridWall, resolveFaceFinish, baseBuildingFaces } from '../src/renovation3d/utils/wall-surfaces.ts';
import { buildingConfig } from '../src/renovation3d/config/building-config.ts';

const settings = { widthMm: 600, heightMm: 1200, direction: 'horizontal', groutMm: 0, groutColor: '#777777', alignment: 'edge' };
const zone = (x, y, width, height, offsetMm = 0, materialId = 'ivory') => ({ x, y, width, height, offsetMm, materialId });
const wall = (widthMm, heightMm, finishZones, openings = []) => ({ id: 'faces-test', floorId: 'f1', facade: 'front', originMm: [0, 0, 0], rotationY: 0,
  widthMm, heightMm, thicknessMm: 200, evidence: { page: 5, status: 'pending', note: 'fixture' }, openings, finishZones });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const length = segments => segments.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
const disjoint = rects => rects.forEach((r, i) => rects.slice(i + 1).forEach(s => assert.equal(intersect(r, s), null)));

test('same wall depth merges source colour zones and has stable IDs after zone reordering', () => {
  const w = wall(2400, 1200, [zone(0, 0, 600, 1200), zone(600, 0, 600, 1200, 0, 'sand'), zone(1200, 0, 1200, 1200, -60, 'basalt')]);
  const faces = wallFaces(w);
  assert.equal(faces.length, 2); assert.equal(faces.find(f => f.offsetMm === 0).zones.length, 2);
  assert.deepEqual(wallFaces({ ...w, finishZones: [...w.finishZones].reverse() }).map(f => f.id), faces.map(f => f.id));
  assert.deepEqual(buildingFaces([w]).map(f => f.id), faces.map(f => f.id));
});

test('overlapping and adjacent source rectangles produce no duplicate or internal shared edges', () => {
  const rects = [zone(0, 0, 700, 800), zone(300, 0, 700, 800), zone(1000, 0, 200, 800), zone(0, 0, 700, 800)];
  const solids = rectUnion(rects), outline = outlineSegments(rects);
  assert.equal(outline.length, 4); assert.equal(length(outline), 4000);
  assert.equal(solids.reduce((sum, r) => sum + area(r), 0), 960000); disjoint(solids);
});

test('a concave union preserves its notch, clips openings to the face and reports real perimeter', () => {
  const w = wall(1200, 1000, [zone(0, 0, 600, 1000), zone(600, 500, 600, 500)], [{ x: 400, y: 200, width: 400, height: 200 }]);
  const [face] = wallFaces(w), metrics = faceMetrics(face), solids = faceSolids(face);
  assert.deepEqual(face.holes, [{ x: 400, y: 200, width: 200, height: 200 }]);
  assert.equal(metrics.widthMm, 1200); assert.equal(metrics.heightMm, 1000);
  assert.equal(metrics.grossAreaMm2, 900000); assert.equal(metrics.netAreaMm2, 860000);
  assert.equal(metrics.grossPerimeterMm, 4400); assert.equal(metrics.outerPerimeterMm, 4200); assert.equal(metrics.openingPerimeterMm, 600);
  close(length(outlineSegments(face.rects, face.holes)), 4800); disjoint(solids);
  for (const s of solids) assert.equal(intersect(s, w.openings[0]), null);
});

test('door thresholds remain open and are excluded from opening perimeter', () => {
  const [face] = wallFaces(wall(1000, 800, [zone(0, 0, 1000, 800)], [{ x: 200, y: 0, width: 300, height: 600 }]));
  const metrics = faceMetrics(face);
  assert.equal(metrics.grossPerimeterMm, 3600); assert.equal(metrics.outerPerimeterMm, 3300); assert.equal(metrics.openingPerimeterMm, 1500);
  assert.deepEqual(outlineSegments(face.rects, face.holes).filter(([a, b]) => a[1] === 0 && b[1] === 0), [[[0, 0], [200, 0]], [[500, 0], [1000, 0]]]);
});

test('a cap above a full-width window uses its visible 800 by 600 envelope and has no opening', () => {
  const w = wall(800, 1800, [{ ...zone(0, 0, 800, 1800, -60), faceKey: 'cap' }], [{ x: 0, y: 0, width: 800, height: 1200 }]);
  const [face] = wallFaces(w), metrics = faceMetrics(face);
  assert.deepEqual(metrics.boundsMm, { x: 0, y: 1200, width: 800, height: 600 });
  assert.equal(metrics.grossAreaMm2, 480000); assert.equal(metrics.netAreaMm2, 480000);
  assert.equal(metrics.grossPerimeterMm, 2800); assert.equal(metrics.outerPerimeterMm, 2800); assert.equal(metrics.openingPerimeterMm, 0);
  assert.equal(face.gridBoundsMm.height, 1800, 'measurement must not change the original tile phase');
});

test('configured west stair caps report real sizes after their lower windows are removed', () => {
  const faces = buildingFaces(buildingConfig.walls);
  for (const floorId of ['f2', 'f3']) {
    const face = faces.find(f => f.floorId === floorId && f.faceKey === 'west-stair-cap');
    assert.ok(face);
    const metrics = faceMetrics(face);
    assert.equal(metrics.widthMm, 800); assert.equal(metrics.heightMm, 600);
    assert.equal(metrics.netAreaMm2, 480000); assert.equal(metrics.outerPerimeterMm, 2800); assert.equal(metrics.openingPerimeterMm, 0);
  }
});

test('a completely removed face has no envelope, area or perimeter', () => {
  const [face] = wallFaces(wall(1000, 800, [zone(0, 0, 1000, 800)], [{ x: 0, y: 0, width: 1000, height: 800 }]));
  const metrics = faceMetrics(face);
  assert.deepEqual(metrics.boundsMm, { x: 0, y: 0, width: 0, height: 0 });
  for (const key of ['grossAreaMm2', 'netAreaMm2', 'grossPerimeterMm', 'outerPerimeterMm', 'openingPerimeterMm']) assert.equal(metrics[key], 0);
});

test('face tile layout retains wall phases, real UV ratios and correct net area through a notch and hole', () => {
  const w = wall(2500, 1100, [zone(0, 0, 800, 1100), zone(800, 600, 1700, 500), zone(800, 0, 1700, 600, -60)], [{ x: 300, y: 100, width: 350, height: 500 }]);
  for (const face of wallFaces(w)) for (const direction of ['horizontal', 'vertical']) {
    const finish = { ...settings, groutMm: 3, direction, alignment: 'center' }, layout = faceTileLayout(face, w, finish);
    const tw = direction === 'horizontal' ? 1200 : 600, th = direction === 'horizontal' ? 600 : 1200;
    const px = tw + 3, py = th + 3, ox = (2500 - (Math.ceil(2503 / px) * px - 3)) / 2, oy = (1100 - (Math.ceil(1103 / py) * py - 3)) / 2;
    close(layout.netAreaMm2, faceMetrics(face).netAreaMm2); assert.ok(layout.tileAreaMm2 <= layout.netAreaMm2); disjoint(layout.pieces);
    for (const p of layout.pieces) {
      for (const hole of face.holes) assert.equal(intersect(p, hole), null);
      close(p.uv[0], (p.x - ox - p.col * px) / tw); close(p.uv[1], (p.y - oy - p.row * py) / th);
      close(p.uv[2] - p.uv[0], p.width / tw); close(p.uv[3] - p.uv[1], p.height / th);
    }
    assert.equal(layout.sourceTiles, new Set(layout.pieces.map(p => p.sourceTileId)).size);
    assert.equal(layout.cutTiles, new Set(layout.pieces.filter(p => p.cut).map(p => p.sourceTileId)).size);
  }
});

test('a full-wall face preserves previous tile layout statistics without internal zone cuts', () => {
  const w = wall(2400, 1200, [zone(0, 0, 450, 1200), zone(450, 0, 1950, 1200)]), [face] = wallFaces(w);
  const layout = faceTileLayout(face, w, settings), previous = layoutTiles(w.widthMm, w.heightMm, [], settings);
  assert.deepEqual(layout, previous); assert.equal(layout.cutTiles, 0);
});

test('cell limit applies only to tiles touching the face instead of the whole wall', () => {
  const w = wall(12000, 12000, [zone(11900, 11900, 100, 100)]), [face] = wallFaces(w);
  const tiny = { ...settings, widthMm: 50, heightMm: 50 };
  const layout = faceTileLayout(face, w, tiny, 4);
  assert.equal(layout.sourceTiles, 4); assert.equal(layout.cutTiles, 0); assert.equal(layout.tileAreaMm2, 10000);
  assert.throws(() => faceTileLayout(face, w, tiny, 3), /过多砖格/);
});

test('face finish overrides inherit legacy settings and preserve another face untouched', () => {
  const w = wall(1200, 600, [zone(0, 0, 600, 600), zone(600, 0, 600, 600, -60, 'basalt')]), faces = wallFaces(w);
  const state = { finishes: { [w.id]: { ...settings, materialId: 'ivory', preserveZoning: true } } };
  const grey = faces.find(f => f.offsetMm === -60), white = faces.find(f => f.offsetMm === 0);
  assert.equal(resolveFaceFinish(grey, state).materialId, 'basalt'); assert.equal(resolveFaceFinish(white, state).materialId, 'ivory');
  const changed = { ...settings, materialId: 'sand', widthMm: 800, preserveZoning: false };
  const withOverride = { ...state, faceFinishes: { [grey.id]: changed } };
  assert.equal(resolveFaceFinish(grey, withOverride), changed); assert.deepEqual(resolveFaceFinish(white, withOverride), resolveFaceFinish(white, state));
  assert.equal(state.finishes[w.id].materialId, 'ivory');
});

test('coplanar rotated walls merge at the actual world plane even when their base offsets differ', () => {
  const a = { ...wall(600, 800, [zone(0, 0, 600, 800)]), id: 'a-wall', originMm: [-200, 0, 100], rotationY: -Math.PI / 2, facade: 'left' };
  const b = { ...wall(600, 400, [zone(0, 0, 600, 400, 60, 'sand')], [{ x: 100, y: 100, width: 200, height: 200 }]),
    id: 'b-wall', originMm: [-140, 800, 400], rotationY: -Math.PI / 2, facade: 'left' };
  const faces = buildingFaces([b, a]), [face] = faces, metrics = faceMetrics(face);
  assert.equal(faces.length, 1); assert.equal(face.id, 'a-wall:face:0'); assert.deepEqual(face.originMm, [-200, 0, 100]);
  assert.deepEqual(face.sourceWallIds, ['a-wall', 'b-wall']); assert.deepEqual(face.members[1].shiftMm, [300, 800]);
  assert.equal(face.members[1].offsetMm, 60); assert.equal(face.zones[1].offsetMm, 0);
  assert.equal(metrics.grossAreaMm2, 720000); assert.equal(metrics.netAreaMm2, 680000);
  assert.equal(metrics.grossPerimeterMm, 4200); assert.equal(metrics.openingPerimeterMm, 800);
  assert.ok(!outlineSegments(face.rects, face.holes).some(([p, q]) => p[1] === 800 && q[1] === 800 && p[0] < 600 && q[0] > 300));
  const grid = faceGridWall(face, [a, b]); assert.equal(grid.widthMm, 900); assert.equal(grid.heightMm, 1200);
  close(faceTileLayout(face, grid, settings).tileAreaMm2, metrics.netAreaMm2);
  assert.deepEqual(buildingFaces([a, b])[0], face);
  assert.equal(buildingFaces([a, { ...b, floorId: 'f2' }]).length, 2);
  assert.equal(buildingFaces([a, { ...b, finishZones: [zone(0, 0, 600, 400, 0)] }]).length, 2);
});

test('overlapping source walls union their actual solids instead of propagating one member hole through another', () => {
  const a = { ...wall(1000, 800, [zone(0, 0, 1000, 800)], [{ x: 400, y: 200, width: 200, height: 200 }]), id: 'a' };
  const b = { ...wall(200, 200, [zone(0, 0, 200, 200)]), id: 'b', originMm: [400, 200, 0] };
  const [face] = buildingFaces([a, b]);
  assert.equal(faceMetrics(face).netAreaMm2, 800000); assert.deepEqual(face.holes, []);
  assert.equal(outlineSegments(face.rects, face.holes).length, 4); disjoint(faceSolids(face));
});

test('historical revision7: configured coplanar roof and terrace walls have one face and preserve total modeled net area', () => {
  const faces = buildingFacesAtRevision7(), singleWallFaces = baseBuildingFaces(buildingConfig.walls);
  const roof = faces.find(f => f.sourceWallIds.includes('roof-fascia'));
  assert.equal(roof.sourceWallIds.includes('roof-front'), false);
  assert.equal(faces.filter(f => f.sourceWallIds.includes('roof-fascia') || f.sourceWallIds.includes('roof-front')).length, 2);
  const left = faces.find(f => f.sourceWallIds.includes('f4-left') && f.offsetMm === 0);
  assert.deepEqual(left.sourceWallIds, ['f4-left']);
  assert.ok(faces.some(f => f.sourceWallIds.includes('roof-side--1') && f.id !== left.id));
  const terrace = faces.find(f => f.sourceWallIds.includes('terrace-side--1'));
  assert.deepEqual(terrace.sourceWallIds, ['terrace-side--1']);
  assert.equal(terrace.viewGroup, 'terrace');
  assert.notEqual(terrace.id, left.id);
  assert.ok(faces.reduce((sum, f) => sum + faceMetrics(f).netAreaMm2, 0) < singleWallFaces.reduce((sum, f) => sum + faceMetrics(f).netAreaMm2, 0));
  for (const face of faces) {
    assert.ok(face.rects.every(r => r.x >= 0 && r.y >= 0));
    const layout = faceTileLayout(face, faceGridWall(face, buildingConfig.walls), buildingConfig.defaultTile);
    close(layout.netAreaMm2, faceMetrics(face).netAreaMm2); assert.ok(layout.tileAreaMm2 <= layout.netAreaMm2);
    disjoint(layout.pieces);
  }
});

test('disconnected terrace and roof inner walls have separate outlines and areas', () => {
  const faces = buildingFaces(buildingConfig.walls);
  for (const sign of [-1, 1]) {
    const roofId = `roof-side-${sign}-inner`, terraceId = `terrace-side-${sign}-inner`;
    const roof = faces.find(f => f.sourceWallIds.includes(roofId)), terrace = faces.find(f => f.sourceWallIds.includes(terraceId));
    assert.notEqual(roof.id, terrace.id);
    assert.deepEqual(roof.sourceWallIds, [roofId]); assert.deepEqual(terrace.sourceWallIds, [terraceId]);
    assert.equal(outlineSegments(roof.rects, roof.holes).length, 4);
    assert.equal(outlineSegments(terrace.rects, terrace.holes).length, 4);
  }
});
