import test from 'node:test';
import assert from 'node:assert/strict';
import { outlineSegments } from '../src/renovation3d/utils/outline.ts';

const rect = { x: 0, y: 0, width: 1000, height: 800 };
const length = segments => segments.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
test('a selected rectangle has only its four outside edges', () => {
  const segments = outlineSegments(rect);
  assert.equal(segments.length, 4); assert.equal(length(segments), 3600);
});
test('an interior opening adds its perimeter without cut-fragment edges', () => {
  const segments = outlineSegments(rect, [{ x: 200, y: 200, width: 300, height: 400 }]);
  assert.equal(segments.length, 8); assert.equal(length(segments), 5000);
});
test('a door touching the floor does not get a line across its open bottom', () => {
  const segments = outlineSegments(rect, [{ x: 200, y: 0, width: 300, height: 600 }]);
  assert.equal(segments.length, 8); assert.equal(length(segments), 4800);
  const bottom = segments.filter(([a, b]) => a[1] === 0 && b[1] === 0);
  assert.deepEqual(bottom, [[[0, 0], [200, 0]], [[500, 0], [1000, 0]]]);
});
test('overlapping openings trace their union without internal edges', () => {
  const segments = outlineSegments(rect, [{ x: 200, y: 200, width: 400, height: 400 }, { x: 400, y: 200, width: 400, height: 400 }]);
  assert.equal(segments.length, 8); assert.equal(length(segments), 5600);
  assert.ok(!segments.some(([a, b]) => a[0] === b[0] && [400, 600].includes(a[0])));
});
test('clipping an opening beyond a side omits the opened outside edge', () => {
  const segments = outlineSegments(rect, [{ x: 800, y: 200, width: 500, height: 400 }]);
  assert.equal(segments.length, 8); assert.equal(length(segments), 4000);
  assert.ok(!segments.some(([a, b]) => a[0] === 1000 && b[0] === 1000 && a[1] < 600 && b[1] > 200));
});
test('a fully removed rectangle has no highlight edges', () => {
  assert.deepEqual(outlineSegments(rect, [{ x: -10, y: -10, width: 1200, height: 1000 }]), []);
});
