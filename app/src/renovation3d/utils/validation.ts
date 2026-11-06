import { buildingConfig as config } from '../config/building-config.ts';
import { previousFaces25, retiredFaces, retiredWalls } from '../config/geometry-compat.ts';
import { layoutTiles, validateTile } from '../tile-layout/layout.ts';
import { buildingFaces, buildingFacesAtRevision6, buildingFacesAtRevision7, buildingFacesAtRevision8, faceCellLimit, faceFinishLayout, faceFinishRegions, faceGridWall, faceTileLayout, faceSolids, wallFaces } from './wall-surfaces.ts';
import { projectRects } from './coplanar-faces.ts';
import { intersect } from '../tile-layout/layout.ts';
import { upgradeFaceGrouping } from './face-compat.ts';
import { styleFingerprint } from './finish-actions.ts';
import { editableBuildingFaces, editableFacesAtRevision10, modelGroups } from './model-surfaces.ts';
import { validateWindowFinish } from './window-finishes.ts';
import { validatePurchaseRule } from './purchasing.ts';
import type { Finish, RenovationState, TileMaterial, TileStyle, WindowFinish } from '../types';
export const storageKey = 'renovation3d:1.0:residence';
export const colorValid = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
// Only these former wall IDs may be retired while restoring a complete 1.0 plan.
const legacyWallIds = new Set([
  ...['f1', 'f2', 'f3', 'f4'].flatMap(id => ['front', 'back', 'left', 'right'].map(facade => `${id}-${facade}`)),
  ...['f1', 'f2', 'f3'].map(id => `${id}-porch-back`),
  'terrace-south', 'roof-front', 'roof-back', 'terrace-side--1', 'terrace-side-1', 'roof-side--1', 'roof-side-1',
  ...Object.keys(retiredWalls),
]);
export function validateMaterial(value: unknown): TileMaterial {
  const material = value as TileMaterial;
  if (!material || typeof material.id !== 'string' || !material.id || material.id.length > 100 || typeof material.name !== 'string' || !material.name || material.name.length > 80 || !colorValid(material.color) || !['plain', 'stone', 'concrete', 'custom'].includes(material.texture)) throw new Error('材质数据无效。');
  if (material.kind !== undefined && !['tile', 'paint'].includes(material.kind) || material.kind === 'paint' && (material.texture !== 'plain' || material.image)) throw new Error('漆面须使用纯色材质。');
  if (material.pricePerM2 !== undefined && (!Number.isFinite(material.pricePerM2) || material.pricePerM2 < 0 || material.pricePerM2 > 1000000)) throw new Error('材料单价无效。');
  if (material.texture === 'custom' && (typeof material.image !== 'string' || material.image.length > 1500000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(material.image))) throw new Error('自定义图片无效。');
  return { ...material };
}
export function validateTileStyle(value: unknown): TileStyle {
  const style = value as TileStyle;
  if (!style || typeof style.id !== 'string' || !style.id || style.id.length > 100 || typeof style.name !== 'string' || !style.name.trim() || style.name.length > 80 || [style.createdAt, style.updatedAt].some(date => typeof date !== 'string' || !Number.isFinite(Date.parse(date)))) throw new Error('瓷砖样式数据无效。');
  const material = validateMaterial(style.material), finish = style.finish;
  if (!finish || finish.materialId !== material.id || !colorValid(finish.groutColor) || finish.preserveZoning !== undefined && typeof finish.preserveZoning !== 'boolean') throw new Error('瓷砖样式铺贴参数无效。');
  validateTile(finish);
  return { ...style, material, finish: { ...finish } };
}
export function validateState(value: unknown): RenovationState {
  return validateAtRevision(value, 11);
}
export const validateRevision10State = (value: unknown) => validateAtRevision(value, 10);
export const validateRevision9State = (value: unknown) => validateAtRevision(value, 9);
// Historical validation is retained for exact migration regression checks.
export const validateRevision7State = (value: unknown) => validateAtRevision(value, 7);
export const validateRevision8State = (value: unknown) => validateAtRevision(value, 8);
function validateAtRevision(value: unknown, revision: 6 | 7 | 8 | 9 | 10 | 11): RenovationState {
  if (!value || typeof value !== 'object') throw new Error('方案格式无效。');
  const s = value as RenovationState;
  if(s.modelReviews!==undefined && (!s.modelReviews || Array.isArray(s.modelReviews) || typeof s.modelReviews!=='object' || Object.keys(s.modelReviews).length>2000 || Object.entries(s.modelReviews).some(([id,r])=>id.length>600||!r||!['reviewed','pending'].includes(r.status)||typeof r.note!=='string'||r.note.length>1000||typeof r.evidence!=='string'||r.evidence.length>4096||!Number.isFinite(Date.parse(r.reviewedAt))))) throw new Error('模型复核记录无效。');
  if (s.schemaVersion !== 1 || s.buildingId !== config.id || !Array.isArray(s.materials) || s.materials.length > config.scene.maxMaterials || typeof s.finishes !== 'object' || !s.finishes || Array.isArray(s.finishes) || !Array.isArray(s.hiddenFloors) || typeof s.exploded !== 'boolean') throw new Error('方案版本或建筑不匹配。');
  if (s.background !== undefined && !['studio', 'sunny'].includes(s.background)) throw new Error('场景背景无效。');
  if (s.sunHour !== undefined && (!Number.isFinite(s.sunHour) || s.sunHour < 6 || s.sunHour > 18)) throw new Error('日照时间无效。');
  if (s.faceGroupingVersion !== undefined && (![2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(s.faceGroupingVersion) || s.faceGroupingVersion > revision)) throw new Error('块面分组版本无效。');
  if (revision === 11 && (s.faceGroupingVersion ?? 0) < 11) {
    const old = validateAtRevision(value, 10);
    const faceFinishes = Object.fromEntries(editableBuildingFaces().map(face => [face.id, { ...old.faceFinishes![face.previousFaceId!], preserveZoning: false }]));
    return validateAtRevision({ ...old, faceGroupingVersion: 11, faceFinishes, faceRegionFinishes: {} }, 11);
  }
  if (revision === 10 && (s.faceGroupingVersion ?? 0) < 10) {
    const old = validateAtRevision(value, 9);
    const faceFinishes = Object.fromEntries(editableFacesAtRevision10().map(face => [face.id, { ...old.faceFinishes![face.previousFaceId!], preserveZoning: false }]));
    return validateAtRevision({ ...old, faceGroupingVersion: 10, faceFinishes, faceRegionFinishes: {} }, 10);
  }
  if (revision >= 8 && revision <= 9 && (s.faceGroupingVersion ?? 0) < revision) {
    const old = validateAtRevision(value, revision === 8 ? 7 : 8), previous = new Map((revision === 8 ? buildingFacesAtRevision7() : buildingFacesAtRevision8()).map(face => [face.id, face]));
    const faceFinishes = Object.fromEntries((revision === 8 ? buildingFacesAtRevision8() : buildingFaces(config.walls)).map(face => {
      const candidates = new Map<string, { finish: Finish; area: number }>(), solids = faceSolids(face);
      for (const id of face.mergedFaceIds!) for (const region of faceFinishRegions(previous.get(id)!, old)) {
        const patches = region.finish.preserveZoning ? region.face.zones.map(zone => ({ finish: { ...region.finish, materialId: zone.materialId }, rects: faceSolids(region.face).flatMap(r => { const p = intersect(r, zone); return p ? [p] : []; }) })) : [{ finish: region.finish, rects: faceSolids(region.face) }];
        for (const patch of patches) {
          const area = projectRects(region.face, face, patch.rects).reduce((sum, r) => sum + solids.reduce((n, mask) => { const p = intersect(r, mask); return n + (p ? p.width * p.height : 0); }, 0), 0);
          if (!area) continue;
          const finish = { ...patch.finish, preserveZoning: false }, material = old.materials.find(m => m.id === finish.materialId)!;
          const key = styleFingerprint(material, finish), candidate = candidates.get(key);
          if (candidate) candidate.area += area; else candidates.set(key, { finish, area });
        }
      }
      const selected = [...candidates.entries()].sort((a, b) => b[1].area - a[1].area || a[0].localeCompare(b[0]))[0][1];
      return [face.id, selected.finish];
    }));
    return validateAtRevision({ ...old, faceGroupingVersion: revision, faceFinishes, faceRegionFinishes: {} }, revision);
  }
  if (revision === 7 && (s.faceGroupingVersion ?? 0) < 7) {
    return validateAtRevision(upgradeFaceGrouping(validateAtRevision(value, 6), buildingFacesAtRevision7()), 7);
  }
  const ids = new Set<string>();
  for (const mat of s.materials) {
    validateMaterial(mat);
    if (ids.has(mat.id)) throw new Error('材质数据无效。');
    ids.add(mat.id);
  }
  if(s.purchaseRules!==undefined){if(!s.purchaseRules||typeof s.purchaseRules!=='object'||Array.isArray(s.purchaseRules)||Object.keys(s.purchaseRules).length>32)throw new Error('采购规则无效。');for(const [id,rule] of Object.entries(s.purchaseRules)){if(!ids.has(id))throw new Error('采购规则材质不存在。');validatePurchaseRule(rule);}}
  if (s.hiddenFloors.some(id => !config.floors.some(f => f.id === id))) throw new Error('楼层数据无效。');
  if (s.hiddenGroups !== undefined && (!Array.isArray(s.hiddenGroups) || new Set(s.hiddenGroups).size !== s.hiddenGroups.length || s.hiddenGroups.some(id => !modelGroups.some(group => group.id === id)))) throw new Error('显示分组数据无效。');
  const wallIds = new Set(config.walls.map(w => w.id));
  if (![...wallIds].every(id => Object.hasOwn(s.finishes, id)) && ![...legacyWallIds].filter(id => !Object.hasOwn(retiredWalls, id)).every(id => Object.hasOwn(s.finishes, id))) throw new Error('墙面数据不完整。');
  for (const [id, finish] of Object.entries(s.finishes)) {
    if (!wallIds.has(id) && !legacyWallIds.has(id)) throw new Error('墙面数据不匹配。');
    if (!finish || !ids.has(finish.materialId) || !colorValid(finish.groutColor)) throw new Error('墙面材质无效。');
    if (finish.preserveZoning !== undefined && typeof finish.preserveZoning !== 'boolean') throw new Error('墙面分区参数无效。');
    validateTile(finish);
  }
  if (s.faceFinishes !== undefined && (!s.faceFinishes || typeof s.faceFinishes !== 'object' || Array.isArray(s.faceFinishes))) throw new Error('块面方案格式无效。');
  const faces = new Map((revision === 6 ? buildingFacesAtRevision6() : revision === 7 ? buildingFacesAtRevision7() : revision === 8 ? buildingFacesAtRevision8() : revision === 9 ? buildingFaces(config.walls) : revision === 10 ? editableFacesAtRevision10() : editableBuildingFaces()).map(f => [f.id, f]));
  const oldGeometry = Object.keys(s.finishes).some(id => !wallIds.has(id) && Object.hasOwn(retiredWalls, id));
  const faceFinishes: Record<string, Finish> = {};
  for (const [id, finish] of Object.entries(s.faceFinishes ?? {})) {
    const target = faces.has(id) ? id : retiredFaces[id], face = target ? faces.get(target) : undefined;
    if (!face && !Object.hasOwn(retiredFaces, id)) throw new Error('块面数据不匹配。');
    if (!finish || !ids.has(finish.materialId) || !colorValid(finish.groutColor)) throw new Error('块面材质无效。');
    if (finish.preserveZoning !== undefined && typeof finish.preserveZoning !== 'boolean') throw new Error('块面分区参数无效。');
    validateTile(finish);
    if (face) {
      if (s.materials.find(m => m.id === finish.materialId)?.kind !== 'paint') faceTileLayout(face, faceGridWall(face, config.walls), finish, config.scene.maxCellsPerWall);
      if (id === face.id || !s.faceFinishes?.[face.id]) faceFinishes[face.id] = { ...finish };
    }
  }
  // Upgrade by exact former patch, not by a shared ID prefix. Some cap anchors
  // moved between display groups; read the saved map so copying cannot cascade.
  if ((s.faceGroupingVersion ?? 0) < 6) for (const [id, parent] of Object.entries(previousFaces25)) {
    const finish = s.faceFinishes?.[parent];
    if (finish) faceFinishes[id] = { ...finish };
    else delete faceFinishes[id];
  }
  // Newly separated caps inherit a prior whole-face replacement without rewriting the saved scheme.
  for (const face of faces.values()) if (!s.faceGroupingVersion && face.faceKey && !faceFinishes[face.id]) {
    const former = s.faceFinishes?.[`${face.wallId}:face:${face.offsetMm}`];
    if (former) faceFinishes[face.id] = { ...former };
  }
  // These disconnected inner walls formerly shared the roof face's saved override.
  for (const sign of s.faceGroupingVersion ? [] : [-1, 1]) {
    const terraceId = `terrace-side-${sign}-inner:face:0`, roofId = `roof-side-${sign}-inner:face:0`;
    if (faces.has(terraceId) && !faceFinishes[terraceId] && faceFinishes[roofId]) faceFinishes[terraceId] = { ...faceFinishes[roofId] };
  }
  if ((s.faceGroupingVersion ?? 0) < 3 || oldGeometry) for (const face of faces.values()) {
    if (face.legacyFaceId && !faceFinishes[face.id] && faceFinishes[face.legacyFaceId]) faceFinishes[face.id] = { ...faceFinishes[face.legacyFaceId] };
  }
  // Revision 4 already made junctions independent. Only new view-group children
  // inherit when upgrading it to 5; do not repaint an existing untouched neighbour.
  if ((s.faceGroupingVersion ?? 0) < 5) for (const face of faces.values()) if (!faceFinishes[face.id]) {
    if (s.faceGroupingVersion === 4 && !face.id.includes(':view:')) continue;
    const parent = (face.legacyFaceIds ?? []).map(id => faceFinishes[id]).find(Boolean);
    if (parent) faceFinishes[face.id] = { ...parent };
  }
  if (s.faceRegionFinishes !== undefined && (!s.faceRegionFinishes || typeof s.faceRegionFinishes !== 'object' || Array.isArray(s.faceRegionFinishes))) throw new Error('分区方案格式无效。');
  const sourceFaces = new Set([...config.walls.flatMap(wallFaces).map(f => f.id), ...[...faces.values()].flatMap(f => f.members.map(m => m.sourceFaceId))]), faceRegionFinishes: Record<string, Finish> = {};
  for (const [id, finish] of Object.entries(s.faceRegionFinishes ?? {})) {
    const wallId = id.split(':face:')[0], mappedWall = retiredWalls[wallId];
    const target = sourceFaces.has(id) ? id : retiredFaces[id] ?? (mappedWall ? id.replace(wallId, mappedWall) : undefined);
    const retired = Object.hasOwn(retiredFaces, id) || Object.hasOwn(retiredWalls, wallId) && id === `${wallId}:face:0`;
    if ((!target || !sourceFaces.has(target)) && !retired || !finish || !ids.has(finish.materialId) || !colorValid(finish.groutColor) || finish.preserveZoning !== false) throw new Error('分区铺贴数据无效。');
    validateTile(finish); if (target && sourceFaces.has(target)) faceRegionFinishes[target] = { ...finish };
  }
  if (s.windowFinishes !== undefined && (!s.windowFinishes || typeof s.windowFinishes !== 'object' || Array.isArray(s.windowFinishes))) throw new Error('窗户方案格式无效。');
  const windows = new Set(config.walls.flatMap(w => w.openings.filter(o => o.kind === 'window').map(o => o.id))), windowFinishes: Record<string, WindowFinish> = {};
  for (const [id, finish] of Object.entries(s.windowFinishes ?? {})) {
    if (!windows.has(id) || !finish || !colorValid(finish.frameColor) || !['low', 'medium', 'high'].includes(finish.glassType)) throw new Error('窗框或玻璃参数无效。');
    windowFinishes[id] = validateWindowFinish(finish);
    if(windowFinishes[id].quotes?.some(q=>q.configuration.openingId!==id))throw new Error('窗户报价配置不匹配。');
  }
  if (s.partColors !== undefined && (!s.partColors || typeof s.partColors !== 'object' || Array.isArray(s.partColors))) throw new Error('格栅颜色数据无效。');
  const partColors: Record<string, string> = {};
  for (const [id, color] of Object.entries(s.partColors ?? {})) {
    if (!config.parts.some(p => p.kind === 'screen' && p.id === id) || !colorValid(color)) throw new Error('格栅颜色数据无效。');
    partColors[id] = color;
  }
  const materials = [...s.materials], finishes: Record<string, Finish> = {};
  const ensureMaterial = (id: string) => {
    if (ids.has(id)) return;
    const material = config.materials.find(m => m.id === id);
    if (!material || materials.length >= config.scene.maxMaterials) throw new Error('新增墙面或配色分区的默认材质无法补全。');
    materials.push({ ...material }); ids.add(material.id);
  };
  for (const wall of config.walls) {
    let inherited: Finish | undefined;
    if (!s.finishes[wall.id] && wall.finishSourceFaceId && wall.finishSourcePointMm) {
      const sourceId = wall.finishSourceFaceId, [x, y] = wall.finishSourcePointMm;
      const parent = [...faces.values()].find(face => face.members.some(member => member.sourceFaceId === sourceId && member.rects.some(rect => {
        const px = x + member.shiftMm[0], py = y + member.shiftMm[1];
        return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height && !face.holes.some(h => px > h.x && px < h.x + h.width && py > h.y && py < h.y + h.height);
      })));
      const sourceWallId = sourceId.split(':face:')[0];
      const source = (parent && faceFinishes[parent.id]) ?? s.faceRegionFinishes?.[sourceId] ?? s.finishes[sourceWallId];
      if (source) {
        const preserve = source.preserveZoning ?? source.materialId === config.walls.find(w => w.id === sourceWallId)?.finishZones[0].materialId;
        inherited = { ...source, materialId: preserve ? wall.finishZones[0].materialId : source.materialId, preserveZoning: false };
      }
    }
    const formerId = Object.keys(retiredWalls).find(id => retiredWalls[id] === wall.id && s.finishes[id]);
    const finish = s.finishes[wall.id] ?? (formerId ? s.finishes[formerId] : undefined) ?? inherited ?? { ...config.defaultTile, materialId: wall.finishZones[0].materialId, preserveZoning: true };
    ensureMaterial(finish.materialId);
    if (s.materials.find(m => m.id === finish.materialId)?.kind !== 'paint') layoutTiles(wall.widthMm, wall.heightMm, wall.openings, finish, config.scene.maxCellsPerWall);
    finishes[wall.id] = { ...finish, preserveZoning: finish.preserveZoning ?? finish.materialId === wall.finishZones[0].materialId };
    if (finishes[wall.id].preserveZoning) wall.finishZones.forEach(z => ensureMaterial(z.materialId));
  }
  for (const [id, finish] of Object.entries(faceFinishes)) if (finish.preserveZoning) faces.get(id)!.zones.forEach(zone => ensureMaterial(zone.materialId));
  for (const material of config.materials.filter(m => m.kind === 'paint')) if (!ids.has(material.id) && materials.length < config.scene.maxMaterials) ensureMaterial(material.id);
  const restored: RenovationState = { ...s, materials, finishes, faceFinishes, faceRegionFinishes, windowFinishes, partColors, background: s.background ?? 'studio', hiddenGroups: [...(s.hiddenGroups ?? [])], faceGroupingVersion: revision };
  if (revision >= 8) {
    for (const face of faces.values()) restored.faceFinishes![face.id] = { ...faceFinishRegions(face, restored)[0].finish, preserveZoning: false };
    restored.faceRegionFinishes = {};
  }
  let totalCells = 0;
  const maxTotalCells = config.scene.maxTotalCells ?? 250000;
  for (const face of faces.values()) for (const region of faceFinishRegions(face, restored)) {
    totalCells += faceFinishLayout(region.face, faceGridWall(face, config.walls), region.finish, restored, faceCellLimit(region.face, restored, config.scene.maxCellsPerWall)).sourceTiles;
    if (totalCells > maxTotalCells) throw new Error(`全楼砖格超过${maxTotalCells.toLocaleString()}格，请增大瓷砖规格或减少替换范围。`);
  }
  return restored;
}

export async function readTileImage(file: File): Promise<TileMaterial> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('请选择不超过10MB的 PNG/JPG/WebP 图片。');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 30000000) throw new Error('图片不得超过3000万像素。');
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法读取图片。');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { id: `custom-${crypto.randomUUID()}`, name: file.name.slice(0, 70), texture: 'custom', color: '#ffffff', image: canvas.toDataURL('image/jpeg', 0.85) };
  } finally { bitmap.close(); }
}
