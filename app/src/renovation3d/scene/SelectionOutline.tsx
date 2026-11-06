import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { Color, type BufferGeometry } from 'three';
import type { Rect, Vec3 } from '../types';
import { outlineSegments, type OutlineSegment } from '../utils/outline';
import { m } from '../utils/units';
import { useColorSampling } from '../components/ColorPicker';

const noHoles: Rect[] = [];
const selectionColor = '#d6b35a';
const selectionLineWidth = 3;
const stippleVertex = 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
const stippleFragment = `uniform vec3 color;
uniform float pixelRatio;
void main(){
  vec2 cell=mod(gl_FragCoord.xy/pixelRatio,4.0)-1.5;
  if(dot(cell,cell)>0.49)discard;
  gl_FragColor=vec4(color,1.0);
  #include <colorspace_fragment>
}`;

export function SelectionStipple({ geometry }: { geometry: BufferGeometry }) {
  const sampling = useColorSampling();
  const dpr = useThree(s => s.viewport.dpr);
  const uniforms = useMemo(() => ({ color: { value: new Color(selectionColor) }, pixelRatio: { value: dpr } }), [dpr]);
  return sampling.active ? null : <mesh geometry={geometry} raycast={() => {}}><shaderMaterial uniforms={uniforms} vertexShader={stippleVertex} fragmentShader={stippleFragment} transparent depthWrite={false} toneMapped={false}/></mesh>;
}

export function SelectionOutline({ rect, holes = noHoles, segments, depthMm = 8 }: { rect?: Rect | Rect[]; holes?: Rect[]; segments?: OutlineSegment[]; depthMm?: number }) {
  const points = useMemo(() => (segments ?? (rect ? outlineSegments(rect, holes) : [])).flatMap(segment => segment.map(([x, y]): [number, number, number] => [m(x), m(y), m(depthMm)])), [rect, holes, segments, depthMm]);
  if (!points.length) return null;
  return <Line points={points} segments color={selectionColor} lineWidth={selectionLineWidth} depthTest depthWrite={false} toneMapped={false} raycast={() => {}}/>;
}

export function BoxSelectionOutline({ sizeMm, depthTest = true }: { sizeMm: Vec3; depthTest?: boolean }) {
  const [width, height, depth] = sizeMm;
  const points = useMemo(() => {
    const half = [width, height, depth].map(size => m(size / 2 + 3));
    const corners = Array.from({ length: 8 }, (_, i): Vec3 => [half[0] * (i & 1 ? 1 : -1), half[1] * (i & 2 ? 1 : -1), half[2] * (i & 4 ? 1 : -1)]);
    const edges: Vec3[] = [];
    corners.forEach((corner, i) => { for (const bit of [1, 2, 4]) if (!(i & bit)) edges.push(corner, corners[i | bit]); });
    return edges;
  }, [width, height, depth]);
  return <Line points={points} segments color={selectionColor} lineWidth={selectionLineWidth} depthTest={depthTest} depthWrite={false} toneMapped={false} raycast={() => {}}/>;
}
