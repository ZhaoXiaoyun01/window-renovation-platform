import test from 'node:test';
import assert from 'node:assert/strict';
import { isSelectionClick, moveSelectionGesture } from '../src/renovation3d/utils/selection-click.ts';

const down = { x: 100, y: 200, startedAt: 1000, pointerId: 1, moved: false, button: 0 };
test('only a short stationary left click changes the selection', () => {
  assert.equal(isSelectionClick(moveSelectionGesture(down, 102, 202), 1100), true);
  assert.equal(isSelectionClick(down, 1400), false);
  assert.equal(isSelectionClick({ ...down, button: 2 }, 1100), false);
});
test('orbit movement remains a drag even when it returns to its starting point', () => {
  const moved = moveSelectionGesture(down, 120, 200);
  assert.equal(isSelectionClick(moveSelectionGesture(moved, 100, 200), 1100), false);
});
