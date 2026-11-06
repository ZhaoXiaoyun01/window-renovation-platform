import { buildingConfig as config } from '../config/building-config.ts';
import { buildingFaces } from './wall-surfaces.ts';
import { intersect } from '../tile-layout/layout.ts';
import { rectUnion } from './outline.ts';
import { buildingBodies, planeRect, wallFrame } from './geometry.ts';
import { faceBodyMasks } from './surface-intersections.ts';
import { cornerFillers } from './model-structure.ts';
import type { Part, Rect, WallFace } from '../types';

export const modelGroups = [{ id: 'base' as const, label: '底座', floorId: 'f1' }, ...config.viewGroups];
export const baseLevelMm = config.floors[0].elevationMm;
const epsilon = 1e-5;

function clipped(face: WallFace, masks: Rect[]): WallFace | undefined {
  const clip = <T extends Rect>(r: T): T[] => masks.flatMap(mask => { const p = intersect(r, mask); return p ? [{ ...r, ...p }] : []; });
  const members = face.members.flatMap(member => {
    const rects = member.rects.flatMap(clip);
    return rects.length ? [{ ...member, rects, holes: member.holes.flatMap(clip), zones: member.zones.flatMap(clip) }] : [];
  });
  if (!members.length) return;
  const rects = members.flatMap(member => member.rects), solids = rectUnion(rects, face.holes);
  if (!solids.length) return;
  return { ...face, rects, holes: rectUnion(rects, solids), members, zones: members.flatMap(member => member.zones), sourceWallIds: [...new Set(members.map(member => member.wallId))] };
}

// Keep revision 9 immutable for historical recovery. Only these exterior skins
// are selectable, editable and counted; structural closures never enter this list.
export function modelSurfaces(previous: WallFace[]): WallFace[] {
  return previous.flatMap(source => {
    let face = structuredClone(source);
    face.previousFaceId = source.id;
    const { n, v } = wallFrame(face), horizontal = Math.abs(n[1]) > .99;
    const slabCeiling = face.sourceWallIds.some(id => /^exposed-(f[234]|roof)-slab-bottom-/.test(id));
    // Eliminate all plate edge skins and room-wall construction caps.
    const members = face.members.filter(member => {
      if (/^exposed-(f[234]|roof)-slab-(east|west|north|south|top)-/.test(member.wallId)) return false;
      const wall = config.walls.find(w => w.id === member.wallId);
      if (horizontal && n[1] > 0 && wall?.surfaceKind === 'exposed-surface'
        && config.floors.some(f => Math.abs(face.originMm[1] - (f.elevationMm + f.heightMm - 180)) < epsilon)) return false;
      return true;
    });
    if (!members.length) return [];
    const solids = rectUnion(members.flatMap(member => rectUnion(member.rects, [...member.holes, ...face.holes])));
    face = { ...face, members, rects: solids, holes: [], zones: members.flatMap(m => m.zones), sourceWallIds: [...new Set(members.map(m => m.wallId))] };
    if (!horizontal) {
      const top = config.floors.find(f => f.id === face.floorId)!;
      const edge = top.elevationMm + top.heightMm - 180 - face.originMm[1];
      const extend = <T extends Rect>(rect: T): T => Math.abs(rect.y + rect.height - edge) < epsilon ? { ...rect, height: rect.height + 180 } : rect;
      face.members = face.members.map(member => ({ ...member, rects: member.rects.map(extend), zones: member.zones.map(extend) }));
      face.rects = face.rects.map(extend); face.zones = face.zones.map(extend);
      face.gridBoundsMm.height = Math.max(face.gridBoundsMm.height, ...face.rects.map(r => r.y + r.height));
    }
    // Extending a wall into the former plate band can meet a retained cap edge.
    // Give each patch one owner before constructing render or quantity meshes.
    let claimed: Rect[] = [];
    face.members = face.members.flatMap(member => {
      const rects = rectUnion(member.rects, [...member.holes, ...claimed]);
      if (!rects.length) return [];
      claimed = rectUnion([...claimed, ...rects]);
      const zones = member.zones.flatMap(zone => rects.flatMap(mask => { const p = intersect(zone, mask); return p ? [{ ...zone, ...p }] : []; }));
      return [{ ...member, rects, holes: [], zones }];
    });
    face.rects = claimed; face.holes = []; face.zones = face.members.flatMap(member => member.zones);
    if (slabCeiling) {
      face.originMm[1] += 180; // A single plate has no thickness.
      face.viewGroup = undefined;
      face.members = face.members.map(member => ({ ...member, viewGroup: undefined }));
    }
    face.category = slabCeiling ? 'ceiling' : horizontal && n[1] > 0 ? 'floor' : 'wall';
    if (horizontal) {
      // The shared ground interface belongs only to the base.
      if (face.originMm[1] <= baseLevelMm + epsilon) {
        face.viewGroup = 'base'; face.floorId = 'f1';
        face.members = face.members.map(member => ({ ...member, viewGroup: 'base' }));
      }
      return [face];
    }
    const boundary = (baseLevelMm - face.originMm[1]) / v[1];
    const base = clipped(face, face.rects.flatMap(r => { const end = Math.min(r.y + r.height, boundary); return end > r.y + epsilon ? [{ ...r, height: end - r.y }] : []; }));
    const upper = clipped(face, face.rects.flatMap(r => { const start = Math.max(r.y, boundary); return r.y + r.height > start + epsilon ? [{ ...r, y: start, height: r.y + r.height - start }] : []; }));
    if (base) {
      base.id = upper ? `${face.id}:base` : face.id; base.viewGroup = 'base'; base.floorId = 'f1';
      base.members = base.members.map(member => ({ ...member, viewGroup: 'base' }));
    }
    return [base, upper].filter((f): f is WallFace => !!f);
  });
}

