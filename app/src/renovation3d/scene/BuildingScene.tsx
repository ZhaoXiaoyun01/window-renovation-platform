import { Component, useEffect, useId, useRef, useMemo, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import { buildingConfig as config } from '../config/building-config';
import { m, metres } from '../utils/units';
import { FaceMesh, WallMesh } from './WallMesh';
import { editableBuildingFaces, floorOffsetMm, modelGroups, modelWalls, partViewGroup } from '../utils/model-surfaces';
import { StructureMesh } from './StructureMesh';
import { structuralShell } from '../utils/structural-shell';
import { cameraNavigation,cameraLimits,type CameraCommand } from '../utils/camera-navigation';
export type { CameraCommand } from '../utils/camera-navigation';
import { sunlight } from '../utils/sunlight';
import { useColorSampling } from '../components/ColorPicker';
import { type WebGLRenderer } from 'three';
import { isObjectVisible, visibleFace } from '../utils/view-groups';
import { BoxSelectionOutline } from './SelectionOutline';
import { ScreenMesh } from './ScreenMesh';
import { sceneEnvironment } from '../config/scene-environment';
import { isSelectionClick, moveSelectionGesture, type SelectionGesture } from '../utils/selection-click';
import type { RenovationState, Vec3 } from '../types';
import type { Bounds } from '../utils/geometry';
import type { CameraLink } from './camera-link';

function CameraController({ command, bounds, cameraLink }: { command: CameraCommand; bounds:Bounds; cameraLink?:CameraLink }) {
  const controls = useRef<Controls>(null);
  const { camera, invalidate } = useThree();
  const identity=useId(),syncing=useRef(false);
  useEffect(()=>cameraLink?.subscribe(pose=>{if(pose.source===identity||!controls.current)return;syncing.current=true;camera.position.set(...pose.position);controls.current.target.set(...pose.target);controls.current.update();invalidate();syncing.current=false;}),[cameraLink,identity,camera,invalidate]);
  useEffect(() => {
    if (!controls.current) return;
    const pose=cameraNavigation({position:camera.position.toArray() as Vec3,target:controls.current.target.toArray() as Vec3},command,bounds);
    // Flush residual rotation/pan before an explicit pose, so damping cannot move the reset centre.
    const damping=controls.current.enableDamping;
    controls.current.enableDamping=false;controls.current.update();
    controls.current.target.set(...pose.target);camera.position.set(...pose.position);
    controls.current.update();controls.current.enableDamping=damping;invalidate();
    // View controls are explicit commands; hiding/exploding floors preserves the user's orbit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.sequence, camera, invalidate]);
  return <OrbitControls ref={controls} makeDefault enableDamping={!cameraLink} dampingFactor={0.1} minDistance={cameraLimits.min} maxDistance={cameraLimits.max} maxPolarAngle={Math.PI * 0.92} onChange={()=>{if(cameraLink&&!syncing.current&&controls.current)cameraLink.emit({source:identity,position:camera.position.toArray() as Vec3,target:controls.current.target.toArray() as Vec3});}}/>;
}
const faces = editableBuildingFaces();
function Model({ state, selectedObject, highlighted, highlightedWindows, onSelect }: { highlightedWindows: string[]; highlighted: Set<string>; state: RenovationState; selectedObject: string; onSelect: (id: string, wallId?: string, faceId?: string) => void }) {
  return <group name={config.id}><StructureMesh state={state}/>
    {[modelGroups[0], ...config.floors].map(floor => <group key={floor.id} name={floor.id} position={[0, state.exploded ? m(floorOffsetMm(floor.id === 'base' ? 'f1' : floor.id, floor.id === 'base' ? 'base' : undefined)) : 0, 0]}>
      {faces.filter(f => (f.viewGroup === 'base' ? 'base' : f.floorId) === floor.id).map(f => { const face = visibleFace(f, state); return face ? <FaceMesh key={face.id} {...{ face, state, selectedObject, onSelect }} highlighted={highlighted.has(face.id)}/> : null; })}
      {modelWalls.filter(w => w.floorId === floor.id && isObjectVisible(w, state)).map(w => <WallMesh key={w.id} {...{ wall: w, state, selectedObject, onSelect, highlightedWindows }}/>)}
      {config.parts.filter(p => ['rail','screen'].includes(p.kind) && (partViewGroup(p) === 'base' ? 'base' : p.floorId) === floor.id && isObjectVisible({ ...p, viewGroup: partViewGroup(p) }, state)).map(p => p.kind === 'screen' ? <ScreenMesh key={p.id} part={p} color={state.partColors?.[p.id] ?? p.color} selected={selectedObject === p.id} onSelect={onSelect}/> : <mesh key={p.id} name={p.id} position={metres(p.centerMm)} receiveShadow onClick={e => { e.stopPropagation(); onSelect(p.id); }}>
          <boxGeometry args={metres(p.sizeMm)}/><meshStandardMaterial color={p.color} roughness={0.25} transparent opacity={0.48}/>
          {selectedObject === p.id && <BoxSelectionOutline sizeMm={p.sizeMm}/>}
        </mesh>)}
    </group>)}
  </group>;
}
class SceneBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="r3d-scene-error" role="alert">3D场景无法加载：{this.state.error}<p>请确认浏览器支持 WebGL，或刷新后重试。</p></div> : this.props.children; }
}
export function BuildingScene({ state, selectedObject, onSelect, onClearSelection, command, onReady, highlighted, highlightedWindows = [], cameraLink,focusBounds }: {highlightedWindows?:string[]; focusBounds?:Bounds; highlighted: Set<string>; state: RenovationState; selectedObject: string; onSelect: (id: string, wallId?: string, faceId?: string) => void; onClearSelection: () => void; command: CameraCommand; onReady: () => void; cameraLink?:CameraLink }) {
  const bounds=useMemo(()=>structuralShell(state).bounds,[state.hiddenFloors,state.hiddenGroups,state.exploded]);
  const helper=focusBounds??command.focus;
  const renderer = useRef<WebGLRenderer | null>(null), sampling = useColorSampling();
  const gesture = useRef<SelectionGesture | null>(null), clickAllowed = useRef(false);
  const sun = sunlight(state.sunHour ?? 12);
  const sunny = state.background === 'sunny', environment = sunny ? sceneEnvironment.sunny : sceneEnvironment.studio;
  return <div className="r3d-canvas" data-sampling={!!sampling.active} onPointerDownCapture={event => {
    clickAllowed.current = false;
    gesture.current = { x: event.clientX, y: event.clientY, startedAt: event.timeStamp, pointerId: event.pointerId, moved: false, button: event.button };
  }} onPointerMoveCapture={event => {
    if (gesture.current?.pointerId === event.pointerId) gesture.current = moveSelectionGesture(gesture.current, event.clientX, event.clientY);
  }} onPointerUpCapture={event => {
    if (gesture.current?.pointerId === event.pointerId) clickAllowed.current = isSelectionClick(moveSelectionGesture(gesture.current, event.clientX, event.clientY), event.timeStamp);
    gesture.current = null;
  }} onPointerCancelCapture={() => { gesture.current = null; clickAllowed.current = false; }} onClickCapture={event => {
    if (sampling.active && clickAllowed.current && renderer.current && event.target === renderer.current.domElement) {
      event.stopPropagation(); const gl = renderer.current, box = gl.domElement.getBoundingClientRect(), pixel = new Uint8Array(4), context = gl.getContext();
      const x = Math.max(0, Math.min(gl.domElement.width - 1, Math.floor((event.clientX - box.left) / box.width * gl.domElement.width)));
      const y = Math.max(0, Math.min(gl.domElement.height - 1, gl.domElement.height - 1 - Math.floor((event.clientY - box.top) / box.height * gl.domElement.height)));
      context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      sampling.pick(`#${[...pixel.slice(0, 3)].map(n => n.toString(16).padStart(2, '0')).join('')}`);
    } else if (!clickAllowed.current) event.stopPropagation();
    clickAllowed.current = false;
  }}><SceneBoundary><Canvas shadows frameloop="demand" dpr={[1, 1.75]} camera={{ position: metres(config.scene.cameraMm), fov: 42, near: 0.1, far: 250 }} onPointerMissed={onClearSelection}
    gl={{ antialias: true, preserveDrawingBuffer: true }} onCreated={({ gl }) => { renderer.current = gl; gl.domElement.setAttribute('aria-label', '住宅外立面3D场景'); requestAnimationFrame(onReady); }}
    fallback={<div className="r3d-scene-error" role="alert">住宅外立面3D场景需要支持 WebGL 的浏览器。</div>}>
    <color attach="background" args={[environment.background]}/>
    <ambientLight intensity={sun.ambient}/><hemisphereLight args={['#ffffff', '#929d88', 1.4]}/>
    <directionalLight position={sun.position} intensity={sun.intensity} color={sun.color} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={25} shadow-camera-bottom={-18} shadow-normalBias={0.04}/>
    <Model {...{ state, selectedObject, onSelect, highlighted, highlightedWindows }}/>
    {helper&&<group name="inspection-location-helper" position={metres(helper.min.map((n,i)=>(n+helper.max[i])/2) as Vec3)}><BoxSelectionOutline sizeMm={helper.max.map((n,i)=>Math.max(40,n-helper.min[i])) as Vec3} depthTest={false}/></group>}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, sceneEnvironment.groundY, 0]} receiveShadow onClick={event => { event.stopPropagation(); onClearSelection(); }}><planeGeometry args={[m(config.scene.groundSizeMm), m(config.scene.groundSizeMm)]}/><meshStandardMaterial color={environment.ground} roughness={1}/></mesh>
    {!sunny && <gridHelper args={[32, 16, '#dedee2', '#eaeaec']} position={[0, sceneEnvironment.gridY, 0]} raycast={() => {}}/>}
    <CameraController command={command} bounds={bounds} cameraLink={cameraLink}/>
  </Canvas></SceneBoundary>{sampling.active && <div className="r3d-sampling-notice" role="status">{sampling.active}：点击模型吸取颜色 · Esc取消<button onClick={sampling.cancel}>取消取色</button></div>}</div>;
}
