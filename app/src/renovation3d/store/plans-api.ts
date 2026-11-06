import type { RenovationState } from '../types';

export type PlanMetadata = { id: string; name: string; createdAt: string; updatedAt: string };
export type SavedPlan = PlanMetadata & { state: RenovationState };
const endpoint = '/api/renovation3d/';

export async function renovationRequest<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(endpoint + path, options); }
  catch { throw new Error('无法连接本机装修方案服务。'); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : response.status === 422 ? '装修方案名称或数据无效。' : `本地方案接口暂不可用（${response.status}）。`);
  if (body === null) throw new Error('本地方案接口返回格式无效。');
  return body as T;
}

export const listPlans = () => renovationRequest<PlanMetadata[]>('plans');
export const readPlan = (id: string) => renovationRequest<SavedPlan>(`plans/${encodeURIComponent(id)}`);
export const createPlan = (name: string, state: RenovationState) => renovationRequest<SavedPlan>('plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, state }) });
export const renameSavedPlan = (id: string, name: string) => renovationRequest<SavedPlan>(`plans/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
