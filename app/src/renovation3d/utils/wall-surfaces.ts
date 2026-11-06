import { area, clipHoles, intersect, tileDimensions, validateTile } from '../tile-layout/layout.ts';
import { outlineSegments, rectUnion, surfaceOutline, type OutlineSegment } from './outline.ts';
import type { Finish, FinishZone, Layout, Part, Rect, RenovationState, TilePiece, TileSettings, Vec3, Wall, WallFace, WallFaceMember } from '../types';
import { buildingConfig as config } from '../config/building-config.ts';
import { intersectedFaces, splitAtLevels } from './surface-intersections.ts';
import { splitViewGroups } from './view-groups.ts';
import { retainPreviousRegions } from './face-compat.ts';
import { mergeCoplanarFaces } from './coplanar-faces.ts';
import { joinReturnCorners } from './return-corners.ts';
export { openingOffset } from './opening-placement.ts';

function frame(wall: { rotationX?: number; rotationY: number }) {
  const x = wall.rotationX ?? 0, y = wall.rotationY;
  return { u: [Math.cos(y), Math.sin(x) * Math.sin(y), -Math.cos(x) * Math.sin(y)],
    v: [0, Math.cos(x), Math.sin(x)], n: [Math.sin(y), -Math.sin(x) * Math.cos(y), Math.cos(x) * Math.cos(y)] };
}
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const touches = (a: Rect, b: Rect) => {
  const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return x > 1e-6 && y >= -1e-6 || y > 1e-6 && x >= -1e-6;
};

export function wallSurfaces(wall: { finishZones: FinishZone[]; openings: Rect[] }, layout: Layout) {
  return wall.finishZones.map(zone => ({ zone,
    solids: clipHoles(zone, wall.openings),
    pieces: layout.pieces.flatMap(piece => {
      const clipped = intersect(piece, zone);
      if (!clipped) return [];
      const [u, v, u2, v2] = piece.uv;
      const uv: TilePiece['uv'] = [u + (u2 - u) * (clipped.x - piece.x) / piece.width, v + (v2 - v) * (clipped.y - piece.y) / piece.height,
        u + (u2 - u) * (clipped.x + clipped.width - piece.x) / piece.width, v + (v2 - v) * (clipped.y + clipped.height - piece.y) / piece.height];
      return [{ ...piece, ...clipped, uv }];
    }),
  }));
}

export function wallFaces(wall: Wall): WallFace[] {
  const groups = new Map<string, FinishZone[]>();
  for (const zone of wall.finishZones) {
    const clipped = intersect(zone, { x: 0, y: 0, width: wall.widthMm, height: wall.heightMm });
    if (!clipped) continue;
    const key = `${zone.offsetMm}:${zone.faceKey ?? ''}`, zones = groups.get(key) ?? [];
    zones.push(...clipHoles(clipped, wall.surfaceCuts ?? []).map(rect => ({ ...zone, ...rect }))); groups.set(key, zones);
  }
  return [...groups.values()].filter(zones => zones.length).sort((a, b) => a[0].offsetMm - b[0].offsetMm || (a[0].faceKey ?? '').localeCompare(b[0].faceKey ?? '')).map(zones => {
    const { offsetMm, faceKey } = zones[0];
    const rects = zones.map(({ x, y, width, height }) => ({ x, y, width, height }));
    const holes = rectUnion(wall.openings.flatMap(hole => rects.flatMap(rect => {
      const clipped = intersect(rect, hole); return clipped ? [clipped] : [];
    })));
    const id = `${wall.id}:face:${offsetMm}${faceKey ? `:${faceKey}` : ''}`;
    return { id, wallId: wall.id, floorId: wall.floorId, facade: wall.facade, offsetMm, rects, holes, zones,
      originMm: [...wall.originMm] as Vec3, rotationY: wall.rotationY, rotationX: wall.rotationX, surfaceKind: wall.surfaceKind, claddingMm: wall.claddingMm, faceKey, gridBoundsMm: { x: 0, y: 0, width: wall.widthMm, height: wall.heightMm },
      sourceWallIds: [wall.id], members: [{ wallId: wall.id, sourceFaceId: id, offsetMm, shiftMm: [0, 0] as [number, number], rects, holes, zones }] };
  });
}

