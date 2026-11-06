import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig } from '../src/renovation3d/config/building-config.ts';
import { glassPresets, windowDesigns, windowDesignFor, windowEvidence } from '../src/renovation3d/config/window-config.ts';
import { defaultWindowFinish, resolveWindowFinish, validateWindowFinish, windowGeometry } from '../src/renovation3d/utils/window-finishes.ts';
import { intersect } from '../src/renovation3d/tile-layout/layout.ts';

const windows = buildingConfig.walls.flatMap(wall => wall.openings).filter(opening => opening.kind === 'window');
const opening = id => windows.find(window => window.id === id);
test('reference window grids cover existing PDF openings without changing total dimensions', () => {
  for (const window of windows) {
    assert.ok(windowDesigns[window.id], `missing reference for ${window.id}`);
    const before = JSON.stringify(window), geometry = windowGeometry(window);
    assert.ok(geometry.panes.length > 0); assert.equal(JSON.stringify(window), before);
    for (const pane of geometry.panes) {
      assert.ok(pane.width > 0 && pane.height > 0 && pane.x >= 0 && pane.y >= 0);
      assert.ok(pane.x + pane.width <= window.width + 1e-6 && pane.y + pane.height <= window.height + 1e-6);
      for (const frame of geometry.frames) assert.equal(intersect(pane, frame), null);
    }
    geometry.panes.forEach((pane, i) => geometry.panes.slice(i + 1).forEach(other => assert.equal(intersect(pane, other), null)));
  }
});
test('front large fixed pane is not crossed by the small opening sash transom', () => {
  const geometry = windowGeometry(opening('f3-s-window'));
  assert.equal(geometry.panes.filter(p => p.column === 0).length, 2);
  const large = geometry.panes.filter(p => p.column === 1);
  assert.equal(large.length, 1); assert.equal(large[0].operable, false);
  const active = geometry.panes.find(p => p.operable);
  assert.equal(active.column, 0); assert.equal(active.row, 0);
  assert.equal(windowGeometry(opening('f1-s-window')).panes.find(p => p.operable).row, 1);
});
test('top-hung and unconfirmed fixed forms retain their distinct evidence and configuration', () => {
  assert.equal(windowDesignFor(opening('f2-e-narrow')).mode, 'top-hung');
  assert.equal(windowEvidence['f2-e-narrow'].symbol, 'top');
  assert.equal(windowEvidence['f1-n-window'].status, 'pending');
  const custom = { ...opening('f2-s-window'), design: { mode: 'fixed', columns: [1], note: 'explicit override' } };
  assert.equal(windowDesignFor(custom), custom.design); assert.equal(windowGeometry(custom).panes.length, 1);
});
test('window finish overrides stay independent from other windows and wall finishes', () => {
  const state = { finishes: { wall: { materialId: 'ivory' } }, windowFinishes: { 'f2-s-window': { frameColor: '#b7a48c', glassType: 'low' } } };
  const before = JSON.stringify(state);
  assert.deepEqual(resolveWindowFinish(opening('f2-s-window'), state), { ...defaultWindowFinish(), ...state.windowFinishes['f2-s-window'] });
  assert.deepEqual(resolveWindowFinish(opening('f3-s-window'), state), defaultWindowFinish());
  assert.equal(JSON.stringify(state), before);
});
test('invalid glass presets and frame colours are rejected without mutating the supplied finish', () => {
  const finish = { frameColor: '#A6AAA5', glassType: 'high' }, checked = validateWindowFinish(finish);
  assert.deepEqual(checked, finish); assert.notEqual(checked, finish);
  for (const value of [null, {}, { frameColor: '#fff', glassType: 'high' }, { frameColor: '#ffffff', glassType: 'opaque' }]) assert.throws(() => validateWindowFinish(value));
});
test('Low-E visual presets get brighter and more transparent from low to high without claiming VLT', () => {
  const brightness = preset => {
    const rgb = [1, 3, 5].map(index => parseInt(preset.color.slice(index, index + 2), 16));
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) * preset.opacity;
  };
  assert.ok(brightness(glassPresets.low) < brightness(glassPresets.medium));
  assert.ok(brightness(glassPresets.medium) < brightness(glassPresets.high));
  assert.ok(glassPresets.low.opacity > glassPresets.medium.opacity && glassPresets.medium.opacity > glassPresets.high.opacity);
  assert.ok(Object.values(glassPresets).every(preset => !('vlt' in preset)));
});
