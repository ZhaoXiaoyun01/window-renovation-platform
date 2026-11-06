import { buildingConfig as config } from '../config/building-config.ts';
import { rectUnion } from './outline.ts';
import { buildingBodies, pointBounds, wallFrame, worldPoint, type Bounds } from './geometry.ts';
import type { Part, Rect, Vec3, Wall } from '../types';

export type StructuralPatch = { id: string; floorId: string; viewGroup?: Wall['viewGroup']; originMm: Vec3; rotationX: number; rotationY: number; widthMm: number; heightMm: number; color: string };
const epsilon = 1e-5;
const directions = [
  { axis: 0, sign: 1, u: [0, 0, -1], v: [0, 1, 0], x: 0, y: Math.PI / 2 },
  { axis: 0, sign: -1, u: [0, 0, 1], v: [0, 1, 0], x: 0, y: -Math.PI / 2 },
  { axis: 2, sign: 1, u: [1, 0, 0], v: [0, 1, 0], x: 0, y: 0 },
  { axis: 2, sign: -1, u: [-1, 0, 0], v: [0, 1, 0], x: 0, y: Math.PI },
  { axis: 1, sign: 1, u: [1, 0, 0], v: [0, 0, -1], x: -Math.PI / 2, y: 0 },
  { axis: 1, sign: -1, u: [1, 0, 0], v: [0, 0, 1], x: Math.PI / 2, y: 0 },
] as const;
const project = (box: Bounds, u: readonly number[], v: readonly number[]): Rect => {
  const span = (axis: readonly number[]) => { const i = axis.findIndex(n => n !== 0), sign = axis[i]; return sign > 0 ? [box.min[i], box.max[i]] : [-box.max[i], -box.min[i]]; };
  const [x, x2] = span(u), [y, y2] = span(v); return { x, y, width: x2 - x, height: y2 - y };
};

// Exposed shells of the base steps. A foundation plane already owns their
// coincident bottoms, so those patches must not be drawn a second time.
export function stepShells(parts: Part[]): StructuralPatch[] {
  const steps = parts.filter(p => p.kind === 'step'), boxes = buildingBodies([], steps), foundation = parts.find(p => p.id === 'f1-slab')!;
  const planeY = foundation.centerMm[1] + foundation.sizeMm[1] / 2;
  const ground = { x: foundation.centerMm[0] - foundation.sizeMm[0] / 2, y: foundation.centerMm[2] - foundation.sizeMm[2] / 2, width: foundation.sizeMm[0], height: foundation.sizeMm[2] };
  const claimed = new Map<string, Rect[]>();
  return boxes.flatMap((box, index) => directions.flatMap(direction => {
    const { axis, sign, u, v } = direction, coordinate = sign > 0 ? box.max[axis] : box.min[axis];
    const key = `${axis}:${sign}:${coordinate}`, previous = claimed.get(key) ?? [];
    const masks = boxes.filter(other => other !== box && (sign > 0 ? other.min[axis] <= coordinate + epsilon && other.max[axis] > coordinate + epsilon : other.max[axis] >= coordinate - epsilon && other.min[axis] < coordinate - epsilon)).map(other => project(other, u, v));
    if (axis === 1 && sign < 0 && Math.abs(coordinate - planeY) < epsilon) masks.push(ground);
    const rects = rectUnion([project(box, u, v)], [...masks, ...previous]); claimed.set(key, [...previous, ...rects]);
    return rects.map((rect, i) => ({ id: `${box.owner}:${axis}:${sign}:${i}`, floorId: steps[index].floorId, viewGroup: 'base' as const,
      originMm: [0, 1, 2].map(k => u[k] * rect.x + v[k] * rect.y + (k === axis ? coordinate : 0)) as Vec3,
      rotationX: direction.x, rotationY: direction.y, widthMm: rect.width, heightMm: rect.height, color: steps[index].color }));
  }));
}

