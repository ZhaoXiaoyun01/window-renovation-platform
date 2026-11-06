import { intersect } from '../tile-layout/layout.ts';
import { rectUnion } from './outline.ts';
import { dot, rounded, wallFrame } from './geometry.ts';
import type { Rect, Vec3, Wall, WallFace } from '../types';

const bounds = (rs: Rect[]) => {
  const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
  return { x, y, width: Math.max(...rs.map(r => r.x + r.width)) - x, height: Math.max(...rs.map(r => r.y + r.height)) - y };
};
const touches = (a: Rect, b: Rect) => {
  const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return x > 1e-5 && y >= -1e-5 || y > 1e-5 && x >= -1e-5;
};
export function projectRects(face: WallFace, anchor: WallFace, rects: Rect[]): Rect[] {
  const a = wallFrame(anchor), b = wallFrame(face), d = face.originMm.map((v, i) => v - anchor.originMm[i]);
  return rects.map(r => bounds([r.x, r.x + r.width].flatMap(x => [r.y, r.y + r.height].map(y => ({
    x: rounded(dot(d, a.u) + x * dot(b.u, a.u) + y * dot(b.v, a.u)),
    y: rounded(dot(d, a.v) + x * dot(b.u, a.v) + y * dot(b.v, a.v)), width: 0, height: 0,
  })))));
}

// Union by physical plane and storey band. Source kind, facade label and display
// group are metadata; they must not create another selectable seam.
export function mergeCoplanarFaces(faces: WallFace[], walls: Wall[], levels: number[], floorIds?: string[]): WallFace[] {
  const groups = new Map<string, WallFace[]>(), byId = new Map(walls.map(w => [w.id, w])), used = new Set<string>();
  for (const face of faces) {
    const { n } = wallFrame(face), rects = rectUnion(face.rects, face.holes), box = bounds(rects);
    const axes = wallFrame(face), centerY = face.originMm[1] + (box.x + box.width / 2) * axes.u[1] + (box.y + box.height / 2) * axes.v[1];
    const band = Math.abs(n[1]) < .99 ? levels.filter(y => y < centerY - 1e-5).length : 0;
    const floorId = floorIds && Math.abs(n[1]) < .99 ? floorIds[Math.min(band, floorIds.length - 1)] : face.floorId;
    const key = `${floorId}:${n.map(rounded)}:${rounded(dot(n, face.originMm) + face.offsetMm)}:${band}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...face, floorId }]);
  }
  return [...groups.values()].flatMap(group => {
    group.sort((a, b) => Number(!!byId.get(b.wallId)?.tileGridDatum) - Number(!!byId.get(a.wallId)?.tileGridDatum) || a.id.length - b.id.length || a.id.localeCompare(b.id));
    const anchor = group[0], { u, v } = wallFrame(anchor);
    const projected = group.map(face => ({ face, rects: projectRects(face, anchor, face.rects), solids: projectRects(face, anchor, rectUnion(face.rects, face.holes)) }));
    const solids = rectUnion(projected.flatMap(p => p.solids)), remaining = new Set(solids.map((_, i) => i)), components: Rect[][] = [];
    while (remaining.size) {
      const queue = [remaining.values().next().value!], component: Rect[] = []; remaining.delete(queue[0]);
      while (queue.length) {
        const i = queue.pop()!; component.push(solids[i]);
        for (const j of remaining) if (touches(solids[i], solids[j])) { remaining.delete(j); queue.push(j); }
      }
      components.push(component);
    }
    return components.map(component => {
      const box = bounds(component), shift = <T extends Rect>(r: T): T => ({ ...r, x: rounded(r.x - box.x), y: rounded(r.y - box.y) });
      const owners = projected.filter(p => p.solids.some(r => component.some(s => intersect(r, s))));
      const primary = owners[0].face, gross = rectUnion(owners.flatMap(p => p.rects).flatMap(r => { const p = intersect(r, box); return p ? [p] : []; }));
      const members: WallFace['members'] = []; let claimed: Rect[] = [];
      for (const owner of owners) for (const member of owner.face.members) {
        const source = projectRects(owner.face, anchor, rectUnion(member.rects, [...member.holes, ...owner.face.holes]));
        const owned = rectUnion(source.flatMap(r => component.flatMap(s => { const p = intersect(r, s); return p ? [p] : []; })), claimed);
        if (!owned.length) continue;
        claimed = rectUnion([...claimed, ...owned]);
        const zones = member.zones.flatMap(zone => projectRects(owner.face, anchor, [zone]).flatMap(r => owned.flatMap(s => { const p = intersect(r, s); return p ? [{ ...zone, ...shift(p), offsetMm: anchor.offsetMm }] : []; })));
        const d = owner.face.originMm.map((a, i) => a - anchor.originMm[i]);
        members.push({ ...member, viewGroup: byId.get(member.wallId)?.viewGroup, rects: owned.map(shift), holes: [], zones,
          shiftMm: [member.shiftMm[0] + dot(d, u) - box.x, member.shiftMm[1] + dot(d, v) - box.y] });
      }
      const id = used.has(primary.id) ? `${primary.id}:coplanar:${box.x}:${box.y}` : primary.id; used.add(id);
      const viewGroup = members.every(m => m.viewGroup === 'terrace') ? 'terrace' as const : undefined;
      return { ...primary, id, viewGroup, rotationX: anchor.rotationX, rotationY: anchor.rotationY, offsetMm: anchor.offsetMm, originMm: anchor.originMm.map((a, i) => rounded(a + u[i] * box.x + v[i] * box.y)) as Vec3,
        gridBoundsMm: { x: 0, y: 0, width: box.width, height: box.height }, rects: gross.map(shift), holes: rectUnion(gross, component).map(shift),
        members, zones: members.flatMap(m => m.zones), sourceWallIds: [...new Set(members.map(m => m.wallId))], mergedFaceIds: [...new Set(owners.map(p => p.face.id))] };
    });
  }).sort((a, b) => a.id.localeCompare(b.id));
}