export function baseBuildingFaces(walls: Wall[]): WallFace[] {
  const groups = new Map<string, WallFace[]>(), byId = new Map(walls.map(w => [w.id, w]));
  const rounded = (n: number) => Math.round(n * 1e6) / 1e6;
  for (const face of walls.flatMap(wallFaces)) {
    const { n } = frame(face), plane = dot(n, face.originMm) + face.offsetMm;
    const key = `${face.floorId}:${face.surfaceKind ?? 'wall'}:${n.map(rounded).join(':')}:${rounded(plane)}:${face.faceKey ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), face]);
  }
  const connectedGroups = [...groups.values()].flatMap(group => {
    if (group[0].surfaceKind !== 'inner-wall') return [group];
    const { u, v } = frame(group[0]);
    const projected = group.map(face => faceSolids(face).map(rect => ({ ...rect,
      x: rounded(rect.x + dot(face.originMm, u)), y: rounded(rect.y + dot(face.originMm, v)) })));
    const remaining = new Set(group.map((_, i) => i)), components: WallFace[][] = [];
    while (remaining.size) {
      const pending = [remaining.values().next().value!], component: WallFace[] = [];
      remaining.delete(pending[0]);
      while (pending.length) {
        const index = pending.pop()!; component.push(group[index]);
        for (const other of remaining) if (projected[index].some(a => projected[other].some(b => touches(a, b)))) {
          remaining.delete(other); pending.push(other);
        }
      }
      components.push(component);
    }
    return components;
  });
  return connectedGroups.map(group => {
    const ordered = group.sort((a, b) => a.wallId.localeCompare(b.wallId)), anchor = ordered[0];
    const { u, v } = frame(anchor);
    const positions = ordered.map(face => ({ face,
      x: rounded(dot(face.originMm.map((n, i) => n - anchor.originMm[i]), u)),
      y: rounded(dot(face.originMm.map((n, i) => n - anchor.originMm[i]), v)) }));
    const minX = Math.min(...positions.map(p => p.x)), minY = Math.min(...positions.map(p => p.y));
    const width = Math.max(...positions.map(p => p.x + byId.get(p.face.wallId)!.widthMm)) - minX;
    const height = Math.max(...positions.map(p => p.y + byId.get(p.face.wallId)!.heightMm)) - minY;
    const members: WallFaceMember[] = positions.map(({ face, x, y }) => {
      const dx = x - minX, dy = y - minY, shift = (r: Rect) => ({ ...r, x: rounded(r.x + dx), y: rounded(r.y + dy) });
      return { wallId: face.wallId, sourceFaceId: face.id, offsetMm: face.offsetMm, shiftMm: [dx, dy],
        rects: face.rects.map(shift), holes: face.holes.map(shift), zones: face.zones.map(z => ({ ...z, ...shift(z), offsetMm: anchor.offsetMm })) };
    });
    const rects = members.flatMap(m => m.rects), solids = rectUnion(members.flatMap(m => rectUnion(m.rects, m.holes)));
    return { ...anchor, originMm: anchor.originMm.map((n, i) => rounded(n + minX * u[i] + minY * v[i])) as Vec3,
      gridBoundsMm: { x: 0, y: 0, width, height }, sourceWallIds: members.map(m => m.wallId), members, rects,
      holes: rectUnion(rects, solids), zones: members.flatMap(m => m.zones) };
  }).flatMap(splitConnectedFace).map(face => ({ ...face, facade: byId.get(face.wallId)!.facade })).sort((a, b) => a.id.localeCompare(b.id));
}

let configuredFaces: { wallCount: number; partCount: number; faces: WallFace[]; previous: WallFace[]; revision7: WallFace[]; revision8: WallFace[] } | undefined;
export function buildingFacesAtRevision8(): WallFace[] {
  buildingFaces(config.walls);
  return configuredFaces!.revision8;
}
export function buildingFacesAtRevision7(): WallFace[] {
  buildingFaces(config.walls);
  return configuredFaces!.revision7;
}
export function buildingFacesAtRevision6(): WallFace[] {
  buildingFaces(config.walls);
  return configuredFaces!.previous;
}
export function buildingFaces(walls: Wall[], parts: Part[] = walls === config.walls ? config.parts : []): WallFace[] {
  const configured = walls === config.walls && parts === config.parts;
  if (configured && configuredFaces?.wallCount === walls.length && configuredFaces.partCount === parts.length) return configuredFaces.faces;
  const base = baseBuildingFaces(walls), levels = config.floors.map(f => f.elevationMm + f.heightMm);
  const visible = intersectedFaces(base, walls, parts);
  const previous = configured ? splitViewGroups(splitAtLevels(intersectedFaces(base, walls, parts, true), levels), walls) : [];
  const current = splitViewGroups(splitAtLevels(visible, levels), walls);
  const revision7 = configured ? retainPreviousRegions(current, previous) : current;
  const revision8 = mergeCoplanarFaces(revision7, walls, levels, configured ? config.floors.map(f => f.id) : undefined);
  const faces = configured ? joinReturnCorners(revision8, walls, parts, config.scene.tileDepthMm, levels) : revision8;
  if (configured) configuredFaces = { wallCount: walls.length, partCount: parts.length, faces, previous, revision7, revision8 };
  return faces;
}

function splitConnectedFace(face: WallFace): WallFace[] {
  const solids = faceSolids(face), remaining = new Set(solids.map((_, i) => i)), components: Rect[][] = [];
  while (remaining.size) {
    const pending = [remaining.values().next().value!], component: Rect[] = [];
    remaining.delete(pending[0]);
    while (pending.length) {
      const index = pending.pop()!; component.push(solids[index]);
      for (const other of remaining) if (touches(solids[index], solids[other])) { remaining.delete(other); pending.push(other); }
    }
    components.push(component);
  }
  if (components.length <= 1) return [face];
  const bounds = (rects: Rect[]) => {
    const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
    return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
  };
  return components.sort((a, b) => bounds(a).x - bounds(b).x || bounds(a).y - bounds(b).y).map((component, index) => {
    const box = bounds(component), holes = face.holes.flatMap(h => {
      const clipped = intersect(h, box); return clipped && component.some(r => touches(r, clipped)) ? [clipped] : [];
    });
    const rects = rectUnion([...component, ...holes]);
    const clip = <T extends Rect>(rect: T): T[] => rects.flatMap(mask => { const clipped = intersect(rect, mask); return clipped ? [{ ...rect, ...clipped }] : []; });
    const members = face.members.flatMap(member => {
      const memberRects = rectUnion(member.rects.flatMap(clip));
      return memberRects.length ? [{ ...member, rects: memberRects, holes: member.holes.flatMap(clip), zones: member.zones.flatMap(clip) }] : [];
    });
    return { ...face, id: index ? `${face.id}:part:${box.x}:${box.y}` : face.id, legacyFaceId: index ? face.id : undefined,
      wallId: members[0].wallId, sourceWallIds: [...new Set(members.map(m => m.wallId))], rects, holes, members, zones: members.flatMap(m => m.zones) };
  });
}

export function faceGridWall(face: WallFace, walls: Wall[]): Wall {
  const anchor = walls.find(w => w.id === face.wallId);
  if (!anchor) throw new Error('装修面来源墙体不存在。');
  const datum = anchor.tileGridDatum && config.tileDatums?.[anchor.tileGridDatum];
  const { u, v } = frame(face), delta = datum?.originMm.map((n, i) => n - face.originMm[i]);
  const tileGridBoundsMm = datum && delta ? { x: dot(delta, u), y: dot(delta, v), width: datum.widthMm, height: datum.heightMm } : undefined;
  return { ...anchor, originMm: face.originMm, rotationY: face.rotationY, rotationX: face.rotationX, widthMm: face.gridBoundsMm.width, heightMm: face.gridBoundsMm.height,
    openings: [], finishZones: face.zones, tileGridBoundsMm };
}

export const faceSolids = (face: WallFace) => rectUnion(face.rects, face.holes);

export function faceJointBands(face: WallFace): Rect[] {
  if (Math.abs(face.rotationX ?? 0) > 1e-6 || !config.scene.floorJointMm) return [];
  const elevations = [...config.floors.slice(1).map(floor => floor.elevationMm), Math.max(...config.floors.map(floor => floor.elevationMm + floor.heightMm))];
  return elevations.flatMap(elevation => {
    const y = elevation - face.originMm[1];
    return y >= 0 && y < face.gridBoundsMm.height ? [{ x: 0, y, width: face.gridBoundsMm.width, height: config.scene.floorJointMm! }] : [];
  });
}
export const faceTileSolids = (face: WallFace) => rectUnion(face.rects, [...face.holes, ...faceJointBands(face)]);

export function resolveFaceFinish(face: WallFace, state: RenovationState): Finish {
  const wallFinish = state.faceRegionFinishes?.[face.members[0].sourceFaceId] ?? state.faceRegionFinishes?.[face.members[0].previousSourceFaceId ?? ''] ?? state.finishes[face.wallId];
  return state.faceFinishes?.[face.id] ?? (wallFinish.preserveZoning ? { ...wallFinish, materialId: face.zones[0].materialId } : wallFinish);
}

// Preserve differing finishes from saved wall schemes until this entire face is replaced.
export function faceFinishRegions(face: WallFace, state: RenovationState): { face: WallFace; finish: Finish }[] {
  if ((state.faceGroupingVersion ?? 0) >= 8) return [{ face, finish: { ...resolveFaceFinish(face, state), preserveZoning: false } }];
  const override = state.faceFinishes?.[face.id];
  if (override) return [{ face, finish: override }];
  const regions = new Map<string, { face: WallFace; finish: Finish }>();
  for (const member of face.members) {
    const inherited = state.faceRegionFinishes?.[member.sourceFaceId] ?? state.faceRegionFinishes?.[member.previousSourceFaceId ?? ''] ?? state.finishes[member.wallId];
    const finish = inherited.preserveZoning ? { ...inherited, materialId: member.zones[0].materialId } : inherited;
    const key = JSON.stringify([finish.materialId, finish.widthMm, finish.heightMm, finish.direction, finish.groutMm, finish.groutColor, finish.alignment, !!finish.preserveZoning]);
    const region = regions.get(key);
    if (region) { region.face.rects.push(...member.rects); region.face.zones.push(...member.zones); region.face.sourceWallIds.push(member.wallId); region.face.members.push(member); }
    else regions.set(key, { face: { ...face, rects: [...member.rects], zones: [...member.zones], sourceWallIds: [member.wallId], members: [member] }, finish });
  }
  return [...regions.values()];
}

// A restored scheme keeps the budgets of its formerly separate walls.
export const faceCellLimit = (face: WallFace, state: RenovationState, limit: number) => state.faceFinishes?.[face.id] ? limit : limit * new Set(face.sourceWallIds).size;

// Paint covers the actual solid once; tile dimensions and joints do not subdivide it.
export function faceFinishLayout(face: WallFace, wall: Wall, finish: Finish, state: RenovationState, maxCells: number): Layout {
  if (state.materials.find(material => material.id === finish.materialId)?.kind !== 'paint') return faceTileLayout(face, wall, finish, maxCells);
  const solids = faceTileSolids(face);
  return { pieces: solids.map(rect => ({ ...rect, sourceTileId: '', row: 0, col: 0, cut: false, uv: [0, 0, 1, 1] })),
    sourceTiles: 0, cutTiles: 0, narrowPieces: 0, tileAreaMm2: 0, netAreaMm2: solids.reduce((sum, rect) => sum + area(rect), 0) };
}

export function faceMetrics(face: WallFace) {
  const solids = faceTileSolids(face);
  const x = solids.length ? Math.min(...solids.map(r => r.x)) : 0, y = solids.length ? Math.min(...solids.map(r => r.y)) : 0;
  const width = solids.length ? Math.max(...solids.map(r => r.x + r.width)) - x : 0;
  const height = solids.length ? Math.max(...solids.map(r => r.y + r.height)) - y : 0;
  const boundsMm = { x, y, width, height };
  // A source zone may include a window below a small cap; only its visible envelope is this face.
  const clipped = (rects: Rect[]) => rects.flatMap(r => { const piece = intersect(r, boundsMm); return piece ? [piece] : []; });
  const gross = rectUnion(clipped(face.rects)), holes = rectUnion(clipped(face.holes));
  const length = (segments: OutlineSegment[]) => segments.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
  const outline = surfaceOutline(gross, holes);
  return { boundsMm, widthMm: width, heightMm: height,
    grossAreaMm2: gross.reduce((sum, r) => sum + area(r), 0), netAreaMm2: solids.reduce((sum, r) => sum + area(r), 0),
    grossPerimeterMm: length(outlineSegments(gross)), outerPerimeterMm: length(outline.outer), openingPerimeterMm: length(outline.openings) };
}

// Exterior floors share a building datum; internal faces keep their local wall grid.
// Cell limits therefore apply to the selected face, including after openings are removed.
export function faceTileLayout(face: WallFace, wall: Wall, settings: TileSettings, maxCells = 6000): Layout {
  validateTile(settings);
  if (face.wallId !== wall.id || ![wall.widthMm, wall.heightMm].every(n => Number.isFinite(n) && n > 0)) throw new Error('装修面所属墙体或尺寸无效。');
  const { width, height } = tileDimensions(settings);
  const px = width + settings.groutMm, py = height + settings.groutMm;
  const phase = (size: number, pitch: number) => settings.alignment === 'edge' ? 0 : (size - (Math.ceil((size + settings.groutMm) / pitch) * pitch - settings.groutMm)) / 2;
  const grid = wall.tileGridBoundsMm ?? { x: 0, y: 0, width: wall.widthMm, height: wall.heightMm };
  const ox = grid.x + phase(grid.width, px), oy = grid.y + phase(grid.height, py), solids = faceTileSolids(face);
  const cells = new Map<string, { tile: Rect; row: number; col: number; fragments: Rect[] }>();
  for (const solid of solids) {
    const minCol = Math.floor((solid.x - ox) / px), maxCol = Math.ceil((solid.x + solid.width - ox) / px);
    const minRow = Math.floor((solid.y - oy) / py), maxRow = Math.ceil((solid.y + solid.height - oy) / py);
    for (let row = minRow; row < maxRow; row++) for (let col = minCol; col < maxCol; col++) {
      const tile = { x: ox + col * px, y: oy + row * py, width, height }, clipped = intersect(tile, solid);
      if (!clipped) continue;
      const key = `${row}:${col}`, cell = cells.get(key) ?? { tile, row, col, fragments: [] };
      cell.fragments.push(clipped); cells.set(key, cell);
      if (cells.size > maxCells) throw new Error('当前规格产生过多砖格，请增大瓷砖规格后再应用。');
    }
  }
  const result: Layout = { pieces: [], sourceTiles: cells.size, cutTiles: 0, narrowPieces: 0, tileAreaMm2: 0, netAreaMm2: solids.reduce((sum, r) => sum + area(r), 0) };
  for (const [sourceTileId, { tile, row, col, fragments }] of cells) {
    const pieces = rectUnion(fragments), cut = Math.abs(pieces.reduce((sum, p) => sum + area(p), 0) - width * height) > 1e-5;
    if (cut) result.cutTiles++;
    for (const piece of pieces) {
      result.pieces.push({ ...piece, sourceTileId, row, col, cut,
        uv: [(piece.x - tile.x) / width, (piece.y - tile.y) / height, (piece.x + piece.width - tile.x) / width, (piece.y + piece.height - tile.y) / height] });
      result.tileAreaMm2 += area(piece);
      if (Math.min(piece.width, piece.height) < 100) result.narrowPieces++;
    }
  }
  return result;
}
