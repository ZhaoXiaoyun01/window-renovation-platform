import { intersect } from '../tile-layout/layout.ts';
import { rectUnion, type OutlineSegment } from './outline.ts';
import { boxCorners, buildingBodies, dot, planeRect, pointBounds, rounded, wallFrame, type Bounds } from './geometry.ts';
import type { Part, Rect, Vec3, Wall, WallFace } from '../types';

const solids = (f: WallFace) => rectUnion(f.rects, f.holes);
const axisOf = (n: Vec3) => n.findIndex(a => Math.abs(a) > 0.99);
const boundsRect = (rs: Rect[]) => {
  const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
  return { x, y, width: Math.max(...rs.map(r => r.x + r.width)) - x, height: Math.max(...rs.map(r => r.y + r.height)) - y };
};
export function faceBodyMasks(face: WallFace, bodies: Bounds[]): Rect[] {
  const { u, v, n } = wallFrame(face);
  return bodies.filter(b => !face.sourceWallIds.includes(b.owner)).flatMap(body => {
    const local = pointBounds(boxCorners(body).map(p => {
      const d = p.map((a, i) => a - face.originMm[i]); return [dot(d, u), dot(d, v), dot(d, n)] as Vec3;
    }));
    return local.min[2] <= face.offsetMm + 1e-5 && local.max[2] > face.offsetMm + 1e-5
      ? [{ x: local.min[0], y: local.min[1], width: local.max[0] - local.min[0], height: local.max[1] - local.min[1] }] : [];
  });
}
function clipFace(face: WallFace, rects: Rect[]): WallFace {
  const clip = <T extends Rect>(r: T): T[] => rects.flatMap(mask => { const p = intersect(r, mask); return p ? [{ ...r, ...p }] : []; });
  const members = face.members.flatMap(member => {
    const rs = rectUnion(member.rects.flatMap(clip));
    return rs.length ? [{ ...member, rects: rs, holes: member.holes.flatMap(clip), zones: member.zones.flatMap(clip) }] : [];
  });
  return { ...face, rects, holes: face.holes.flatMap(clip), members, zones: members.flatMap(m => m.zones), sourceWallIds: [...new Set(members.map(m => m.wallId))] };
}
// Use finite patches: distant planes and the edges of a wall's own caps do not split it.
export function faceIntersectionLines(a: WallFace, b: WallFace): OutlineSegment[] {
  const fa = wallFrame(a), fb = wallFrame(b), i = axisOf(fa.n), j = axisOf(fb.n);
  if (i < 0 || j < 0 || i === j) return [];
  const k = 3 - i - j;
  const local = (p: Vec3): [number, number] => {
    const d = p.map((n, axis) => n - a.originMm[axis]); return [rounded(dot(d, fa.u)), rounded(dot(d, fa.v))];
  };
  return solids(a).flatMap(ar => {
    const ab = planeRect(a, ar, a.offsetMm);
    return solids(b).flatMap(br => {
      const bb = planeRect(b, br, b.offsetMm), start = Math.max(ab.min[k], bb.min[k]), end = Math.min(ab.max[k], bb.max[k]);
      if (end - start < 1e-5 || bb.min[j] <= ab.min[j] + 1e-5 || bb.min[j] >= ab.max[j] - 1e-5 || ab.min[i] < bb.min[i] - 1e-5 || ab.min[i] > bb.max[i] + 1e-5) return [];
      const p: Vec3 = [0, 0, 0]; p[i] = ab.min[i]; p[j] = bb.min[j]; p[k] = start;
      const q = [...p] as Vec3; q[k] = end;
      return [[local(p), local(q)] as OutlineSegment];
    });
  });
}
function partition(face: WallFace, lines: OutlineSegment[]): WallFace[] {
  let cells = solids(face);
  for (const [a, b] of lines) cells = cells.flatMap(r => {
    const xs = [...new Set([r.x, r.x + r.width, ...[a[0], b[0]].filter(x => x > r.x && x < r.x + r.width)])].sort((x, y) => x - y);
    const ys = [...new Set([r.y, r.y + r.height, ...[a[1], b[1]].filter(y => y > r.y && y < r.y + r.height)])].sort((x, y) => x - y);
    return xs.slice(0, -1).flatMap((x, i) => ys.slice(0, -1).map((y, j) => ({ x, y, width: xs[i + 1] - x, height: ys[j + 1] - y })));
  });
  const connected = (a: Rect, b: Rect) => {
    const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (dx > 1e-5 && dy > 1e-5) return true;
    if (dx < -1e-5 || dy < -1e-5 || dx <= 1e-5 && dy <= 1e-5) return false;
    const vertical = dx <= 1e-5, edge = vertical ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const start = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x), end = start + (vertical ? dy : dx);
    return !lines.some(([p, q]) => Math.abs((vertical ? p[0] : p[1]) - edge) < 1e-5 && Math.abs((vertical ? q[0] : q[1]) - edge) < 1e-5
      && Math.min(vertical ? Math.max(p[1], q[1]) : Math.max(p[0], q[0]), end) - Math.max(vertical ? Math.min(p[1], q[1]) : Math.min(p[0], q[0]), start) > 1e-5);
  };
  const remaining = new Set(cells.map((_, i) => i)), groups: Rect[][] = [];
  while (remaining.size) {
    const queue = [remaining.values().next().value!], group: Rect[] = []; remaining.delete(queue[0]);
    while (queue.length) {
      const i = queue.pop()!; group.push(cells[i]);
      for (const j of remaining) if (connected(cells[i], cells[j])) { remaining.delete(j); queue.push(j); }
    }
    groups.push(group);
  }
  return groups.sort((a, b) => boundsRect(a).x - boundsRect(b).x || boundsRect(a).y - boundsRect(b).y).map((rs, i) => {
    const r = boundsRect(rs), holes = face.holes.flatMap(h => { const p = intersect(h, r); return p ? [p] : []; });
    return { ...clipFace(face, rectUnion([...rs, ...holes])), id: i ? `${face.id}:junction:${r.x}:${r.y}` : face.id,
      legacyFaceIds: [...new Set([face.id, ...(face.legacyFaceIds ?? []), ...(face.legacyFaceId ? [face.legacyFaceId] : [])])] };
  });
}
export function selectionIntersectionLines(a: WallFace, b: WallFace, parts: Part[]): OutlineSegment[] {
  // Slab undersides are construction thickness, not another facade selection seam.
  const horizontal = Math.abs(wallFrame(b).n[1]) > 0.99;
  const elevation = b.originMm[1] + wallFrame(b).n[1] * b.offsetMm;
  if (Math.abs(wallFrame(a).n[1]) < 1e-5 && horizontal && parts.some(part => part.kind === 'slab'
    && Math.abs(elevation - (part.centerMm[1] - part.sizeMm[1] / 2)) < 1e-5)) return [];
  const lines = faceIntersectionLines(a, b);
  if (Math.abs(wallFrame(a).n[1]) > 1e-5 || a.surfaceKind === 'exposed-surface' || a.surfaceKind === 'relief-return') return lines;
  return lines.filter(([p, q]) => !parts.some(part => part.kind === 'slab'
    && Math.min(p[1], q[1]) + a.originMm[1] >= part.centerMm[1] - part.sizeMm[1] / 2 - 1e-5
    && Math.max(p[1], q[1]) + a.originMm[1] <= part.centerMm[1] + part.sizeMm[1] / 2 + 1e-5));
}
export function intersectedFaces(faces: WallFace[], walls: Wall[], parts: Part[], slabSeams = false): WallFace[] {
  const bodies = buildingBodies(walls, parts);
  const byId = new Map(walls.map(wall => [wall.id, wall]));
  const visible = faces.flatMap(face => {
    const clipped = clipFace(face, rectUnion(face.rects, faceBodyMasks(face, bodies)));
    if (!solids(clipped).length) return [];
    if (!['exposed-surface', 'relief-return'].includes(face.surfaceKind ?? '')) return [clipped];
    // Coplanar caps must stop where their backing walls turn. Otherwise a ring
    // reconnects around a finite intersection and remains one selectable face.
    const groups = new Map<string, Rect[]>();
    for (const member of clipped.members) {
      const sourceId = byId.get(member.wallId)?.finishSourceFaceId?.split(':face:')[0];
      const source = sourceId ? byId.get(sourceId) : undefined;
      const key = source ? wallFrame(source).n.map(rounded).join(':') : 'surface';
      groups.set(key, [...(groups.get(key) ?? []), ...member.rects]);
    }
    return [...groups.values()].map(rects => clipFace(clipped, rectUnion(rects, clipped.holes)))
      .filter(f => solids(f).length).sort((a, b) => boundsRect(a.rects).x - boundsRect(b.rects).x || boundsRect(a.rects).y - boundsRect(b.rects).y)
      .map((f, i) => { const r = boundsRect(f.rects); return { ...f, id: i ? `${face.id}:junction:${r.x}:${r.y}` : face.id,
        legacyFaceIds: [...new Set([face.id, ...(face.legacyFaceIds ?? [])])] }; });
  });
  return visible.flatMap(face => partition(face, visible.filter(other => other !== face).flatMap(other => slabSeams ? faceIntersectionLines(face, other) : selectionIntersectionLines(face, other, parts))));
}

// A storey joint is also an independent selection boundary, including roof parapets.
export function splitAtLevels(faces: WallFace[], elevations: number[]): WallFace[] {
  return faces.flatMap(face => {
    if (Math.abs(face.rotationX ?? 0) > 1e-6) return [face];
    const lines = [...new Set(elevations)].flatMap(level => {
      const y = level - face.originMm[1];
      return y > 1e-5 && y < face.gridBoundsMm.height - 1e-5
        ? [[ [0, y], [face.gridBoundsMm.width, y] ] as OutlineSegment] : [];
    });
    return lines.length ? partition(face, lines) : [face];
  });
}
