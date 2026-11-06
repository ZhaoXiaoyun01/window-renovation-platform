import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTiles, clipHoles, intersect, area, tileDimensions } from '../src/renovation3d/tile-layout/layout.ts';
import { buildingConfig } from '../src/renovation3d/config/building-config.ts';

const settings = { widthMm: 600, heightMm: 1200, direction: 'horizontal', groutMm: 0, groutColor: '#777777', alignment: 'edge' };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
test('real size creates four tiles on a 2400 × 1200 wall', () => {
  const l = layoutTiles(2400, 1200, [], settings);
  assert.equal(l.sourceTiles, 4); assert.equal(l.cutTiles, 0);
  assert.ok(l.pieces.every(p => p.width === 1200 && p.height === 600));
  close(l.tileAreaMm2, 2400 * 1200);
});
test('edge pieces keep the original tile UV rather than stretch the whole image', () => {
  const l = layoutTiles(1500, 700, [], settings);
  const corner = l.pieces.find(p => p.x === 1200 && p.y === 600);
  assert.equal(corner.width, 300); assert.equal(corner.height, 100);
  assert.deepEqual(corner.uv, [0, 0, 0.25, 1 / 6]); assert.equal(l.cutTiles, 3);
});
test('hole splits one tile into disjoint pieces and preserves net area', () => {
  const hole = { x: 250, y: 150, width: 350, height: 250 };
  const l = layoutTiles(1200, 600, [hole], settings);
  assert.equal(l.sourceTiles, 1); assert.equal(l.pieces.length, 4);
  close(l.tileAreaMm2, 1200 * 600 - area(hole));
  l.pieces.forEach((p, i) => { assert.equal(intersect(p, hole), null); l.pieces.slice(i + 1).forEach(q => assert.equal(intersect(p, q), null)); });
});
test('overlapping and edge-touching holes are subtracted as a union', () => {
  const pieces = clipHoles({ x: 0, y: 0, width: 1000, height: 1000 }, [{ x: 0, y: 0, width: 500, height: 500 }, { x: 250, y: 250, width: 500, height: 500 }]);
  close(pieces.reduce((s, p) => s + area(p), 0), 562500);
});
test('direction changes physical grid, with grout occupying real gaps', () => {
  const h = layoutTiles(2400, 1800, [], { ...settings, groutMm: 5 });
  const v = layoutTiles(2400, 1800, [], { ...settings, groutMm: 5, direction: 'vertical' });
  assert.equal(h.pieces[0].width, 1200); assert.equal(v.pieces[0].width, 600);
  assert.equal(h.pieces[1].x - h.pieces[0].width, 5);
  assert.ok(h.tileAreaMm2 < h.netAreaMm2);
});
test('center alignment produces equal edge cuts', () => {
  const l = layoutTiles(2100, 600, [], { ...settings, alignment: 'center' });
  assert.equal(l.pieces[0].width, 1050); assert.equal(l.pieces[1].width, 1050);
});
test('invalid sizes, holes and excessive grid counts are rejected', () => {
  for (const widthMm of [0, -1, NaN, Infinity, 19]) assert.throws(() => layoutTiles(1000, 1000, [], { ...settings, widthMm }));
  assert.throws(() => layoutTiles(1000, 1000, [], { ...settings, groutMm: -1 }));
  assert.throws(() => layoutTiles(1000, 1000, [{ x: 900, y: 0, width: 200, height: 100 }], settings));
  assert.throws(() => layoutTiles(13000, 3800, [], { ...settings, widthMm: 50, heightMm: 50 }, 6000));
});
test('45mm facade tiles retain their physical length and width through live size and direction changes', () => {
  for (const [widthMm, heightMm] of [[45, 95], [1200, 450], [300, 900]]) for (const direction of ['horizontal', 'vertical']) {
    const finish = { ...settings, widthMm, heightMm, direction, groutMm: 3 };
    const dimensions = tileDimensions(finish), layout = layoutTiles(2400, 1200, [], finish);
    assert.deepEqual(dimensions, direction === 'horizontal' ? { width: Math.max(widthMm, heightMm), height: Math.min(widthMm, heightMm) } : { width: Math.min(widthMm, heightMm), height: Math.max(widthMm, heightMm) });
    for (const piece of layout.pieces) {
      close((piece.uv[2] - piece.uv[0]) * dimensions.width, piece.width);
      close((piece.uv[3] - piece.uv[1]) * dimensions.height, piece.height);
    }
    assert.equal(layout.pieces[0].width, dimensions.width);
    assert.equal(layout.pieces[0].height, dimensions.height);
  }
});
test('every building wall and opening is valid, and tiled areas never overlap openings', () => {
  assert.equal(new Set(buildingConfig.walls.map(w => w.id)).size, buildingConfig.walls.length);
  for (const wall of buildingConfig.walls) {
    assert.ok(buildingConfig.floors.some(f => f.id === wall.floorId));
    for (const direction of ['horizontal', 'vertical']) {
      const l = layoutTiles(wall.widthMm, wall.heightMm, wall.openings, { ...buildingConfig.defaultTile, direction });
      assert.ok(l.tileAreaMm2 <= l.netAreaMm2);
      for (const p of l.pieces) for (const hole of wall.openings) assert.equal(intersect(p, hole), null);
      close(l.netAreaMm2, wall.widthMm * wall.heightMm - wall.openings.reduce((s, p) => s + area(p), 0));
    }
  }
});
test('sizes from drawing elevations and terrace configuration stay separate from window project schemas', () => {
  assert.deepEqual(buildingConfig.floors.map(f => f.elevationMm), [0, 3800, 7100, 10400]);
  assert.equal(buildingConfig.unit, 'mm'); assert.equal(buildingConfig.floors[3].footprintMm.depth, 6700);
  assert.equal('documents' in buildingConfig, false); assert.equal('reviewed_documents' in buildingConfig, false);
});
