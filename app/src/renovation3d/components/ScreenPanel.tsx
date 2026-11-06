import { buildingConfig as config } from '../config/building-config';
import { colorValid } from '../utils/validation';
import { ColorPicker } from './ColorPicker';
import type { Part, RenovationState } from '../types';

export function ScreenPanel({ part, state, setState }: { part: Part; state: RenovationState; setState: (state: RenovationState) => void }) {
  const color = state.partColors?.[part.id] ?? part.color;
  function update(value: string) {
    if (colorValid(value)) setState({ ...state, partColors: { ...state.partColors, [part.id]: value } });
  }
  return <section className="r3d-face-info">
    <h2 data-selected-object={part.id}>透光格栅</h2>
    <dl className="r3d-metric-cards">
      <div><dt>围护净宽</dt><dd>{part.sizeMm[2]}<small> mm</small></dd></div>
      <div><dt>高度</dt><dd>{part.sizeMm[1]}<small> mm</small></dd></div>
      <div><dt>格栅厚度</dt><dd>{part.sizeMm[0]}<small> mm</small></dd></div>
    </dl>
    <h3>格栅颜色</h3>
    <div className="r3d-materials">{[{ name: '默认深灰', color: part.color }, ...config.materials.slice(0, 4)].map(m =>
      <button key={m.color} aria-label={`格栅使用${m.name}颜色`} aria-pressed={color.toLowerCase() === m.color.toLowerCase()} onClick={() => update(m.color)}>
        <span style={{ backgroundColor: m.color }}/><div>{m.name}</div>
      </button>)}</div>
    <ColorPicker label="格栅颜色" value={color} onChange={update}/>
    <p className="r3d-subtle">颜色实时预览，保存方案后保留。此处为透光杆件围护，后方没有整面侧墙，不作为瓷砖面统计。</p>
  </section>;
}
