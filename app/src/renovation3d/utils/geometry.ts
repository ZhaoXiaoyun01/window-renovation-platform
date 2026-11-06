import { clipHoles, intersect } from '../tile-layout/layout.ts';
import type { Part, Rect, Vec3, Wall } from '../types';

export const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0);
export const rounded = (n: number) => Math.round(n * 1e6) / 1e6;
export type Bounds = { min: Vec3; max: Vec3; owner: string };
export function wallFrame(wall: { rotationX?: number; rotationY: number }) {
  const x = wall.rotationX ?? 0, y = wall.rotationY;
  return { u: [Math.cos(y), Math.sin(x) * Math.sin(y), -Math.cos(x) * Math.sin(y)] as Vec3,
    v: [0, Math.cos(x), Math.sin(x)] as Vec3, n: [Math.sin(y), -Math.sin(x) * Math.cos(y), Math.cos(x) * Math.cos(y)] as Vec3 };
}
export const boxCorners = (box: Pick<Bounds, 'min' | 'max'>): Vec3[] => Array.from({ length: 8 }, (_, i) => box.min.map((n, k) => i & (1 << k) ? box.max[k] : n) as Vec3);
export function worldPoint(wall: { originMm: Vec3; rotationX?: number; rotationY: number }, p: Vec3): Vec3 {
  const { u, v, n } = wallFrame(wall);
  return wall.originMm.map((a, i) => rounded(a + u[i] * p[0] + v[i] * p[1] + n[i] * p[2])) as Vec3;
}
export function pointBounds(points: Vec3[]) {
  return { min: [0, 1, 2].map(i => rounded(Math.min(...points.map(p => p[i])))) as Vec3,
    max: [0, 1, 2].map(i => rounded(Math.max(...points.map(p => p[i])))) as Vec3 };
}
export function wallBodies(wall: Wall) {
  if (wall.surfaceOnly) return [];
  return wall.finishZones.flatMap(zone => clipHoles(zone, [...wall.openings, ...(wall.surfaceCuts ?? [])]).flatMap(r => {
    const rect = intersect(r, { x: 0, y: 0, width: wall.widthMm, height: wall.heightMm - (wall.topCoveredMm ?? 0) });
    return rect ? [{ rect, frontMm: zone.offsetMm, backMm: zone.backMm ?? -wall.thicknessMm, materialId: zone.materialId,
      sourceFaceId: `${wall.id}:face:${zone.offsetMm}${zone.faceKey ? `:${zone.faceKey}` : ''}` }] : [];
  }));
}
export function buildingBodies(walls: Wall[], parts: Part[]): Bounds[] {
  return [...walls.flatMap(wall => wallBodies(wall).map(({ rect: r, frontMm, backMm }) => ({ owner: wall.id,
    ...pointBounds([frontMm, backMm].flatMap(z => [[r.x, r.y, z], [r.x + r.width, r.y + r.height, z]].map(p => worldPoint(wall, p as Vec3)))) }))),
  ...parts.filter(p => p.kind !== 'rail' && p.kind !== 'screen').map(p => ({ owner: p.id,
    min: p.centerMm.map((a, i) => a - p.sizeMm[i] / 2) as Vec3, max: p.centerMm.map((a, i) => a + p.sizeMm[i] / 2) as Vec3 }))];
}
export function planeRect(wall: { originMm: Vec3; rotationX?: number; rotationY: number }, r: Rect, depth: number) {
  return pointBounds([[r.x, r.y, depth], [r.x + r.width, r.y + r.height, depth]].map(p => worldPoint(wall, p as Vec3)));
}
