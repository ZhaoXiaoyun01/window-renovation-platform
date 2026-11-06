import test from 'node:test';
import assert from 'node:assert/strict';
import { area, intersect, layoutTiles } from '../src/renovation3d/tile-layout/layout.ts';
import { wallSurfaces } from '../src/renovation3d/utils/wall-surfaces.ts';

const settings = { widthMm: 600, heightMm: 1200, direction: 'horizontal', groutMm: 3, groutColor: '#777777', alignment: 'edge' };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const zone = (x, y, width, height, offsetMm = 0) => ({ x, y, width, height, offsetMm, materialId: offsetMm ? 'basalt' : 'ivory' });
const wall = (widthMm, heightMm, finishZones, openings = []) => ({
  id: 'surface-test', floorId: 'f1', facade: 'front', originMm: [0, 0, 0], rotationY: 0,
  widthMm, heightMm, thicknessMm: 200, evidence: { page: 5, status: 'pending', note: 'test fixture' }, openings, finishZones,
});
const partitionedWall = () => wall(2500, 1100, [zone(0, 0, 800, 1100), zone(800, 0, 1700, 600, 60), zone(800, 600, 1700, 500)]);
const disjoint = pieces => pieces.forEach((p, i) => pieces.slice(i + 1).forEach(q => assert.equal(intersect(p, q), null)));

test('splitting physical tiles across colour zones conserves area without overlapping fragments', () => {
  const w = partitionedWall(), layout = layoutTiles(w.widthMm, w.heightMm, [], settings);
  const surfaces = wallSurfaces(w, layout), pieces = surfaces.flatMap(s => s.pieces);
  assert.ok(pieces.length > layout.pieces.length);
  close(pieces.reduce((sum, p) => sum + area(p), 0), layout.tileAreaMm2);
  for (const source of layout.pieces) {
    close(pieces.filter(p => p.sourceTileId === source.sourceTileId).reduce((sum, p) => sum + area(p), 0), area(source));
  }
  disjoint(pieces);
});

test('a tile crossing a relief boundary retains continuous UVs instead of stretching each zone', () => {
  const w = wall(1200, 600, [zone(0, 0, 450, 600), zone(450, 0, 750, 600, 60)]);
  const layout = layoutTiles(w.widthMm, w.heightMm, [], { ...settings, groutMm: 0 });
  const [left, right] = wallSurfaces(w, layout).flatMap(s => s.pieces);
  assert.deepEqual(left.uv, [0, 0, 0.375, 1]);
  assert.deepEqual(right.uv, [0.375, 0, 1, 1]);
  close(left.uv[2], right.uv[0]);
  for (const piece of [left, right]) {
    close((piece.uv[2] - piece.uv[0]) / piece.width, 1 / 1200);
    close((piece.uv[3] - piece.uv[1]) / piece.height, 1 / 600);
    assert.equal(piece.sourceTileId, '0:0');
  }
  const centred = partitionedWall();
  const centredLayout = layoutTiles(centred.widthMm, centred.heightMm, [], { ...settings, alignment: 'center' });
  const originX = (2500 - (3 * 1203 - 3)) / 2, originY = (1100 - (2 * 603 - 3)) / 2;
  for (const piece of wallSurfaces(centred, centredLayout).flatMap(s => s.pieces)) {
    close(piece.uv[0], (piece.x - (originX + piece.col * 1203)) / 1200);
    close(piece.uv[1], (piece.y - (originY + piece.row * 603)) / 600);
    close(piece.uv[2] - piece.uv[0], piece.width / 1200);
    close(piece.uv[3] - piece.uv[1], piece.height / 600);
  }
});

test('colour zones leave openings empty in both wall solids and tile fragments', () => {
  const w = partitionedWall();
  w.openings = [{ x: 650, y: 250, width: 600, height: 500 }];
  const layout = layoutTiles(w.widthMm, w.heightMm, w.openings, settings);
  const surfaces = wallSurfaces(w, layout), pieces = surfaces.flatMap(s => s.pieces), solids = surfaces.flatMap(s => s.solids);
  for (const p of [...pieces, ...solids]) assert.equal(intersect(p, w.openings[0]), null);
  close(pieces.reduce((sum, p) => sum + area(p), 0), layout.tileAreaMm2);
  close(solids.reduce((sum, p) => sum + area(p), 0), w.widthMm * w.heightMm - area(w.openings[0]));
  disjoint(pieces); disjoint(solids);
});

test('changing relief depth keeps one shared real-size grid and its source row and column IDs', () => {
  const w = wall(2400, 1200, [zone(0, 0, 800, 1200), zone(800, 0, 1600, 1200, 60)]);
  const layout = layoutTiles(w.widthMm, w.heightMm, [], settings);
  const raised = wallSurfaces(w, layout).flatMap(s => s.pieces);
  const flat = wallSurfaces({ ...w, finishZones: w.finishZones.map(z => ({ ...z, offsetMm: 0 })) }, layout).flatMap(s => s.pieces);
  assert.deepEqual(raised, flat);
  const crossing = raised.filter(p => p.sourceTileId === '0:0');
  assert.equal(crossing.length, 2);
  assert.ok(crossing.every(p => p.row === 0 && p.col === 0));
  assert.equal(new Set(raised.map(p => p.sourceTileId)).size, layout.sourceTiles);
  for (const piece of raised) {
    const source = layout.pieces.find(p => p.sourceTileId === piece.sourceTileId);
    assert.equal(piece.row, source.row); assert.equal(piece.col, source.col);
  }
});
