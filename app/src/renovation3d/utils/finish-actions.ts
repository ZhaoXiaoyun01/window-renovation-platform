import { buildingConfig as config } from '../config/building-config.ts';
import { faceFinishRegions } from './wall-surfaces.ts';
import type { Finish, RenovationState, TileMaterial, TileStyle, WallFace } from '../types';

export const materialPrice = (material: TileMaterial) => material.pricePerM2 ?? config.materials.find(m => m.id === material.id)?.pricePerM2 ?? 0;
export function tileStyleName(material: Pick<TileMaterial, 'name'>, styles: Pick<TileStyle, 'name'>[] = []) {
  const original = material.name.replace(/ · 修改\d+$/, '').slice(0, 64), prefix = `${original} · 修改`;
  const revisions = [material, ...styles].map(item => item.name.startsWith(prefix) ? Number(item.name.slice(prefix.length)) : 0).filter(Number.isInteger);
  return `${prefix}${Math.max(0, ...revisions) + 1}`;
}
export const sameMaterial = (a: TileMaterial, b: TileMaterial) => (a.kind ?? 'tile') === (b.kind ?? 'tile') && a.color === b.color && a.texture === b.texture && a.image === b.image && materialPrice(a) === materialPrice(b);
export const styleFingerprint = (material: TileMaterial, finish: Finish, includePrice = true) => JSON.stringify([
  material.kind ?? 'tile', material.color.toLowerCase(), material.texture, material.image ?? '', ...(includePrice ? [materialPrice(material)] : []),
  ...(material.kind === 'paint' ? [] : [Number(finish.widthMm), Number(finish.heightMm), finish.direction, Number(finish.groutMm), finish.groutColor.toLowerCase(), finish.alignment]),
]);
export const styleChanged = (baseline: string, material: TileMaterial, finish: Finish, name?: string, originalName = '', generatedName = '') =>
  styleFingerprint(material, finish) !== baseline || name !== undefined && name.trim() !== originalName && name.trim() !== generatedName;
export const matchesTileStyle = (material: TileMaterial, finish: Finish, style: Pick<TileStyle, 'material' | 'finish'>) => sameMaterial(material, style.material)
  && (material.kind === 'paint' || (['widthMm', 'heightMm', 'direction', 'groutMm', 'groutColor', 'alignment'] as const).every(key => finish[key] === style.finish[key]));

// A saved style carries its own material; importing must not recolor existing faces.
export function importTileStyle(state: RenovationState, style: Pick<TileStyle, 'material' | 'finish'>) {
  const matching = state.materials.find(m => m.name === style.material.name && sameMaterial(m, style.material));
  if (matching) return { state, finish: { ...style.finish, materialId: matching.id, preserveZoning: false } };
  if (state.materials.length >= config.scene.maxMaterials) throw new Error(`最多保存${config.scene.maxMaterials}个材质样例，无法导入新样式材质。`);
  const material = { ...style.material, id: state.materials.some(m => m.id === style.material.id) ? `style-${crypto.randomUUID()}` : style.material.id };
  return { state: { ...state, materials: [...state.materials, material] }, finish: { ...style.finish, materialId: material.id, preserveZoning: false } };
}

// Edits are copies: preset samples and faces using the original sample stay unchanged.
export function materialDraft(state: RenovationState, id: string, color: string, pricePerM2: number) {
  const material = state.materials.find(m => m.id === id);
  if (!material || !Number.isFinite(pricePerM2) || pricePerM2 < 0 || pricePerM2 > 1000000) throw new Error('材料参数无效。');
  const edited = { ...material, color, pricePerM2 };
  const imported = importTileStyle(state, { material: edited, finish: { ...config.defaultTile, materialId: id } });
  if (imported.state === state) return imported;
  const draftId = `draft-${imported.finish.materialId}`;
  return { state: { ...state, materials: [...state.materials, { ...edited, id: draftId }],...(state.purchaseRules?.[id]?{purchaseRules:{...state.purchaseRules,[draftId]:state.purchaseRules[id]}}:{}) }, finish: { ...imported.finish, materialId: draftId } };
}

export function replacementMaterial(state: RenovationState, materialId: string, color: string) {
  const material = state.materials.find(m => m.id === materialId);
  if (!material) throw new Error('瓷砖材质不存在。');
  if (material.color === color) return { materials: state.materials, materialId };
  const existing = state.materials.find(m => (m.kind ?? 'tile') === (material.kind ?? 'tile') && m.color === color && m.texture === material.texture && m.image === material.image && materialPrice(m) === materialPrice(material));
  if (existing) return { materials: state.materials, materialId: existing.id };
  if (state.materials.length >= config.scene.maxMaterials) throw new Error(`最多保存${config.scene.maxMaterials}个材质样例。`);
  const tinted = { ...material, id: `tint-${crypto.randomUUID()}`, name: `${material.name.slice(0, 55)} · 调色`, color };
  return { materials: [...state.materials, tinted], materialId: tinted.id };
}

export function replaceFaces(state: RenovationState, faces: WallFace[], finish: Finish): RenovationState {
  const faceFinishes = { ...state.faceFinishes };
  for (const face of faces) faceFinishes[face.id] = { ...finish, preserveZoning: false };
  return { ...state, faceFinishes };
}

// Replace matching inherited regions without changing other materials in a merged legacy face.
export function replaceSameMaterial(state: RenovationState, faces: WallFace[], sourceMaterialId: string, selectedFaceId: string, finish: Finish) {
  const faceFinishes = { ...state.faceFinishes }, faceRegionFinishes = { ...state.faceRegionFinishes };
  let count = 0;
  for (const face of faces) {
    const regions = faceFinishRegions(face, state), matches = regions.filter(r => r.finish.materialId === sourceMaterialId);
    if (face.id === selectedFaceId || matches.length === regions.length) { faceFinishes[face.id] = { ...finish, preserveZoning: false }; count++; }
    else if (matches.length) {
      for (const region of matches) for (const member of region.face.members) faceRegionFinishes[member.sourceFaceId] = { ...finish, preserveZoning: false };
      count++;
    }
  }
  return { state: { ...state, faceFinishes, faceRegionFinishes }, count };
}
