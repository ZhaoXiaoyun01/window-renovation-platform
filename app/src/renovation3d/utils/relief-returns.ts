import { clipHoles, intersect } from '../tile-layout/layout.ts';
import type { Rect, Vec3, Wall } from '../types';

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const dot = (a: Vec3, b: Vec3) => a.reduce((sum, n, i) => sum + n * b[i], 0);
type Surface = { wall: Wall; rect: Rect; depth: number; materialId: string; u: Vec3; n: Vec3 };

// Close steps between adjacent finish planes, including floor transitions.
export function reliefReturns(walls: Wall[], tileDepthMm: number, reliefMm: number): Wall[] {
  const groups = new Map<string, Surface[]>();
  for (const wall of walls) {
    if (wall.surfaceOnly || wall.surfaceKind === 'inner-wall' || wall.rotationX) continue;
    const u: Vec3 = [round(Math.cos(wall.rotationY)), 0, round(-Math.sin(wall.rotationY))];
    const n: Vec3 = [round(Math.sin(wall.rotationY)), 0, round(Math.cos(wall.rotationY))], key = n.join(':');
    const items = groups.get(key) ?? [];
    for (const zone of wall.finishZones) for (const rect of clipHoles(zone, [...wall.openings, ...(wall.surfaceCuts ?? [])])) items.push({ wall,
      rect: { ...rect, x: round(rect.x + dot(wall.originMm, u)), y: round(rect.y + wall.originMm[1]) },
      depth: round(dot(wall.originMm, n) + zone.offsetMm), materialId: zone.materialId, u, n });
    groups.set(key, items);
  }
  type Step = { high: Surface; axis: 'v' | 'h'; coordinate: number; sign: number; low: number; intervals: [number, number][] };
  const steps = new Map<string, Step>();
  for (const surfaces of groups.values()) for (let i = 0; i < surfaces.length; i++) for (const other of surfaces.slice(i + 1)) {
    const first = surfaces[i];
    if (Math.abs(Math.abs(first.depth - other.depth) - reliefMm) > 1e-6) continue;
    const high = first.depth > other.depth ? first : other, low = first.depth > other.depth ? other : first;
    const a = high.rect, b = low.rect;
    const add = (axis: 'v' | 'h', coordinate: number, sign: number, start: number, end: number) => {
      if (end - start < 1e-6) return;
      const key = [high.wall.id, axis, coordinate, sign, high.depth, low.depth, high.materialId].join(':');
      const step = steps.get(key) ?? { high, axis, coordinate, sign, low: low.depth, intervals: [] };
      step.intervals.push([start, end]); steps.set(key, step);
    };
    if (Math.abs(a.x + a.width - b.x) < 1e-6) add('v', b.x, 1, Math.max(a.y, b.y), Math.min(a.y + a.height, b.y + b.height));
    if (Math.abs(b.x + b.width - a.x) < 1e-6) add('v', a.x, -1, Math.max(a.y, b.y), Math.min(a.y + a.height, b.y + b.height));
    if (Math.abs(a.y + a.height - b.y) < 1e-6) add('h', b.y, 1, Math.max(a.x, b.x), Math.min(a.x + a.width, b.x + b.width));
    if (Math.abs(b.y + b.height - a.y) < 1e-6) add('h', a.y, -1, Math.max(a.x, b.x), Math.min(a.x + a.width, b.x + b.width));
  }
  const result = [...steps.values()].flatMap(step => {
    const intervals: [number, number][] = [];
    for (const interval of step.intervals.sort((a, b) => a[0] - b[0])) {
      const last = intervals[intervals.length - 1];
      if (last && interval[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], interval[1]);
      else intervals.push([...interval]);
    }
    return intervals.map(([start, end]): Wall => {
      const { high, low, axis, coordinate, sign } = step, { u, n } = high;
      const point = (x: number, y: number, depth: number): Vec3 => [round(u[0] * x + n[0] * depth), y, round(u[2] * x + n[2] * depth)];
      let originMm: Vec3, rotationX = 0, rotationY = 0, widthMm: number, heightMm: number;
      if (axis === 'v') {
        originMm = point(coordinate, start, (sign > 0 ? high.depth : low) + tileDepthMm);
        rotationY = high.wall.rotationY + sign * Math.PI / 2; widthMm = high.depth - low; heightMm = end - start;
      } else {
        const corners = [point(start, coordinate, low + tileDepthMm), point(end, coordinate, high.depth + tileDepthMm)];
        const minX = Math.min(...corners.map(p => p[0])), minZ = Math.min(...corners.map(p => p[2])), maxZ = Math.max(...corners.map(p => p[2]));
        originMm = [minX, coordinate, sign > 0 ? maxZ : minZ]; rotationX = -sign * Math.PI / 2;
        widthMm = Math.max(...corners.map(p => p[0])) - minX; heightMm = maxZ - minZ;
      }
      const localPoint: [number, number] = axis === 'v'
        ? [coordinate - dot(high.wall.originMm, u) - sign * 0.01, (start + end) / 2 - high.wall.originMm[1]]
        : [(start + end) / 2 - dot(high.wall.originMm, u), coordinate - high.wall.originMm[1] - sign * 0.01];
      return { id: `relief-${high.wall.id}-${axis}-${coordinate}-${sign}-${start}-${end}`, floorId: high.wall.floorId, viewGroup: high.wall.viewGroup, facade: high.wall.facade,
        originMm, rotationX, rotationY, widthMm: round(widthMm), heightMm: round(heightMm), thicknessMm: 1, claddingMm: 0,
        surfaceOnly: true, surfaceKind: 'relief-return', openings: [],
        finishSourceFaceId: `${high.wall.id}:face:${round(high.depth - dot(high.wall.originMm, high.n))}`, finishSourcePointMm: localPoint,
        evidence: { ...high.wall.evidence, note: '相邻装修面的60mm实体高差返边，沿实际交界及洞口裁开；节点构造待复核。' },
        finishZones: [{ x: 0, y: 0, width: round(widthMm), height: round(heightMm), offsetMm: 0, materialId: high.materialId }] };
    });
  });
  // Horizontal returns meet at corners; assign overlapping patches once.
  const occupied = new Map<string, Rect[]>();
  return result.sort((a, b) => a.id.localeCompare(b.id)).filter(wall => {
    if (!wall.rotationX) return true;
    const up = wall.rotationX < 0, key = `${wall.floorId}:${wall.originMm[1]}:${up}`;
    const rect = { x: wall.originMm[0], y: up ? wall.originMm[2] - wall.heightMm : wall.originMm[2], width: wall.widthMm, height: wall.heightMm };
    const previous = occupied.get(key) ?? [];
    if (!clipHoles(rect, previous).length) return false;
    wall.surfaceCuts = previous.flatMap(old => {
      const cut = intersect(rect, old);
      return cut ? [{ x: cut.x - wall.originMm[0], y: up ? wall.originMm[2] - cut.y - cut.height : cut.y - wall.originMm[2], width: cut.width, height: cut.height }] : [];
    });
    occupied.set(key, [...previous, rect]); return true;
  });
}
