import { intersect } from '../tile-layout/layout.ts';
import { rectUnion } from './outline.ts';
import { dot, wallFrame } from './geometry.ts';
import type { Finish, Rect, RenovationState, WallFace } from '../types';

// Keep retired slab strips as material regions, while selecting the merged face once.
export function retainPreviousRegions(faces: WallFace[], previous: WallFace[]): WallFace[] {
  return faces.map(face => {
    const { n, u, v } = wallFrame(face), plane = dot(n, face.originMm) + face.offsetMm;
    const patches = previous.flatMap(old => {
      if (old.floorId !== face.floorId || old.viewGroup !== face.viewGroup || dot(n, wallFrame(old).n) < .99
        || Math.abs(dot(n, old.originMm) + old.offsetMm - plane) > 1e-5) return [];
      const delta = old.originMm.map((value, i) => value - face.originMm[i]), dx = dot(delta, u), dy = dot(delta, v);
      const move = <T extends Rect>(r: T): T => ({ ...r, x: r.x + dx, y: r.y + dy });
      const clip = <T extends Rect>(r: T): T[] => face.rects.flatMap(mask => { const p = intersect(move(r), mask); return p ? [{ ...r, ...p }] : []; });
      const solids = rectUnion(old.rects, old.holes).flatMap(clip);
      if (!rectUnion(solids, face.holes).length) return [];
      return [{ old, members: old.members.flatMap((member, i) => {
        const rects = rectUnion(member.rects.flatMap(clip));
        return rects.length ? [{ ...member, rects, holes: member.holes.flatMap(clip), zones: member.zones.flatMap(clip),
          shiftMm: [member.shiftMm[0] + dx, member.shiftMm[1] + dy] as [number, number],
          sourceFaceId: `${old.id}:legacy:${i}`, previousFaceId: old.id, previousSourceFaceId: member.sourceFaceId }] : [];
      }) }];
    });
    return patches.length > 1 ? { ...face, members: patches.flatMap(p => p.members) } : face;
  });
}

export function upgradeFaceGrouping(state: RenovationState, faces: WallFace[]): RenovationState {
  const faceFinishes = { ...state.faceFinishes }, faceRegionFinishes = { ...state.faceRegionFinishes };
  for (const face of faces) {
    if (!face.members.some(m => m.previousFaceId)) continue;
    const overrides = face.members.map(member => state.faceFinishes?.[member.previousFaceId!]);
    for (const member of face.members) {
      delete faceFinishes[member.previousFaceId!];
      const finish = state.faceFinishes?.[member.previousFaceId!] ?? state.faceRegionFinishes?.[member.previousSourceFaceId!];
      if (finish) faceRegionFinishes[member.sourceFaceId] = { ...finish, preserveZoning: false };
    }
    if (overrides.every(f => f && JSON.stringify(f) === JSON.stringify(overrides[0]))) {
      faceFinishes[face.id] = { ...overrides[0] } as Finish;
      for (const member of face.members) delete faceRegionFinishes[member.sourceFaceId];
    }
  }
  return { ...state, faceFinishes, faceRegionFinishes, faceGroupingVersion: 7 };
}
