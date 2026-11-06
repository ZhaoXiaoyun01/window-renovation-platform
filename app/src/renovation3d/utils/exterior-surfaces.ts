import { clipHoles, intersect } from '../tile-layout/layout.ts';
import { rectUnion } from './outline.ts';
import { openingOffset } from './opening-placement.ts';
import type { Facade, Part, Rect, Vec3, Wall } from '../types';

type Box = { viewGroup?: Wall['viewGroup']; min: Vec3; max: Vec3; owner: string; floorId: string; facade: Facade; materialId: string; back?: Vec3; source?: string; point?: [number, number]; occluder?: boolean };
type Patch = { n: Vec3; plane: number; points: Vec3[] };
type HorizontalMasks = Record<string, { top: Rect[]; bottom: Rect[] }>;
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const frame = (wall: Wall) => {
  const x = wall.rotationX ?? 0, y = wall.rotationY;
  return { u: [Math.cos(y), Math.sin(x) * Math.sin(y), -Math.cos(x) * Math.sin(y)] as Vec3,
    v: [0, Math.cos(x), Math.sin(x)] as Vec3, n: [Math.sin(y), -Math.sin(x) * Math.cos(y), Math.cos(x) * Math.cos(y)] as Vec3 };
};
const directions = [
  { name: 'east', n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], y: Math.PI / 2, x: 0 },
  { name: 'west', n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], y: -Math.PI / 2, x: 0 },
  { name: 'south', n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], y: 0, x: 0 },
  { name: 'north', n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], y: Math.PI, x: 0 },
  { name: 'top', n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], y: 0, x: -Math.PI / 2 },
  { name: 'bottom', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], y: 0, x: Math.PI / 2 },
] as const;
const corners = (box: { min: Vec3; max: Vec3 }) => Array.from({ length: 8 }, (_, i) => box.min.map((n, k) => i & (1 << k) ? box.max[k] : n) as Vec3);
function project(points: Vec3[], u: readonly number[], v: readonly number[]): Rect {
  const xs = points.map(p => dot(p, [...u])), ys = points.map(p => dot(p, [...v]));
  const x = round(Math.min(...xs)), y = round(Math.min(...ys));
  return { x, y, width: round(Math.max(...xs) - x), height: round(Math.max(...ys) - y) };
}

