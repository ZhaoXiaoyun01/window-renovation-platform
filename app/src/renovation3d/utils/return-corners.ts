import { mergeCoplanarFaces, projectRects } from './coplanar-faces.ts';
import { buildingBodies, dot, wallFrame } from './geometry.ts';
import { rectUnion } from './outline.ts';
import { faceBodyMasks } from './surface-intersections.ts';
import type { Part, Rect, Wall, WallFace } from '../types';

// Perpendicular returns stop at bare-wall endpoints, while their finish planes
// move by the tile depth. Continue both strips to their common finished corner.
export function joinReturnCorners(faces: WallFace[], walls: Wall[], parts: Part[], tileDepthMm: number, levels: number[]): WallFace[] {
  const byId = new Map(walls.map(wall => [wall.id, wall])), bodies = buildingBodies(walls, parts);
  const additions: WallFace[] = [];
  for (const anchor of faces) {
    if (Math.abs(wallFrame(anchor).n[1]) < .99) continue;
    const sources = faces.filter(face => face.floorId === anchor.floorId && dot(wallFrame(face).n, wallFrame(anchor).n) > .99
      && Math.abs(face.originMm[1] - anchor.originMm[1]) < 1e-5);
    // Each plane is processed once, including pieces already in one logical face.
    if (sources[0] !== anchor) continue;
    const strips = sources.flatMap(face => face.members.flatMap(member => {
      const wall = byId.get(member.wallId);
      if (wall?.surfaceKind !== 'relief-return' || !wall.rotationX) return [];
      const backing = byId.get(wall.finishSourceFaceId?.split(':face:')[0] ?? '');
      return backing ? projectRects(face, anchor, member.rects).map(rect => ({ rect, normal: wallFrame(backing).n })) : [];
    }));
    const bridges: Rect[] = [];
    for (const row of strips.filter(s => s.rect.width > s.rect.height)) for (const col of strips.filter(s => s.rect.height > s.rect.width)) {
      if (Math.abs(dot(row.normal, col.normal)) > .01) continue;
      const a = row.rect, b = col.rect;
      const dx = Math.min(Math.abs(a.x + a.width - b.x), Math.abs(b.x + b.width - a.x));
      const dy = Math.min(Math.abs(b.y + b.height - a.y), Math.abs(a.y + a.height - b.y));
      if (dx > tileDepthMm + 1e-5 || dy > tileDepthMm + 1e-5) continue;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      bridges.push({ x, y: a.y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: a.height },
        { x: b.x, y, width: b.width, height: Math.max(a.y + a.height, b.y + b.height) - y });
    }
    const masks = [...faceBodyMasks(anchor, bodies), ...sources.flatMap(face => projectRects(face, anchor, rectUnion(face.rects, face.holes)))];
    const rects = rectUnion(bridges, masks);
    if (!rects.length) continue;
    const member = anchor.members[0], zone = member.zones[0];
    additions.push({ ...anchor, rects, holes: [], zones: rects.map(rect => ({ ...zone, ...rect })),
      members: [{ ...member, rects, holes: [], zones: rects.map(rect => ({ ...zone, ...rect })) }] });
  }
  return mergeCoplanarFaces([...faces, ...additions], walls, levels);
}
