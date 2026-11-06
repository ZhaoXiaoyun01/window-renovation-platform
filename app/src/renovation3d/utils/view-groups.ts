import { rectUnion } from './outline.ts';
import type { RenovationState, Wall, WallFace } from '../types';

export function isObjectVisible(object: Pick<Wall, 'floorId' | 'viewGroup'> & Partial<Pick<WallFace, 'members' | 'mergedFaceIds'>>, state: Pick<RenovationState, 'hiddenFloors' | 'hiddenGroups'>): boolean {
  if (object.mergedFaceIds) return object.members!.some(member => isObjectVisible({ floorId: object.floorId, viewGroup: member.viewGroup }, state));
  return object.viewGroup ? !state.hiddenGroups?.includes(object.viewGroup) : !state.hiddenFloors.includes(object.floorId);
}
export function matchesViewScope(object: Pick<Wall, 'floorId' | 'viewGroup'> & Partial<Pick<WallFace, 'members' | 'mergedFaceIds'>>, scope: string): boolean {
  if (object.mergedFaceIds) return object.members!.some(member => matchesViewScope({ floorId: object.floorId, viewGroup: member.viewGroup }, scope));
  return scope === 'all' || (object.viewGroup ?? object.floorId) === scope;
}

export function visibleFace(face: WallFace, state: Pick<RenovationState, 'hiddenFloors' | 'hiddenGroups'>): WallFace | undefined {
  if (!face.mergedFaceIds) return isObjectVisible(face, state) ? face : undefined;
  const members = face.members.filter(m => isObjectVisible({ floorId: face.floorId, viewGroup: m.viewGroup }, state));
  if (!members.length) return;
  if (members.length === face.members.length) return face;
  const solids = rectUnion(members.flatMap(m => m.rects));
  return { ...face, members, holes: rectUnion(face.rects, solids), zones: members.flatMap(m => m.zones) };
}

// Split coplanar room/terrace members without moving the geometry or UV datum.
export function splitViewGroups(faces: WallFace[], walls: Wall[]): WallFace[] {
  const byId = new Map(walls.map(wall => [wall.id, wall]));
  return faces.flatMap(face => {
    const groups = new Map<string, WallFace['members']>();
    for (const member of face.members) {
      const key = byId.get(member.wallId)?.viewGroup ?? 'floor';
      groups.set(key, [...(groups.get(key) ?? []), member]);
    }
    const entries = [...groups.entries()].flatMap(([key, members]) => {
      const rects = members.flatMap(member => member.rects);
      const solids = rectUnion(members.flatMap(member => rectUnion(member.rects, [...member.holes, ...face.holes])));
      return solids.length ? [{ key, members, rects, solids }] : [];
    });
    const preferred = byId.get(face.wallId)?.viewGroup ?? 'floor';
    const primary = entries.some(entry => entry.key === preferred) ? preferred : entries[0]?.key;
    return entries.map(({ key, members, rects, solids }) => {
      const child = key !== primary, viewGroup = key === 'terrace' ? 'terrace' as const : undefined;
      return { ...face, viewGroup, id: child ? `${face.id}:view:${key}` : face.id, wallId: members[0].wallId, facade: byId.get(members[0].wallId)!.facade,
        rects, holes: rectUnion(rects, solids), members, zones: members.flatMap(member => member.zones),
        sourceWallIds: [...new Set(members.map(member => member.wallId))],
        legacyFaceIds: entries.length > 1 ? [...new Set([face.id, ...(face.legacyFaceIds ?? [])])] : face.legacyFaceIds };
    });
  });
}