// Extract only exposed masonry boundaries. Neighbouring solids and existing
// finishes clip the result, so hidden interfaces and duplicate skins are not counted.
export function exteriorSurfaces(walls: Wall[], parts: Part[], groundMm: number, masks: HorizontalMasks): Wall[] {
  const boxes: Box[] = [], patches: Patch[] = [];
  for (const wall of walls) {
    const { u, v, n } = frame(wall);
    const world = (x: number, y: number, z: number) => wall.originMm.map((a, i) => round(a + u[i] * x + v[i] * y + n[i] * z)) as Vec3;
    const bounds = (vertices: Vec3[]) => ({ min: [0, 1, 2].map(i => Math.min(...vertices.map(p => p[i]))) as Vec3,
      max: [0, 1, 2].map(i => Math.max(...vertices.map(p => p[i]))) as Vec3 });
    // Frames fill these openings; surfaces behind the frame/glass are room interiors.
    for (const opening of wall.openings.filter(o => o.kind !== 'balcony')) {
      const vertices = [-wall.thicknessMm, openingOffset(wall, opening)].flatMap(z => [[opening.x, opening.y], [opening.x + opening.width, opening.y], [opening.x, opening.y + opening.height], [opening.x + opening.width, opening.y + opening.height]].map(([x, y]) => world(x, y, z)));
      boxes.push({ ...bounds(vertices), owner: opening.id, floorId: wall.floorId, facade: wall.facade, materialId: '', occluder: true });
    }
    for (const zone of wall.finishZones) for (const rect of clipHoles(zone, [...wall.openings, ...(wall.surfaceCuts ?? [])])) {
      const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]].map(([x, y]) => world(x, y, zone.offsetMm));
      patches.push({ n, plane: dot(n, points[0]), points });
      if (wall.surfaceOnly) continue;
      const solid = intersect(rect, { x: 0, y: 0, width: wall.widthMm, height: wall.heightMm - (wall.topCoveredMm ?? 0) });
      if (!solid) continue;
      const vertices = [zone.offsetMm, zone.backMm ?? -wall.thicknessMm].flatMap(z => [[solid.x, solid.y], [solid.x + solid.width, solid.y], [solid.x, solid.y + solid.height], [solid.x + solid.width, solid.y + solid.height]].map(([x, y]) => world(x, y, z)));
      boxes.push({ ...bounds(vertices),
        owner: wall.id, floorId: wall.floorId, viewGroup: wall.viewGroup, facade: wall.facade, materialId: zone.materialId, back: n.map(a => -a) as Vec3,
        source: `${wall.id}:face:${zone.offsetMm}${zone.faceKey ? `:${zone.faceKey}` : ''}`, point: [solid.x + solid.width / 2, solid.y + solid.height / 2] });
    }
  }
  for (const part of parts.filter(p => p.kind !== 'rail' && p.kind !== 'screen')) boxes.push({ owner: part.id, floorId: part.floorId, viewGroup: part.viewGroup, facade: 'front', materialId: 'concrete',
    min: part.centerMm.map((a, i) => a - part.sizeMm[i] / 2) as Vec3, max: part.centerMm.map((a, i) => a + part.sizeMm[i] / 2) as Vec3 });
  const groups = new Map<string, { box: Box; direction: typeof directions[number]; plane: number; rects: Rect[] }>();
  for (const box of boxes.filter(b => !b.occluder)) for (const direction of directions) {
    const { n, u, v } = direction, axis = n.findIndex(a => a !== 0), sign = n[axis];
    if (box.back && dot(box.back, [...n]) > 0.99) continue; // Interior room backs are not exterior finishes.
    const coordinate = sign > 0 ? box.max[axis] : box.min[axis], plane = coordinate * sign;
    if (axis === 1 && (coordinate < groundMm || sign < 0 && coordinate === groundMm) || box.max[1] < groundMm) continue;
    const rectangle = project(corners(box), u, v);
    let solids = [rectangle];
    if (!box.source && axis === 1 && masks[box.owner]) {
      const allowed = direction.name === 'top' ? masks[box.owner].top : masks[box.owner].bottom;
      solids = allowed.flatMap(r => {
        const projected = project([[r.x, coordinate, r.y], [r.x + r.width, coordinate, r.y + r.height]], u, v);
        const clipped = intersect(rectangle, projected); return clipped ? [clipped] : [];
      });
    }
    const cuts = boxes.filter(other => other !== box && (sign > 0 ? other.min[axis] <= coordinate + 1e-5 && other.max[axis] > coordinate + 1e-5 : other.max[axis] >= coordinate - 1e-5 && other.min[axis] < coordinate - 1e-5))
      .map(other => project(corners(other), u, v));
    cuts.push(...patches.filter(p => dot(p.n, [...n]) > 0.99 && Math.abs(p.plane - plane) <= 8.01).map(p => project(p.points, u, v)));
    if (axis !== 1) cuts.push({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: Math.max(0, groundMm - rectangle.y) });
    solids = rectUnion(solids, cuts);
    if (!solids.length) continue;
    const key = `${box.owner}:${direction.name}:${round(plane)}`, group = groups.get(key) ?? { box, direction, plane, rects: [] };
    group.rects.push(...solids); groups.set(key, group);
  }
  const claimed = new Map<string, Rect[]>();
  return [...groups.values()].flatMap(({ box, direction, plane, rects }) => {
    const key = `${box.floorId}:${direction.name}:${round(plane)}`, previous = claimed.get(key) ?? [];
    const solids = rectUnion(rects, previous);
    if (!solids.length) return [];
    claimed.set(key, [...previous, ...solids]);
    const x = Math.min(...solids.map(r => r.x)), y = Math.min(...solids.map(r => r.y));
    const widthMm = Math.max(...solids.map(r => r.x + r.width)) - x, heightMm = Math.max(...solids.map(r => r.y + r.height)) - y;
    const local = solids.map(r => ({ ...r, x: r.x - x, y: r.y - y }));
    return [{ id: `exposed-${box.owner}-${direction.name}-${round(plane)}`, floorId: box.floorId, viewGroup: box.viewGroup, facade: box.facade,
      originMm: direction.n.map((a, i) => round(a * plane + direction.u[i] * x + direction.v[i] * y)) as Vec3,
      rotationX: direction.x, rotationY: direction.y, widthMm, heightMm, thicknessMm: 1, claddingMm: 1,
      surfaceOnly: true, surfaceKind: 'exposed-surface', openings: [], finishSourceFaceId: box.source, finishSourcePointMm: box.point,
      finishZones: [{ x: 0, y: 0, width: widthMm, height: heightMm, offsetMm: 0, materialId: box.materialId }], surfaceCuts: rectUnion([{ x: 0, y: 0, width: widthMm, height: heightMm }], local),
      evidence: { page: 0, status: 'pending' as const, note: '按配置实体边界生成的外露顶面、底面、板边或洞口侧面；已扣除邻接实体和已有装修面，节点尺寸待复核。' } } satisfies Wall];
  });
}
