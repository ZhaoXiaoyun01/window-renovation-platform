import { Line } from '@react-three/drei';
import { buildingConfig as config } from '../config/building-config';
import { glassPresets, windowEvidence, windowRender } from '../config/window-config';
import { m } from '../utils/units';
import { defaultWindowFinish, windowGeometry } from '../utils/window-finishes';
import type { Opening, Vec3, WindowFinish } from '../types';
import { SelectionOutline } from './SelectionOutline';

export function OpeningMesh({ opening, selected, onSelect, finish }: { opening: Opening; selected: boolean; onSelect: () => void; finish?: WindowFinish }) {
  if (opening.kind === 'balcony') return null;
  const { x, y } = opening, depth = config.openings.depthMm, isWindow = opening.kind === 'window';
  const geometry = windowGeometry(!isWindow && !opening.design ? { ...opening, design: { mode: 'fixed', columns: [1], note: '单扇门示意，五金位置待核实。' } } : opening);
  const applied = finish ?? defaultWindowFinish(), frameColor = isWindow ? applied.frameColor : config.openings.frameColor;
  const glass = glassPresets[applied.glassType], symbol = windowEvidence[opening.id]?.symbol ?? (geometry.design.mode === 'top-hung' ? 'top' : 'left');
  return <group name={opening.id} userData={{ kind: opening.kind, evidence: opening.evidence }} onClick={e => { e.stopPropagation(); onSelect(); }}>
    {geometry.frames.map((s, i) => <mesh key={`frame-${i}`} position={[m(x + s.x + s.width / 2), m(y + s.y + s.height / 2), m(-depth / 2)]} castShadow>
      <boxGeometry args={[m(s.width), m(s.height), m(depth)]}/><meshStandardMaterial color={frameColor} roughness={0.4} metalness={0.3}/>
    </mesh>)}
    {geometry.panes.map((pane, i) => <group key={`pane-${i}`}>
      <mesh position={[m(x + pane.x + pane.width / 2), m(y + pane.y + pane.height / 2), m(-depth * windowRender.glassDepthRatio)]}>
        <planeGeometry args={[m(pane.width), m(pane.height)]}/>
        <meshStandardMaterial color={isWindow ? glass.color : config.openings.doorColor} metalness={0.25} roughness={0.22} transparent={isWindow} opacity={isWindow ? glass.opacity : 1} side={2}/>
      </mesh>
      {isWindow && pane.operable ? <mesh position={[m(x + pane.x + pane.width - windowRender.handleInsetMm), m(y + pane.y + pane.height / 2), m(windowRender.handleSizeMm[2] / 2)]}>
        <boxGeometry args={windowRender.handleSizeMm.map(m) as Vec3}/><meshStandardMaterial color={frameColor} roughness={0.3} metalness={0.5}/>
      </mesh> : null}
      {isWindow && pane.operable && selected ? <Line points={(symbol === 'top' ? [[0.12, 0.12], [0.5, 0.88], [0.88, 0.12]] : symbol === 'right' ? [[0.12, 0.12], [0.88, 0.5], [0.12, 0.88]] : [[0.88, 0.12], [0.12, 0.5], [0.88, 0.88]])
        .map(([u, v]): Vec3 => [m(x + pane.x + pane.width * u), m(y + pane.y + pane.height * v), m(-depth * windowRender.symbolDepthRatio)])}
        color={frameColor} lineWidth={1} transparent opacity={0.7} depthTest depthWrite={false} raycast={() => {}}/> : null}
    </group>)}
    {!isWindow && <mesh position={[m(x + opening.width - windowRender.doorHandleInsetMm), m(y + windowRender.doorHandleHeightMm), m(windowRender.handleSizeMm[2] / 2)]}>
      <boxGeometry args={windowRender.handleSizeMm.map(m) as Vec3}/><meshStandardMaterial color={frameColor} roughness={0.3} metalness={0.5}/>
    </mesh>}
    {selected && <SelectionOutline rect={opening} depthMm={3}/>}
  </group>;
}
