import { buildingConfig as config } from '../config/building-config.ts';
import { area, intersect } from '../tile-layout/layout.ts';
import { rectUnion } from './outline.ts';
import { faceCellLimit, faceFinishLayout, faceFinishRegions, faceGridWall, faceTileSolids } from './wall-surfaces.ts';
import type { Finish, Layout, Rect, RenovationState, WallFace } from '../types';
import { purchaseQuantity } from './purchasing.ts';

export type TileQuantity = { materialId: string; widthMm: number; heightMm: number; tiles: number; cuts: number; narrow: number; areaMm2: number; kind?: 'paint' };
export const tileQuantityKey = (tile: Pick<Finish, 'materialId' | 'widthMm' | 'heightMm'> & { kind?: string }) => JSON.stringify(tile.kind === 'paint' ? [tile.materialId, 'paint'] : [tile.materialId, Math.min(tile.widthMm, tile.heightMm), Math.max(tile.widthMm, tile.heightMm)]);
export const purchaseTiles = (tiles: number,rule?:import('../types').PurchaseRule) => purchaseQuantity(tiles,rule).purchase;

export function aggregateTileQuantities(rows: TileQuantity[]): TileQuantity[] {
  const groups = new Map<string, TileQuantity>();
  for (const row of rows) {
    const key = tileQuantityKey(row), existing = groups.get(key);
    if (existing) {
      existing.tiles += row.tiles; existing.cuts += row.cuts; existing.narrow += row.narrow; existing.areaMm2 += row.areaMm2;
    } else groups.set(key, { ...row, widthMm: Math.min(row.widthMm, row.heightMm), heightMm: Math.max(row.widthMm, row.heightMm) });
  }
  return [...groups.values()].sort((a, b) => a.materialId.localeCompare(b.materialId) || a.widthMm - b.widthMm || a.heightMm - b.heightMm);
}

function regionQuantities(face: WallFace, finish: Finish, layout: Layout): TileQuantity[] {
  const base = { materialId: finish.materialId, widthMm: finish.widthMm, heightMm: finish.heightMm };
  if (!finish.preserveZoning) return layout.sourceTiles ? [{ ...base, tiles: layout.sourceTiles, cuts: layout.cutTiles, narrow: layout.narrowPieces, areaMm2: layout.netAreaMm2 }] : [];
  const zones = new Map<string, Rect[]>();
  for (const zone of face.zones) zones.set(zone.materialId, [...(zones.get(zone.materialId) ?? []), zone]);
  return [...zones].flatMap(([materialId, rectangles]) => {
    const rects = rectUnion(rectangles), cells = new Map<string, number>(); let narrow = 0;
    for (const piece of layout.pieces) for (const rect of rects) {
      const clipped = intersect(piece, rect); if (!clipped) continue;
      cells.set(piece.sourceTileId, (cells.get(piece.sourceTileId) ?? 0) + area(clipped));
      if (Math.min(clipped.width, clipped.height) < 100) narrow++;
    }
    return cells.size ? [{ ...base, materialId, tiles: cells.size, cuts: [...cells.values()].filter(value => value < finish.widthMm * finish.heightMm - 1e-5).length,
      narrow, areaMm2: faceTileSolids({ ...face, rects }).reduce((sum, rect) => sum + area(rect), 0) }] : [];
  });
}

export function buildingTileQuantities(faces: WallFace[], state: RenovationState) {
  const byFace = new Map(faces.map(face => [face.id, aggregateTileQuantities(faceFinishRegions(face, state).flatMap(region => {
    const layout = faceFinishLayout(region.face, faceGridWall(face, config.walls), region.finish, state, faceCellLimit(region.face, state, config.scene.maxCellsPerWall));
    if (state.materials.find(m => m.id === region.finish.materialId)?.kind === 'paint') return [{ materialId: region.finish.materialId, kind: 'paint' as const,
      widthMm: 0, heightMm: 0, tiles: 0, cuts: 0, narrow: 0, areaMm2: layout.netAreaMm2 }];
    return regionQuantities(region.face, region.finish, layout);
  }))]));
  return { byFace, all: aggregateTileQuantities([...byFace.values()].flat()) };
}

export function tileQuantityTotals(rows: TileQuantity[],rules:RenovationState['purchaseRules']={}) {
  return rows.reduce((total, row) => ({ tiles: total.tiles + row.tiles, purchase: total.purchase + purchaseTiles(row.tiles,rules[row.materialId]), paintArea: total.paintArea + (row.kind === 'paint' ? row.areaMm2 / 1e6 : 0),
    purchaseArea: total.purchaseArea + purchaseTiles(row.tiles,rules[row.materialId]) * row.widthMm * row.heightMm / 1e6,
    area: total.area + row.areaMm2 / 1e6, cuts: total.cuts + row.cuts, narrow: total.narrow + row.narrow }),
  { tiles: 0, purchase: 0, purchaseArea: 0, area: 0, paintArea: 0, cuts: 0, narrow: 0 });
}