// Fill only endpoint junctions of perpendicular masonry walls. Keep the fill
// inside both wall thickness bands; balcony/door openings are never filled.
export function cornerFillers(walls: Wall[]): (Bounds & { floorId: string })[] {
  const solidWalls = walls.filter(w => !w.surfaceOnly && !w.rotationX && !w.viewGroup), result: (Bounds & { floorId: string })[] = [];
  const bodies = buildingBodies(walls, []);
  const openings = solidWalls.flatMap(wall => wall.openings.map(opening => ({ owner: opening.id,
    ...pointBounds([Math.min(-wall.thicknessMm, ...wall.finishZones.map(zone => zone.backMm ?? -wall.thicknessMm)), Math.max(0, ...wall.finishZones.map(zone => zone.offsetMm))].flatMap(z =>
      [opening.x, opening.x + opening.width].flatMap(x => [opening.y, opening.y + opening.height].map(y => worldPoint(wall, [x, y, z]))))) })));
  for (let i = 0; i < solidWalls.length; i++) for (let j = i + 1; j < solidWalls.length; j++) {
    const a = solidWalls[i], b = solidWalls[j], fa = wallFrame(a), fb = wallFrame(b);
    if (a.floorId !== b.floorId || Math.abs(fa.n[0] * fb.n[0] + fa.n[2] * fb.n[2]) > .01) continue;
    const ax = Math.abs(fa.n[0]) > .9 ? 0 : 2, bx = 2 - ax;
    const p: Vec3 = [0, 0, 0]; p[ax] = a.originMm[ax]; p[bx] = b.originMm[bx];
    const along = (w: Wall, u: Vec3) => (p[0] - w.originMm[0]) * u[0] + (p[2] - w.originMm[2]) * u[2];
    const da = along(a, fa.u), db = along(b, fb.u), nearEnd = (t: number, wall: Wall) => Math.min(Math.abs(t), Math.abs(t - wall.widthMm)) <= Math.max(a.thicknessMm, b.thicknessMm) + epsilon;
    if (!nearEnd(da, a) || !nearEnd(db, b)) continue;
    // Both endpoint rectangles must actually be masonry at this height.
    const levels = [...new Set([a.originMm[1], b.originMm[1], a.originMm[1] + a.heightMm, b.originMm[1] + b.heightMm,
      ...a.openings.flatMap(o => [a.originMm[1] + o.y, a.originMm[1] + o.y + o.height]), ...b.openings.flatMap(o => [b.originMm[1] + o.y, b.originMm[1] + o.y + o.height])])].sort((x, y) => x - y);
    for (let level = 0; level < levels.length - 1; level++) {
      const bottom = levels[level], top = levels[level + 1], y = (bottom + top) / 2;
      const active = (w: Wall) => y >= w.originMm[1] && y <= w.originMm[1] + w.heightMm;
      if (!active(a) || !active(b)) continue;
      const min = [...p] as Vec3, max = [...p] as Vec3; min[1] = bottom; max[1] = top;
      for (const [wall, frame, axis] of [[a, fa, ax], [b, fb, bx]] as const) {
        const distance = Math.max(0, Math.min(wall.widthMm - epsilon, wall === a ? da : db));
        const zone = wall.finishZones.find(z => distance >= z.x - epsilon && distance <= z.x + z.width && y >= wall.originMm[1] + z.y && y <= wall.originMm[1] + z.y + z.height);
        const front = wall.originMm[axis] + frame.n[axis] * (zone?.offsetMm ?? 0), back = wall.originMm[axis] + frame.n[axis] * (zone?.backMm ?? -wall.thicknessMm);
        min[axis] = Math.min(front, back); max[axis] = Math.max(front, back);
      }
      // Subtract existing solids in 3D; no duplicate coplanar faces are introduced.
      let pending: Bounds[] = [{ owner: `join-${a.id}-${b.id}-${bottom}`, min, max }];
      for (const existing of [...bodies, ...openings, ...result]) pending = pending.flatMap(box => subtractBox(box, existing));
      result.push(...pending.map(box => ({ ...box, floorId: a.floorId })));
    }
  }
  return result;
}

export function subtractBox(box: Bounds, mask: Bounds): Bounds[] {
  const low = box.min.map((n, i) => Math.max(n, mask.min[i])) as Vec3, high = box.max.map((n, i) => Math.min(n, mask.max[i])) as Vec3;
  if (low.some((n, i) => high[i] - n <= epsilon)) return [box];
  const core = { min: [...box.min] as Vec3, max: [...box.max] as Vec3 }, pieces: Bounds[] = [];
  for (let axis = 0; axis < 3; axis++) {
    if (low[axis] - core.min[axis] > epsilon) { const end = [...core.max] as Vec3; end[axis] = low[axis]; pieces.push({ owner: box.owner, min: [...core.min], max: end }); core.min[axis] = low[axis]; }
    if (core.max[axis] - high[axis] > epsilon) { const start = [...core.min] as Vec3; start[axis] = high[axis]; pieces.push({ owner: box.owner, min: start, max: [...core.max] }); core.max[axis] = high[axis]; }
  }
  return pieces;
}

export const stepPatches = stepShells(config.parts);
