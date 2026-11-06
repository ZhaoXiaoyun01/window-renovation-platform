import { buildingConfig as config } from '../config/building-config.ts';
import { intersect } from '../tile-layout/layout.ts';
import { rectUnion } from './outline.ts';
import { faceCellLimit, faceFinishLayout, faceFinishRegions, faceGridWall, faceTileSolids } from './wall-surfaces.ts';
import { aggregateTileQuantities, tileQuantityKey, type TileQuantity } from './tile-quantities.ts';
import { materialPrice, styleFingerprint } from './finish-actions.ts';
import { facadeLabels } from './units.ts';
import { modelGroups } from './model-surfaces.ts';
import { amountCents } from './money.ts';
import type { Finish, RenovationState, TileMaterial, WallFace } from '../types';
import { purchaseQuantity } from './purchasing.ts';
import { materialCatalog,deliveryMetadata } from './delivery-context.ts';

export const reportRegions = [modelGroups[0], ...config.floors.map(f => ({ id: f.id, label: f.label })), ...config.viewGroups.map(g => ({ id: g.id, label: g.label }))];
export const textureLabels = { plain: '纯色', stone: '石纹', concrete: '水泥纹', custom: '上传图片' };
export type ReportLine = TileQuantity & { key: string; regionId: string; material: TileMaterial; purchase: number; purchaseArea: number; unitPrice: number; amountCents: number; rule?:import('../types').PurchaseRule; reserved:number; boxes:number; codes:string[] };
export type ReportDetail = TileQuantity & { key: string; regionId: string; faceId: string; faceLabel: string; finish: Finish; code:string };
export const materialRowValues = (row: ReportLine, label: string) => [label, row.material.name, row.kind === 'paint' ? '漆面' : '瓷砖', `${textureLabels[row.material.texture]}${row.kind === 'paint' ? '' : ` / ${row.widthMm} × ${row.heightMm} mm`}`,
  row.areaMm2 / 1e6, row.kind === 'paint' ? '—' : row.tiles, row.kind === 'paint' ? '—' : row.purchase, row.purchaseArea, row.unitPrice, row.amountCents / 100,row.codes.join(' / '),row.material.color.toUpperCase(),row.kind==='paint'||!row.rule?.fullBoxes?'—':row.boxes];
export const reportTotals = (rows: ReportLine[]) => rows.reduce((sum, row) => ({ area: sum.area + row.areaMm2 / 1e6, tiles: sum.tiles + row.tiles,
  purchase: sum.purchase + row.purchase, purchaseArea: sum.purchaseArea + row.purchaseArea, amountCents: sum.amountCents + row.amountCents }), { area: 0, tiles: 0, purchase: 0, purchaseArea: 0, amountCents: 0 });

