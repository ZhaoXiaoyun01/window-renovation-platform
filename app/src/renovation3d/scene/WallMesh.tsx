import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, DoubleSide } from 'three';
import { buildingConfig as config } from '../config/building-config';
import { createTileTexture } from '../materials/tile-material';
import { faceCellLimit, faceFinishLayout, faceFinishRegions, faceGridWall, faceSolids, openingOffset, wallSurfaces } from '../utils/wall-surfaces';
import { isObjectVisible } from '../utils/view-groups';
import { m, metres } from '../utils/units';
import { OpeningMesh } from './OpeningMesh';
import { SelectionOutline, SelectionStipple } from './SelectionOutline';
import type { Finish, Rect, RenovationState, TileMaterial, Wall, WallFace } from '../types';

function surfaceGeometry(pieces: (Rect & { uv?: [number, number, number, number] })[], z: number, rotated = false) {
  const positions: number[] = [], uvs: number[] = [];
  for (const p of pieces) {
    const x = m(p.x), y = m(p.y), x2 = m(p.x + p.width), y2 = m(p.y + p.height);
    positions.push(x, y, z, x2, y, z, x2, y2, z, x, y, z, x2, y2, z, x, y2, z);
    const [u, v, u2, v2] = p.uv || [0, 0, 1, 1];
    const corners = [u, v, u2, v, u2, v2, u, v, u2, v2, u, v2];
    for (let i = 0; i < corners.length; i += 2) uvs.push(...(rotated ? [corners[i + 1], 1 - corners[i]] : [corners[i], corners[i + 1]]));
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new Float32BufferAttribute(uvs, 2)); g.computeVertexNormals();
  return g;
}
function WallSurface({ surface, finish, material, onSelect, claddingMm }: { surface: ReturnType<typeof wallSurfaces>[number]; finish: Finish; material: TileMaterial; onSelect: () => void; claddingMm: number }) {
  const invalidate = useThree(s => s.invalidate);
  const { zone, pieces, solids } = surface;
  const paint = material.kind === 'paint';
  const rotated = finish.direction === 'horizontal' ? finish.widthMm < finish.heightMm : finish.widthMm > finish.heightMm;
  // Keep zero-thickness returns ahead of coincident structural sides for rendering and picking.
  const renderDepthMm = paint ? 1 : Math.max(claddingMm, 1);
  const tileGeometry = useMemo(() => surfaceGeometry(pieces, m(zone.offsetMm + renderDepthMm), rotated), [pieces, zone.offsetMm, rotated, renderDepthMm]);
  const groutGeometry = useMemo(() => surfaceGeometry(solids, m(zone.offsetMm + Math.min(1, renderDepthMm - 0.5))), [solids, zone.offsetMm, renderDepthMm]);
  const texture = useMemo(() => paint ? null : createTileTexture(material, invalidate), [material, invalidate, paint]);
  useEffect(() => () => { tileGeometry.dispose(); }, [tileGeometry]);
  useEffect(() => () => { groutGeometry.dispose(); }, [groutGeometry]);
  useEffect(() => () => { texture?.dispose(); }, [texture]);
  return <group>
    {!paint && <mesh geometry={groutGeometry} onClick={e => { e.stopPropagation(); onSelect(); }}><meshStandardMaterial color={finish.groutColor}/></mesh>}
    <mesh geometry={tileGeometry} receiveShadow onClick={e => { e.stopPropagation(); onSelect(); }}>
      <meshStandardMaterial map={texture} color={material.color} roughness={0.82}/>
    </mesh>
  </group>;
}
type SelectObject = (id: string, wallId?: string, faceId?: string) => void;

export function FaceMesh({ face, state, selectedObject, onSelect, highlighted = false }: { highlighted?: boolean; face: WallFace; state: RenovationState; selectedObject: string; onSelect: SelectObject }) {
  const gridWall = useMemo(() => faceGridWall(face, config.walls), [face]);
  const selected = selectedObject === face.id || highlighted;
  const highlightGeometry = useMemo(() => selected ? surfaceGeometry(faceSolids(face), m(face.offsetMm + (face.claddingMm ?? config.scene.tileDepthMm) + 2)) : undefined, [face, selected]);
  useEffect(() => () => highlightGeometry?.dispose(), [highlightGeometry]);
  const capId = face.sourceWallIds.map(id => id.match(/^exposed-(f[234]-slab|roof-slab)-bottom-/)?.[1]).find(Boolean);
  const cap = config.parts.find(part => part.id === capId);
  const backing = useMemo(() => face.category === 'ceiling' && (state.exploded || cap && !isObjectVisible(cap, state)) ? surfaceGeometry(faceSolids(face), m(face.offsetMm)) : undefined, [face, state.exploded, state.hiddenFloors, state.hiddenGroups]);
  useEffect(() => () => backing?.dispose(), [backing]);
  const override = state.faceFinishes?.[face.id];
  const surfaces = useMemo(() => {
    const regions = faceFinishRegions(face, state);
    return regions.flatMap(({ face: region, finish }) => {
      const layout = faceFinishLayout(region, gridWall, finish, state, faceCellLimit(region, state, config.scene.maxCellsPerWall));
      if (finish.preserveZoning) return wallSurfaces({ finishZones: region.zones, openings: region.holes }, layout).map(surface => ({ surface, finish, materialId: surface.zone.materialId }));
      return [{ surface: { zone: { x: 0, y: 0, width: gridWall.widthMm, height: gridWall.heightMm, materialId: finish.materialId, offsetMm: face.offsetMm }, pieces: layout.pieces, solids: faceSolids(region) }, finish, materialId: finish.materialId }];
    });
  }, [face, gridWall, override, state.finishes, state.faceRegionFinishes, state.materials]);
  const select = () => onSelect(face.id, face.wallId, face.id);
  return <group name={face.id} position={metres(face.originMm)} rotation={[face.rotationX ?? 0, face.rotationY, 0]}>
    {backing && <mesh geometry={backing} castShadow receiveShadow onClick={e => e.stopPropagation()}><meshStandardMaterial color={config.structureColor} side={DoubleSide}/></mesh>}
    {surfaces.map(({ surface, finish, materialId }, i) => <WallSurface key={i} surface={surface} finish={finish} material={state.materials.find(mat => mat.id === materialId)!} onSelect={select} claddingMm={face.claddingMm ?? config.scene.tileDepthMm}/>)}
    {highlightGeometry && <SelectionStipple geometry={highlightGeometry}/>}
    {selected && <SelectionOutline rect={face.rects} holes={face.holes} depthMm={face.offsetMm + (face.claddingMm ?? config.scene.tileDepthMm) + 3}/>}
  </group>;
}

export function WallMesh({ wall, state, selectedObject, onSelect, highlightedWindows }: { highlightedWindows: string[]; wall: Wall; state: RenovationState; selectedObject: string; onSelect: SelectObject }) {
  return <group name={wall.id} position={metres(wall.originMm)} rotation={[wall.rotationX ?? 0, wall.rotationY, 0]}>
    {wall.openings.map(opening => <group key={opening.id} position={[0, 0, m(openingOffset(wall, opening))]}>
      <OpeningMesh opening={opening} finish={state.windowFinishes?.[opening.id]} selected={selectedObject === opening.id || highlightedWindows.includes(opening.id)} onSelect={() => onSelect(opening.id, wall.id)}/>
    </group>)}
  </group>;
}
