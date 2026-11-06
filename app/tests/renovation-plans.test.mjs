import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, listPlans, readPlan, renameSavedPlan } from '../src/renovation3d/store/plans-api.ts';

const meta = { id: 'snapshot-1', name: '装修快照', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' };
const state = { schemaVersion: 1, buildingId: 'pdf-residence-1', materials: [{ id: 'custom', pricePerM2: 65 }], finishes: {}, faceFinishes: {}, faceRegionFinishes: { 'f1-front:face:-60': { materialId: 'custom' } }, windowFinishes: { 'f1-s-window': { glassType: 'medium', frameColor: '#112233' } } };

test('history list uses only the independent renovation API', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => { assert.equal(url, '/api/renovation3d/plans'); assert.equal(options, undefined); return Response.json([meta]); };
  try { assert.deepEqual(await listPlans(), [meta]); } finally { globalThis.fetch = original; }
});

test('saving posts a complete new snapshot including member regions, windows and prices', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/renovation3d/plans'); assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { name: meta.name, state });
    return Response.json({ ...meta, state }, { status: 201 });
  };
  try { assert.deepEqual(await createPlan(meta.name, state), { ...meta, state }); } finally { globalThis.fetch = original; }
});

test('read encodes the snapshot ID and rename sends no state mutations', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ ...meta, state }); };
  try {
    await readPlan('a/b?c'); await renameSavedPlan('snapshot-1', '新名称');
    assert.equal(calls[0].url, '/api/renovation3d/plans/a%2Fb%3Fc'); assert.equal(calls[0].options, undefined);
    assert.equal(calls[1].url, '/api/renovation3d/plans/snapshot-1'); assert.equal(calls[1].options.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[1].options.body), { name: '新名称' });
  } finally { globalThis.fetch = original; }
});

test('connection failures and invalid responses report concise errors without exposing submitted data', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('private diagnostic'); };
    await assert.rejects(listPlans(), /无法连接本机装修方案服务/);
    globalThis.fetch = async () => Response.json({ detail: [{ input: 'private snapshot image' }] }, { status: 422 });
    await assert.rejects(createPlan(meta.name, state), error => error.message === '装修方案名称或数据无效。');
    globalThis.fetch = async () => new Response('not JSON', { status: 200 });
    await assert.rejects(listPlans(), /返回格式无效/);
  } finally { globalThis.fetch = original; }
});