export function buildMaterialReport(faces: WallFace[], state: RenovationState) {
  const details: ReportDetail[] = [],catalog=materialCatalog(faces,state);
  for (const [index, face] of faces.entries()) for (const region of faceFinishRegions(face, state)) {
    const { finish } = region, material = state.materials.find(m => m.id === finish.materialId);
    if (!material) throw new Error('报表中的材质不存在。');
    const masks = new Map<string, WallFace['rects']>();
    for (const member of region.face.members) {
      const id = member.viewGroup ?? face.floorId;
      masks.set(id, [...(masks.get(id) ?? []), ...member.rects]);
    }
    const groups = [...masks].sort(([a], [b]) => a.localeCompare(b)).map(([id, rects]) => ({ id, rects: rectUnion(rects), tiles: 0, areaMm2: 0 }));
    for (const solid of faceTileSolids(region.face)) for (const group of groups) for (const mask of group.rects) {
      const p = intersect(solid, mask); if (p) group.areaMm2 += p.width * p.height;
    }
    if (material.kind !== 'paint') {
      const layout = faceFinishLayout(region.face, faceGridWall(face, config.walls), finish, state, faceCellLimit(region.face, state, config.scene.maxCellsPerWall));
      const cells = new Map<string, number[]>();
      for (const piece of layout.pieces) {
        const shares = cells.get(piece.sourceTileId) ?? groups.map(() => 0);
        groups.forEach((group, index) => { for (const mask of group.rects) { const p = intersect(piece, mask); if (p) shares[index] += p.width * p.height; } });
        cells.set(piece.sourceTileId, shares);
      }
      // A grid cell crossing the room/terrace boundary is purchased only once.
      for (const shares of cells.values()) groups[shares.indexOf(Math.max(...shares))].tiles++;
    }
    for (const group of groups.filter(g => g.areaMm2 > 0)) {
      const row: TileQuantity = { materialId: material.id, widthMm: material.kind === 'paint' ? 0 : finish.widthMm, heightMm: material.kind === 'paint' ? 0 : finish.heightMm,
        kind: material.kind === 'paint' ? 'paint' : undefined, tiles: group.tiles, areaMm2: group.areaMm2, cuts: 0, narrow: 0 };
      const label = face.category ? { wall: '外墙面', ceiling: '外顶面', floor: '室外地面' }[face.category] : { wall: '外墙', 'outdoor-floor': '室外地面', 'inner-wall': '内侧墙面', 'relief-return': '高差返边', 'exposed-surface': '外露面' }[face.surfaceKind ?? 'wall'];
      details.push({ ...row, key: tileQuantityKey(row), regionId: group.id, faceId: face.id, faceLabel: `${facadeLabels[face.facade]} · ${label} ${index + 1}`, code:catalog.find(c=>c.key===JSON.stringify([material.id,styleFingerprint(material,finish)]))!.code, finish });
    }
  }
  const lines = (rows: TileQuantity[], regionId: string): ReportLine[] => aggregateTileQuantities(rows).map(row => {
    const material = state.materials.find(m => m.id === row.materialId)!, rule=state.purchaseRules?.[material.id],calculated=purchaseQuantity(row.tiles,rule),purchase = material.kind === 'paint' ? 0 : calculated.purchase;
    const purchaseArea = material.kind === 'paint' ? row.areaMm2 / 1e6*(1+(rule?.reservePercent??0)/100) : purchase * row.widthMm * row.heightMm / 1e6, unitPrice = materialPrice(material);
    const codes=[...new Set(details.filter(d=>d.key===tileQuantityKey(row)&&(regionId==='all'||d.regionId===regionId)).map(d=>d.code))].sort();
    return { ...row, key: tileQuantityKey(row), regionId, material,codes, purchase, purchaseArea, unitPrice,rule,reserved:calculated.reserved,boxes:calculated.boxes,
      amountCents: amountCents([material.kind === 'paint' ? [row.areaMm2, 1e-6, 1+(rule?.reservePercent??0)/100,unitPrice] : [purchase, row.widthMm, row.heightMm, 1e-6, unitPrice]]) };
  });
  const regions = reportRegions.map(region => ({ ...region, rows: lines(details.filter(row => row.regionId === region.id), region.id) }));
  return { regions, summary: lines(details, 'all'), details,catalog };
}

export type MaterialReport = ReturnType<typeof buildMaterialReport>;
export function reportExportPayload(report: MaterialReport, name: string, generatedAt: string,basePlanId='') {
  return { name, generatedAt,metadata:deliveryMetadata(basePlanId),catalog:report.catalog.filter(c=>report.regions.some(region=>region.rows.some(row=>row.materialId===c.materialId&&(c.kind==='paint'||Math.min(row.widthMm,row.heightMm)===Math.min(c.widthMm,c.heightMm)&&Math.max(row.widthMm,row.heightMm)===Math.max(c.widthMm,c.heightMm))))).map(({key,...c})=>c), materials: report.summary.map(row => row.material).filter((m, index, all) => all.findIndex(a => a.id === m.id) === index)
    .map(m => ({ id: m.id, name: m.name, kind: m.kind ?? 'tile', texture: m.texture, pricePerM2: materialPrice(m),...(report.summary.find(r=>r.materialId===m.id)?.rule?{purchaseRule:report.summary.find(r=>r.materialId===m.id)!.rule}:{}) })),
    rows: report.regions.flatMap(region => region.rows.map(row => ({ regionId: region.id, materialId: row.materialId, widthMm: row.widthMm, heightMm: row.heightMm, tiles: row.tiles, areaMm2: row.areaMm2,codes:row.codes }))) };
}
