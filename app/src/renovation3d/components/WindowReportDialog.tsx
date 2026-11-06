import { clientTimestamp } from '../utils/delivery-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { buildWindowReport, updateWindow, windowExportPayload, windowHeadings, windowReportTotals, windowRowValues } from '../utils/window-report';
import { matchesColumnSelections, type ColumnSelections } from '../utils/report-filters';
import { PriceField } from './PriceField';
import { ReportFilters } from './ReportFilters';
import type { RenovationState, WindowFinish } from '../types';
import { glassUpgrades, glassUpgradeLabel } from '../utils/glass-upgrades';

const number = (value: number, digits = 0) => value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export function WindowReportDialog({ state, setState, planName,planId, onClose }: { planId?:string; state: RenovationState; setState: (state: RenovationState) => void; planName: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), request = useRef<AbortController | null>(null);
  const [filters, setFilters] = useState<ColumnSelections>([]), [name, setName] = useState(planName), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [filterEnabled, setFilterEnabled] = useState(false);
  const all = useMemo(() => buildWindowReport(state), [state.windowFinishes]);
  const rows = all.filter(row => matchesColumnSelections(windowRowValues(row), filters)), totals = windowReportTotals(rows);
  useEffect(() => { const el = dialog.current!, previous = document.activeElement as HTMLElement | null; el.showModal(); return () => { request.current?.abort(); el.close(); previous?.focus(); }; }, []);
  function edit(id: string, changes: Partial<WindowFinish>) {
    try { setState(updateWindow(state, id, changes)); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '窗户参数无效。'); }
  }
  async function download() {
    if (request.current || !rows.length || !name.trim()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const response = await fetch('/api/renovation3d/window-report/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify(windowExportPayload(rows, name.trim(), clientTimestamp(),planId)) });
      if (!response.ok) throw new Error('窗户统计表导出失败，请重试。');
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 60)}-窗户统计表.xlsx`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '导出失败。'); }
    finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <dialog ref={dialog} className="r3d-report-dialog r3d-window-dialog" aria-labelledby="r3d-window-report-title" onCancel={onClose}>
    <div className="r3d-report-head"><div><h2 id="r3d-window-report-title">窗户统计表</h2><p>独立窗户清单 · 包含隐藏楼层 · 不含门、阳台敞口和格栅</p></div><button aria-label="关闭窗户统计表" onClick={onClose}><X size={18}/></button></div>
    <div className="r3d-report-body">
      <div className="r3d-report-actions"><button aria-pressed={filterEnabled} onClick={() => { setFilterEnabled(!filterEnabled); setFilters([]); }}>{filterEnabled ? '关闭筛选' : '开启筛选'}</button><button onClick={() => setFilters([])}>清除筛选</button><label>方案名称（用于导出）<input aria-label="窗表方案名称" maxLength={80} value={name} onChange={e => setName(e.target.value)}/></label>
        <button className="r3d-report-download" disabled={busy || !rows.length || !name.trim()} onClick={() => void download()}><Download size={15}/>{busy ? '正在导出…' : '保存窗户 Excel'}</button></div>
      <div className="r3d-report-metrics"><div><span>当前筛选窗户 / 开口扇</span><strong>{totals.count} 樘 / {totals.sashes} 扇</strong></div><div><span>窗户面积</span><strong>{number(totals.area, 3)} m²</strong></div><div><span>已报价小计 · {totals.unpriced}樘待报价</span><strong>¥{number(totals.amountCents / 100, 2)}</strong></div></div>
      <p className="r3d-report-note">总价 = 窗户面积×（窗户单价+玻璃升级单价）+开口扇数×每扇加价；升级按窗户总面积另计。未选择升级不加价，初始升级单价由用户提供，可修改。表内编辑实时统计，保存方案后保留；导出为当前筛选快照。</p>
      <p className="r3d-report-note">初始开口扇数来自当前示意窗格，未核实的开启方式仍需现场确认；数量可手动修正。开启筛选后可从各表头下拉勾选内容。</p>
      <details className="r3d-evidence"><summary>尺寸与报价依据（{rows.length}樘）</summary>{rows.map(row => <p key={row.id}>{row.code} · {row.name} · {row.dimensionStatus}；{row.quote.label} · {row.quote.source} · {row.quote.date}</p>)}</details>
      {error && <p role="alert" className="r3d-input-error">{error}</p>}
      <div className="r3d-report-scroll" role="region" aria-label="独立窗户统计表" tabIndex={0}><table className="r3d-report-table r3d-window-table"><caption>各楼层窗户明细</caption><colgroup>{[60, 140, 70, 70, 80, 100, 95, 105, 60, 90, 95, 160, 90, 95, 105].map((width, index) => <col key={index} style={{ width }}/>)}</colgroup>
        <thead><ReportFilters headings={windowHeadings} {...{ filters }} values={all.map(windowRowValues)} enabled={filterEnabled} onChange={setFilters}/></thead>
        <tbody>{rows.map(row => <tr key={row.id} data-window-row={row.id}>
          <th scope="row">{row.floor}</th><td><input aria-label={`${row.id}名称`} maxLength={80} defaultValue={row.name} key={row.name} onBlur={e => { if (e.target.value.trim() !== row.name) edit(row.id, { name: e.target.value }); }}/></td>
          <td>{row.widthMm}</td><td>{row.heightMm}</td><td>{number(row.area, 3)}</td><td><span className="r3d-swatch" style={{ backgroundColor: row.frameColor }}/>{row.frameColor.toUpperCase()}</td><td>{row.glass}</td><td>{row.mode}</td>
          <td><input type="number" min="0" max="100" step="1" aria-label={`${row.id}开口扇数`} value={row.sashCount} onChange={e => { if (e.target.value !== '') edit(row.id, { sashCount: Number(e.target.value) }); }}/></td>
          <td><PriceField label={`${row.id}面积单价`} value={row.pricePerM2!} onChange={pricePerM2 => edit(row.id, { pricePerM2 })}/></td>
          <td><PriceField label={`${row.id}开口扇单价`} value={row.sashPrice!} onChange={sashPrice => edit(row.id, { sashPrice })}/></td>
          <td><select aria-label={`${row.id}玻璃升级规格`} value={row.glassUpgrade?.spec ?? ''} onChange={e => { const spec = e.target.value as keyof typeof glassUpgrades; edit(row.id, { glassUpgrade: spec ? { spec, pricePerM2: glassUpgrades[spec] } : undefined }); }}><option value="">无升级</option>{Object.keys(glassUpgrades).map(spec => <option key={spec} value={spec}>{glassUpgradeLabel(spec as keyof typeof glassUpgrades)}</option>)}</select></td>
          <td>{row.glassUpgrade ? <PriceField label={`${row.id}玻璃升级单价`} value={row.upgradePrice} onChange={pricePerM2 => edit(row.id, { glassUpgrade: { ...row.glassUpgrade!, pricePerM2 } })}/> : '—'}</td>
          <td>{number(row.upgradeAmountCents / 100, 2)}</td>
          <td>{row.amountCents === undefined ? '待报价' : number(row.amountCents / 100, 2)}</td>
        </tr>)}{!rows.length && <tr><td colSpan={15}>没有符合筛选条件的窗户。</td></tr>}</tbody>
        <tfoot><tr className="r3d-report-total"><th colSpan={4}>筛选合计 · {totals.count} 樘</th><td>{number(totals.area, 3)}</td><td colSpan={3}>—</td><td>{totals.sashes}</td><td colSpan={4}>{totals.unpriced ? `${totals.unpriced}樘待报价` : '已全部报价'}</td><td>{number(totals.upgradeAmountCents / 100, 2)}</td><td>{number(totals.amountCents / 100, 2)}</td></tr></tfoot>
      </table></div>
    </div>
  </dialog>;
}
