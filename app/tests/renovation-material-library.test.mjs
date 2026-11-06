import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingConfig as config } from '../src/renovation3d/config/building-config.ts';
import { materialDraft, importTileStyle, materialPrice, sameMaterial } from '../src/renovation3d/utils/finish-actions.ts';

const fresh = () => ({ schemaVersion: 1, buildingId: config.id, materials: structuredClone(config.materials), hiddenFloors: [], exploded: false,
  finishes: Object.fromEntries(config.walls.map(w => [w.id, { ...config.defaultTile, materialId: w.finishZones[0].materialId, preserveZoning: true }])) });
test('editing a preset price or colour creates a copy, preserving the preset and every other reference', () => {
  const initial = fresh(), original = structuredClone(initial), presets = structuredClone(config.materials);
  const edited = materialDraft(initial, 'ivory', '#123456', 22.5), id = edited.finish.materialId;
  assert.notEqual(id, 'ivory'); assert.equal(edited.state.materials.find(m => m.id === id).pricePerM2, 22.5);
  assert.equal(edited.state.materials.find(m => m.id === 'ivory').pricePerM2, 120);
  assert.deepEqual(edited.state.finishes, initial.finishes); assert.deepEqual(initial, original); assert.deepEqual(config.materials, presets);
  assert.equal(materialDraft(edited.state, 'ivory', '#123456', 22.5).finish.materialId, id);
});
test('selecting a canonical preset from an old altered plan does not overwrite the old sample or its price', () => {
  const initial = fresh(); initial.materials.find(m => m.id === 'ivory').pricePerM2 = 22.5;
  const original = structuredClone(initial), preset = config.materials.find(m => m.id === 'ivory');
  const imported = importTileStyle(initial, { material: preset, finish: { ...config.defaultTile, materialId: preset.id } });
  assert.equal(materialPrice(imported.state.materials.find(m => m.id === imported.finish.materialId)), 120);
  assert.equal(materialPrice(imported.state.materials.find(m => m.id === 'ivory')), 22.5);
  assert.deepEqual(initial, original);
});
test('custom styles preserve uploaded image, dimensions, price and layout when imported into a fresh plan', () => {
  const material = { id: 'uploaded-test', name: '定制砖', color: '#ffffff', texture: 'custom', image: 'data:image/jpeg;base64,AA==', pricePerM2: 48 };
  const finish = { ...config.defaultTile, materialId: material.id, widthMm: 450, heightMm: 900, groutMm: 2, groutColor: '#112233', direction: 'vertical', alignment: 'center' };
  const imported = importTileStyle(fresh(), { material, finish }), saved = imported.state.materials.find(m => m.id === imported.finish.materialId);
  assert.deepEqual(saved, material); assert.deepEqual(imported.finish, { ...finish, preserveZoning: false });
  assert.equal(sameMaterial(saved, config.materials[0]), false);
});

test('a named custom revision keeps its identity even when its visual material matches a preset', () => {
  const initial = fresh(), material = { ...config.materials[0], id: 'named-revision', name: '米白细石 · 修改1' };
  const imported = importTileStyle(initial, { material, finish: { ...config.defaultTile, materialId: material.id } });
  assert.equal(imported.finish.materialId, material.id);
  assert.equal(imported.state.materials.find(m => m.id === imported.finish.materialId).name, material.name);
  assert.equal(initial.materials[0].name, '米白细石');
});
