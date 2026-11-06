import type { Finish, TileMaterial, TileStyle } from '../types';
import { validateTileStyle } from '../utils/validation.ts';
import { renovationRequest } from './plans-api.ts';

export async function listTileStyles(): Promise<TileStyle[]> {
  const styles = await renovationRequest<unknown>('tile-styles');
  if (!Array.isArray(styles)) throw new Error('瓷砖样式列表格式无效。');
  return styles.map(validateTileStyle);
}
export async function createTileStyle(name: string, material: TileMaterial, finish: Finish): Promise<TileStyle> {
  return validateTileStyle(await renovationRequest('tile-styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, material, finish }) }));
}
export async function renameTileStyle(id: string, name: string): Promise<TileStyle> {
  return validateTileStyle(await renovationRequest(`tile-styles/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }));
}