let revision10: WallFace[] | undefined, current: WallFace[] | undefined;
export const editableFacesAtRevision10 = () => revision10 ??= modelSurfaces(buildingFaces(config.walls));
export const editableBuildingFaces = () => current ??= editableFacesAtRevision10().flatMap(face => {
  const masks = faceBodyMasks(face, structuralBodies);
  const child = clipped(face, rectUnion(face.rects, [...face.holes, ...masks]));
  return child ? [{ ...child, previousFaceId: face.id }] : [];
});

export const partViewGroup = (part: Part) => part.floorId === 'f1' && part.centerMm[1] + part.sizeMm[1] / 2 <= baseLevelMm + epsilon ? 'base' as const : part.viewGroup;
export const floorOffsetMm = (floorId: string, group?: string) => group === 'base' ? 0 : (config.floors.findIndex(f => f.id === floorId) + 1) * config.scene.explosionMm;
export const modelWalls = config.walls.map(wall => ({ ...wall, topCoveredMm: 0,
  surfaceCuts: wall.surfaceCuts?.filter(r => !(r.height === 180 && r.y + r.height === wall.heightMm)) }));
export const junctionFillers = cornerFillers(modelWalls);
const structuralBodies = [...buildingBodies(modelWalls, []), ...junctionFillers];

// Close only the empty indoor footprint. Door thresholds follow the masonry
// inner edge; existing outdoor floors and wall footprints keep their ownership.
const firstFloor = config.floors[0], plinth = config.parts.find(part => part.id === 'entry-plinth')!;
const indoorEdge = (side: string, axis: number) => { const wall = modelWalls.find(w => w.id === `${firstFloor.id}-${side}`)!; return wall.originMm[axis] - wallFrame(wall).n[axis] * wall.thicknessMm; };
const indoorBounds = { min: [indoorEdge('left', 0), firstFloor.elevationMm, indoorEdge('back', 2)], max: [indoorEdge('right', 0), firstFloor.elevationMm, indoorEdge('front', 2)] };
const groundRect = (box: { min: number[]; max: number[] }): Rect => ({ x: box.min[0], y: box.min[2], width: box.max[0] - box.min[0], height: box.max[2] - box.min[2] });
const closedWallBodies = buildingBodies(modelWalls.filter(w => w.floorId === firstFloor.id).map(w => ({ ...w, openings: [] })), []);
const closureMasks = [
  ...closedWallBodies.filter(b => b.min[1] <= firstFloor.elevationMm && b.max[1] > firstFloor.elevationMm).map(groundRect),
  ...junctionFillers.filter(b => b.floorId === firstFloor.id && b.min[1] <= firstFloor.elevationMm).map(groundRect),
  ...editableBuildingFaces().filter(f => Math.abs(wallFrame(f).n[1]) > .99 && Math.abs(f.originMm[1] - firstFloor.elevationMm) < epsilon)
    .flatMap(f => f.rects.map(rect => groundRect(planeRect(f, rect, 0)))),
  ...config.parts.filter(p => p.floorId === firstFloor.id && p.kind === 'screen').map(p => ({ x: p.centerMm[0] - p.sizeMm[0] / 2, y: p.centerMm[2] - p.sizeMm[2] / 2, width: p.sizeMm[0], height: p.sizeMm[2] })),
];
export const firstFloorClosurePatches = rectUnion([groundRect(indoorBounds)], closureMasks)
  .map((rect, index) => ({ id: `f1-interior-closure-${index}`, floorId: firstFloor.id, originMm: [rect.x, firstFloor.elevationMm, rect.y + rect.height] as [number, number, number], rotationX: -Math.PI / 2, rotationY: 0, widthMm: rect.width, heightMm: rect.height, color: plinth.color }));
