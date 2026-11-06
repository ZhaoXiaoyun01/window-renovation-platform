import { buildingConfig as config } from '../config/building-config';
import { glassPresets, windowDesignFor, windowEvidence, windowModeLabels } from '../config/window-config';
import { resolveWindowFinish, validateWindowFinish } from '../utils/window-finishes';
import { buildWindowReport } from '../utils/window-report';
import { ColorPicker } from './ColorPicker';
import { PriceField } from './PriceField';
import type { GlassType, Opening, RenovationState, WindowFinish } from '../types';
import { WindowQuoteEditor } from './WindowQuoteEditor';
import { useState } from 'react';
import { glassUpgrades, glassUpgradeLabel } from '../utils/glass-upgrades';
import { captureWindowType, matchingWindows, replaceSameWindows, windowEditKey } from '../utils/window-actions';

export function WindowPanel({ opening, state, setState, onMessage, highlightedWindows, onHighlight }: { opening: Opening; state: RenovationState; setState: (state: RenovationState) => void; onMessage: (message: string) => void; highlightedWindows: string[]; onHighlight: (ids: string[]) => void }) {
  const [baseline, setBaseline] = useState(() => captureWindowType(opening, state));
  const metrics = <dl className="r3d-metric-cards"><div><dt>面积</dt><dd>{(opening.width * opening.height / 1e6).toFixed(2)}<small> m²</small></dd></div><div><dt>周长</dt><dd>{(2 * (opening.width + opening.height) / 1000).toFixed(2)}<small> m</small></dd></div><div><dt>宽度</dt><dd>{opening.width}<small> mm</small></dd></div><div><dt>高度</dt><dd>{opening.height}<small> mm</small></dd></div></dl>;
  if (opening.kind !== 'window') return <section className="r3d-window-panel"><h2 data-selected-object={opening.id}>门参数</h2>{metrics}<p className="r3d-subtle">独立门对象 · {opening.evidence.note}</p></section>;
  const finish = resolveWindowFinish(opening, state), design = windowDesignFor(opening), evidence = windowEvidence[opening.id];
  const quote = buildWindowReport(state).find(row => row.id === opening.id)!;
  const matching = matchingWindows(state, baseline.key).filter(id => id !== opening.id && baseline.ids.includes(id));
  const replacementChanged = windowEditKey(opening, state) !== baseline.editKey;
  function replace() {
    const result = replaceSameWindows(state, opening, baseline);
    if (!result.count) return;
    setState(result.state); setBaseline(captureWindowType(opening, result.state)); onHighlight([]);
    onMessage(`已替换${result.count}樘原同类型窗户的颜色、玻璃、扇数及报价；名称和旧记录保留，沿用报价需逐窗复核。`);
  }
  const colors = [...new Map([{ color: config.openings.frameColor, name: '默认窗框' }, ...state.materials].map(material => [material.color.toLowerCase(), material])).values()];
  function update(changes: Partial<WindowFinish>) {
    try {
      const next = validateWindowFinish({ ...finish, ...changes });
      setState({ ...state, windowFinishes: { ...state.windowFinishes, [opening.id]: next } });
      onMessage('已更新此窗。保存方案以保留修改。');
    } catch (error) { onMessage(error instanceof Error ? error.message : '窗户参数无法应用。'); }
  }
  return <section className="r3d-window-panel">
    <h2 data-selected-object={opening.id}>窗户参数</h2>
    {metrics}
    <dl className="r3d-info-grid"><div><dt>分格 / 开启</dt><dd>{windowModeLabels[design.mode]}</dd></div></dl>
    <p className="r3d-subtle">{quote.code} · {quote.dimensionStatus}；对应立面排版图与Excel配置依据。</p>
    <button className="r3d-highlight" aria-pressed={highlightedWindows.length > 0} onClick={() => onHighlight(highlightedWindows.length ? [] : [opening.id, ...matching])}>高亮全楼原同类型窗户 · {matching.length + 1}樘</button>
    <button className="r3d-apply" disabled={!replacementChanged || !matching.length} onClick={replace}>替换全楼原同类型窗户 · {matching.length}樘</button>
    <details className="r3d-evidence"><summary>同类型匹配规则</summary><p>按选中时的尺寸、分格/开启、窗框颜色、玻璃、扇数及当前单价匹配，名称及历史报价不参与匹配。隐藏楼层也纳入替换；模型洞口尺寸、位置及分格不改变。修改参数或报价后可替换，撤销可整批恢复。</p></details>
    <h3>窗户报价</h3>
    <label className="r3d-price-label">窗户单价 / 元/m²<PriceField label="窗户面积单价" value={finish.pricePerM2!} onChange={pricePerM2 => update({ pricePerM2 })}/></label>
    <label className="r3d-price-label">开启扇单价 / 元/扇<PriceField label="窗户开启扇单价" value={finish.sashPrice!} onChange={sashPrice => update({ sashPrice })}/></label>
    <label className="r3d-price-label">开启扇数<input aria-label="窗户开启扇数" type="number" min="0" max="100" step="1" value={quote.sashCount} onChange={e => { if (e.target.value !== '') update({ sashCount: Number(e.target.value) }); }}/></label>
    <label>玻璃升级规格<select aria-label="玻璃升级规格" value={finish.glassUpgrade?.spec ?? ''} onChange={e => { const spec = e.target.value as keyof typeof glassUpgrades; update({ glassUpgrade: spec ? { spec, pricePerM2: glassUpgrades[spec] } : undefined }); }}><option value="">无升级（不加价）</option>{Object.keys(glassUpgrades).map(spec => <option key={spec} value={spec}>{glassUpgradeLabel(spec as keyof typeof glassUpgrades)}</option>)}</select></label>
    {finish.glassUpgrade && <label className="r3d-price-label">玻璃升级单价 / 元/m²<PriceField label="玻璃升级单价" value={finish.glassUpgrade.pricePerM2} onChange={pricePerM2 => update({ glassUpgrade: { ...finish.glassUpgrade!, pricePerM2 } })}/></label>}
    <dl className="r3d-info-grid"><div><dt>玻璃升级加价</dt><dd>¥{(quote.upgradeAmountCents / 100).toFixed(2)}</dd></div></dl>
    <div className="r3d-estimate"><span>此窗总价</span><strong>¥{((quote.amountCents ?? 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
    <p className="r3d-subtle">总价=窗户面积×（窗户单价+玻璃升级单价）+开启扇数×每扇加价。基础两项默认各500元；升级初始价按用户提供，均可修改。升级按窗户总面积计，不扣窗框；旧方案默认不升级。统计表实时同步，保存方案后保留。</p>
    <WindowQuoteEditor key={opening.id} {...{opening,state,setState}}/>
    <h3>窗框颜色</h3>
    <div className="r3d-materials">{colors.map(material => <button key={material.color.toLowerCase()} aria-label={`窗框使用${material.name}颜色`} aria-pressed={finish.frameColor.toLowerCase() === material.color.toLowerCase()}
      className={finish.frameColor.toLowerCase() === material.color.toLowerCase() ? 'selected' : ''} onClick={() => update({ frameColor: material.color })}>
      <span style={{ backgroundColor: material.color }}/><div>{material.name}</div>
    </button>)}</div>
    <ColorPicker label="窗框颜色" value={finish.frameColor} onChange={frameColor => update({ frameColor })}/>
    <h3>Low-E 玻璃</h3>
    <label>透光效果<select aria-label="Low-E玻璃透光" value={finish.glassType} onChange={event => update({ glassType: event.target.value as GlassType })}>
      {Object.entries(glassPresets).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
    </select></label>
    <p className="r3d-subtle">低透较暗，高透较亮。这是视觉模拟预设，不代表产品实测 VLT 或隔热性能。</p>
    <details className="r3d-evidence"><summary>窗格依据与待核实项</summary>
      <p>{evidence ? `PDF 第 ${evidence.page} 页及所提供效果图；${evidence.status === 'pending' ? '开启形式待核实。' : '按立面图示分格。'}` : 'pending：未找到可核实的窗格配置。'}</p>
      <p>{design.note}</p><p>{evidence?.note}</p><p>选中时的细线仅表示开启扇图示，未模拟实际开启角度。</p>
    </details>
  </section>;
}
