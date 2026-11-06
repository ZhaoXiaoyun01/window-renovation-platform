import { Eye, EyeOff, Layers, RotateCcw, Plus, Minus, Table2 } from 'lucide-react';
import { buildingConfig as config } from '../config/building-config';
import { facadeLabels } from '../utils/units';
import { modelGroups } from '../utils/model-surfaces';
import { timeLabel } from '../utils/sunlight';
import type { Facade, RenovationState, View } from '../types';

export type ApplicationScope = 'face' | 'floor' | 'facade' | 'all';
export function ViewControls({ state, floor, setFloor, setState, view, onView, onZoom, scope, setScope, facade, setFacade, onReport, onWindows }: {
  state: RenovationState; floor: string; setFloor: (id: string) => void; setState: (s: RenovationState) => void;
  view: View; onView: (v: View) => void; onZoom: (factor: number) => void;
  scope: ApplicationScope; setScope: (scope: ApplicationScope) => void; facade: Facade; setFacade: (v: Facade) => void;
  onReport: () => void; onWindows: () => void;
}) {
  return <div className="r3d-toolbar" aria-label="场景工具栏">
    <div className="r3d-tool-group r3d-floor-tabs" aria-label="楼层控制"><span>楼层</span>
      <button className={floor === 'all' ? 'active' : ''} aria-pressed={floor === 'all'} onClick={() => { setFloor('all'); setState({ ...state, hiddenFloors: [], hiddenGroups: [] }); }}>全楼</button>
      {[modelGroups[0], ...config.floors, ...modelGroups.slice(1)].map(item => {
        const group = modelGroups.find(g => g.id === item.id), hidden = group ? !!state.hiddenGroups?.includes(group.id) : state.hiddenFloors.includes(item.id);
        return <div className="r3d-floor-tab" key={item.id}><button className={floor === item.id ? 'active' : ''} aria-pressed={floor === item.id} onClick={() => setFloor(item.id)}>{item.label}</button>
          <button title={`${hidden ? '显示' : '隐藏'}${item.label}`} aria-label={`${hidden ? '显示' : '隐藏'}${item.label}`} aria-pressed={!hidden} onClick={() => setState(group ? { ...state, hiddenGroups: hidden ? state.hiddenGroups!.filter(id => id !== group.id) : [...(state.hiddenGroups ?? []), group.id] } : { ...state, hiddenFloors: hidden ? state.hiddenFloors.filter(id => id !== item.id) : [...state.hiddenFloors, item.id] })}>{hidden ? <EyeOff size={14}/> : <Eye size={14}/>}</button>
        </div>;
      })}
    </div>
    <div className="r3d-tool-group r3d-facade-tabs" aria-label="立面视角"><span>视角</span>
      <button className={view === 'perspective' ? 'active' : ''} aria-pressed={view === 'perspective'} onClick={() => onView('perspective')}>整体</button>
      {(Object.keys(facadeLabels) as Facade[]).map(v => <button key={v} className={view === v ? 'active' : ''} aria-pressed={view === v} onClick={() => { setFacade(v); onView(v); }}>{facadeLabels[v]}</button>)}
    </div>
    <label className="r3d-compact-view">视角<select aria-label="场景视角" value={view} onChange={event => { const next = event.target.value as View; if (next !== 'perspective') setFacade(next); onView(next); }}><option value="perspective">整体</option>{(Object.keys(facadeLabels) as Facade[]).map(v => <option key={v} value={v}>{facadeLabels[v]}</option>)}</select></label>
    <div className="r3d-tool-group r3d-camera-tools" aria-label="相机控制">
      <button title="放大" aria-label="放大" onClick={() => onZoom(0.8)}><Plus size={16}/></button>
      <button title="缩小" aria-label="缩小" onClick={() => onZoom(1.25)}><Minus size={16}/></button>
      <button title="视角复位" aria-label="视角复位" onClick={() => onView('perspective')}><RotateCcw size={16}/></button>
      <button className={state.exploded ? 'active' : ''} aria-label="拆分楼层" aria-pressed={state.exploded} onClick={() => setState({ ...state, exploded: !state.exploded })}><Layers size={16}/>拆分</button>
    </div>
    <label className="r3d-sun" title="示意日照：6:00–18:00，非真实地点日照分析">日照<input aria-label="日照时间" type="range" min="6" max="18" step="0.25" value={state.sunHour ?? 12} onChange={e => setState({ ...state, sunHour: Number(e.target.value) })}/><output>{timeLabel(state.sunHour ?? 12)}</output></label>
    <div className="r3d-tool-group r3d-scope"><label>应用范围<select aria-label="应用范围" value={scope} onChange={e => setScope(e.target.value as ApplicationScope)}>
      <option value="face">选中面</option><option value="floor">所选楼层</option><option value="facade">所选立面</option><option value="all">全楼</option>
    </select></label>
      {scope === 'facade' ? <label>立面<select aria-label="装修立面" value={facade} onChange={e => setFacade(e.target.value as Facade)}>{(Object.keys(facadeLabels) as Facade[]).map(v => <option key={v} value={v}>{facadeLabels[v]}</option>)}</select></label> : null}
      <label>背景<select aria-label="场景背景" value={state.background ?? 'studio'} onChange={event => setState({ ...state, background: event.target.value as RenovationState['background'] })}><option value="studio">素色背景</option><option value="sunny">晴天天空</option></select></label>
    </div>
    <div className="r3d-tool-group r3d-report-tools"><button className="r3d-report-open" onClick={onReport}><Table2 size={14}/>材料与价格表</button><button className="r3d-report-open" onClick={onWindows}><Table2 size={14}/>窗户统计表</button></div>
  </div>;
}
