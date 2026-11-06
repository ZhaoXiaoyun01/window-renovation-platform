import { screenBars } from '../utils/screen-geometry';
import { metres } from '../utils/units';
import { BoxSelectionOutline } from './SelectionOutline';
import type { Part } from '../types';

export function ScreenMesh({ part, color, selected, onSelect }: { part: Part; color: string; selected: boolean; onSelect: (id: string) => void }) {
  return <group name={part.id} position={metres(part.centerMm)} onClick={e => { e.stopPropagation(); onSelect(part.id); }}>
    {screenBars(part).map((bar, i) => <mesh key={i} position={metres(bar.centerMm)} castShadow receiveShadow>
      <boxGeometry args={metres(bar.sizeMm)}/><meshStandardMaterial color={color} roughness={0.65}/>
    </mesh>)}
    {selected && <BoxSelectionOutline sizeMm={part.sizeMm}/>}
  </group>;
}
