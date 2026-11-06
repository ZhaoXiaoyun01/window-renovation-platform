import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileStyle, listTileStyles, renameTileStyle } from '../src/renovation3d/store/styles-api.ts';

const material = { id: 'custom-tile', name: '自定义灰砖', color: '#112233', texture: 'custom', image: 'data:image/jpeg;base64,AA==', pricePerM2: 235.5 };
const finish = { materialId: material.id, widthMm: 45, heightMm: 95, direction: 'vertical', groutMm: 3, groutColor: '#778899', alignment: 'center', preserveZoning: false };
const style = { id: 'style-1', name: '自定义灰砖 45×95mm', material, finish, createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' };

test('style list uses the independent API and returns complete reusable parameters', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => { assert.equal(url, '/api/renovation3d/tile-styles'); assert.equal(options, undefined); return Response.json([style]); };
  try { assert.deepEqual(await listTileStyles(), [style]); } finally { globalThis.fetch = original; }
});

test('saving a style submits material content and actual 45×95mm layout without plan state', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/renovation3d/tile-styles'); assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { name: style.name, material, finish });
    return Response.json(style, { status: 201 });
  };
  try { assert.deepEqual(await createTileStyle(style.name, material, finish), style); } finally { globalThis.fetch = original; }
});

test('style rename encodes IDs and submits only the new name', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/renovation3d/tile-styles/a%2Fb%3Fc'); assert.equal(options.method, 'PATCH');
    assert.deepEqual(JSON.parse(options.body), { name: '重新命名' });
    return Response.json({ ...style, name: '重新命名' });
  };
  try { assert.equal((await renameTileStyle('a/b?c', '重新命名')).name, '重新命名'); } finally { globalThis.fetch = original; }
});

test('invalid persisted styles reject before entering a plan or exposing private error inputs', async () => {
  const original = globalThis.fetch;
  try {
    for (const mutate of [
      value => { value.material.pricePerM2 = -1; },
      value => { value.material.image = 'invalid'; },
      value => { value.finish.materialId = 'missing'; },
      value => { value.finish.widthMm = 19; },
      value => { value.finish.groutColor = 'red'; },
      value => { value.createdAt = 'unknown'; },
    ]) {
      const invalid = structuredClone(style); mutate(invalid);
      globalThis.fetch = async () => Response.json([invalid]);
      await assert.rejects(listTileStyles());
    }
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(listTileStyles(), /列表格式无效/);
    globalThis.fetch = async () => Response.json({ detail: [{ input: material.image }] }, { status: 422 });
    await assert.rejects(createTileStyle(style.name, material, finish), error => error.message === '装修方案名称或数据无效。');
  } finally { globalThis.fetch = original; }
});
