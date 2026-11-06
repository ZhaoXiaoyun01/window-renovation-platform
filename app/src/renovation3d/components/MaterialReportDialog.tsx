import { purchaseExplanation,defaultPurchaseRule } from '../utils/purchasing';
import { clientTimestamp } from '../utils/delivery-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { buildMaterialReport, materialRowValues, reportExportPayload, reportRegions, reportTotals, textureLabels, type ReportLine } from '../utils/material-report';
import { ReportFilters } from './ReportFilters';
import { matchesColumnSelections, type ColumnSelections } from '../utils/report-filters';
import type { RenovationState, WallFace } from '../types';

const number = (value: number, decimals = 0) => value.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const headings = ['楼层／区域', '材料名称', '材料类型', '纹理／规格', '净铺贴面积 m²', '排版片数', '预购片数', '预购面积 m²', '单价 元/m²', '预估材料费 元','材料编号','颜色','箱数'];

function TotalRow({ rows, label }: { rows: ReportLine[]; label: string }) {
  const total = reportTotals(rows);
  return <tr className="r3d-report-total"><th colSpan={4} scope="row">{label}</th><td>{number(total.area, 3)}</td><td>{number(total.tiles)}</td><td>{number(total.purchase)}</td>
    <td>{number(total.purchaseArea, 3)}</td><td>—</td><td>{number(total.amountCents / 100, 2)}</td><td>—</td><td>—</td><td>{rows.reduce((n,r)=>n+r.boxes,0)}<small>仅整箱</small></td></tr>;
}

export function MaterialReportDialog({ state, faces, planName,planId, onClose }: { planId?:string; state: RenovationState; faces: WallFace[]; planName: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), detailPanel = useRef<HTMLElement>(null), request = useRef<AbortController | null>(null);
  const [tab, setTab] = useState<'floors' | 'all'>('floors'), [selected, setSelected] = useState<ReportLine>();
  const [name, setName] = useState(planName), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [filters, setFilters] = useState<ColumnSelections>([]), [filterEnabled, setFilterEnabled] = useState(false);
  const report = useMemo(() => buildMaterialReport(faces, state), [faces, state.finishes, state.faceFinishes, state.faceRegionFinishes, state.materials,state.purchaseRules]);
  useEffect(() => { const el = dialog.current!, previous = document.activeElement as HTMLElement | null; el.showModal(); return () => { request.current?.abort(); el.close(); previous?.focus(); }; }, []);
  useEffect(() => { if (selected) detailPanel.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const unfilteredGroups = tab === 'floors' ? report.regions : [{ id: 'all', label: '全楼', rows: report.summary }];
  const filterValues = unfilteredGroups.flatMap(group => group.rows.map(row => materialRowValues(row, group.label)));
  const groups = unfilteredGroups.map(group => ({ ...group, rows: group.rows.filter(row => matchesColumnSelections(materialRowValues(row, group.label), filters)) })).filter(group => group.rows.length);
  const selectedDetails = selected ? report.details.filter(detail => detail.key === selected.key && (selected.regionId === 'all' || detail.regionId === selected.regionId)) : [];
  const activeRows = groups.flatMap(group => group.rows), total = reportTotals(activeRows);

  async function download() {
    if (request.current || !name.trim() || !activeRows.length) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const generatedAt = clientTimestamp();
      const allowed = new Set(groups.flatMap(group => group.rows.map(row => `${group.id}:${row.key}`)));
      const filtered = { ...report, regions: report.regions.map(region => ({ ...region, rows: region.rows.filter(row => allowed.has(`${tab === 'all' ? 'all' : region.id}:${row.key}`)) })) };
      const response = await fetch('/api/renovation3d/material-report/export', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportExportPayload(filtered, name.trim(), generatedAt,planId)), signal: controller.signal });
      if (!response.ok) throw new Error('Excel 导出失败，请重试。');
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a');
      const filename = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 60);
      anchor.href = url; anchor.download = `${filename}-材料与价格表-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Excel 导出失败，请重试。'); }
    finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  return <dialog ref={dialog} className="r3d-report-dialog" aria-labelledby="r3d-report-title" onCancel={onClose}>
    <div className="r3d-report-head"><div><h2 id="r3d-report-title">材料与价格表</h2><p>仅统计已覆盖材料的室外面 · 包含隐藏楼层 · 点击材料名称查看详情</p></div>
      <button aria-label="关闭材料与价格表" onClick={onClose}><X size={18}/></button></div>
    <div className="r3d-report-body">
      <div className="r3d-report-actions"><div className="r3d-report-tabs" role="tablist" aria-label="报表视图">
        {(['floors', 'all'] as const).map((value, index) => <button key={value} id={`r3d-report-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="r3d-report-table" tabIndex={tab === value ? 0 : -1}
          onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = index ? 'floors' : 'all'; setTab(next); setFilters([]); setSelected(undefined); document.getElementById(`r3d-report-tab-${next}`)?.focus(); } }}
          onClick={() => { setTab(value); setFilters([]); setSelected(undefined); }}>{value === 'floors' ? '分层明细' : '整楼汇总'}</button>)}
      </div><label>方案名称（用于导出）<input aria-label="报表方案名称" maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label>
        <button className="r3d-report-download" disabled={busy || !name.trim() || !activeRows.length} onClick={() => void download()}><Download size={15}/>{busy ? '正在导出…' : '保存 Excel'}</button></div>
      <div className="r3d-report-metrics"><div><span>净铺贴面积</span><strong>{number(total.area, 3)} <small>m²</small></strong></div>
        <div><span>排版 / 预购</span><strong>{number(total.tiles)} / {number(total.purchase)} <small>片</small></strong></div>
        <div><span>{tab === 'all' ? '整楼合并采购材料费' : '分区分别采购材料费'}</span><strong>¥{number(total.amountCents / 100, 2)}</strong></div></div>
      <p className="r3d-report-note">瓷砖按材料预留比例、整箱规则采购，材料费按采购面积×单价计算；漆面按面积及其预留比例估算，片数不适用。单价沿用当前方案，预设价为演示估算。不含人工、辅料及运费。</p>
      <p className="r3d-report-note">当前为{tab==='floors'?'分层分别采购：每一分层行单独预留、整箱进位，合计为各行采购之和。':'整楼合并采购：同材料同规格先合并，再预留和整箱进位；可能小于分层采购之和。'}箱数仅统计已启用整箱的材料；散片和漆面显示—。跨楼层／露台的同一砖格按覆盖面积最大区域归属，只计一次。</p>
      <p className="r3d-report-note">开启筛选后，点击表头下拉勾选内容；汇总和导出跟随筛选。<button aria-pressed={filterEnabled} onClick={() => { setFilterEnabled(!filterEnabled); setFilters([]); setSelected(undefined); }}>{filterEnabled ? '关闭筛选' : '开启筛选'}</button><button onClick={() => { setFilters([]); setSelected(undefined); }}>清除筛选</button></p>
      {error ? <p className="r3d-input-error" role="alert">{error}</p> : null}
      <div id="r3d-report-table" role="tabpanel" aria-labelledby={`r3d-report-tab-${tab}`}>
        <div className="r3d-report-scroll" role="region" aria-label={tab === 'floors' ? '分层用料明细表' : '整楼材料汇总表'} tabIndex={0}>
          <table className="r3d-report-table r3d-purchase-table"><caption>{tab === 'floors' ? '底座、各楼层及露台／屋顶用料明细' : '整楼按材料及规格合并汇总'}</caption>
            <colgroup>{[7,11,6,10,8,6,6,8,7,9,10,6,6].map((width, index) => <col key={index} style={{ width: `${width}%` }}/>)}</colgroup>
            <thead><ReportFilters {...{ headings, filters }} values={filterValues} enabled={filterEnabled} onChange={next => { setFilters(next); setSelected(undefined); }}/></thead>
            {groups.map(group => <tbody key={group.id} aria-label={group.label}>
              {group.rows.map(row => <tr key={row.key} data-report-row={`${group.id}:${row.key}`} className={selected === row ? 'r3d-report-selected' : undefined}>
                <th scope="row">{group.label}</th><td><button className="r3d-report-material" aria-label={`查看${group.label}${row.material.name}材料详情`} onClick={() => setSelected(row)}>{row.material.name}</button></td>
                <td>{row.kind === 'paint' ? '漆面' : '瓷砖'}</td><td>{textureLabels[row.material.texture]}{row.kind !== 'paint' && <small>{row.widthMm} × {row.heightMm} mm</small>}</td>
                <td>{number(row.areaMm2 / 1e6, 3)}</td><td>{row.kind === 'paint' ? '—' : number(row.tiles)}</td><td>{row.kind === 'paint' ? '—' : number(row.purchase)}</td>
                <td>{number(row.purchaseArea, 3)}</td><td>{number(row.unitPrice, 2)}</td><td>{number(row.amountCents / 100, 2)}</td><td>{row.codes.join(' / ')}</td><td><span className="r3d-material-swatch" style={{backgroundColor:row.material.color}}/>{row.material.color.toUpperCase()}</td><td>{row.kind==='paint'||!row.rule?.fullBoxes?'—':row.boxes}</td>
              </tr>)}
              {tab === 'floors' ? <TotalRow rows={group.rows} label={`${group.label}小计`}/> : null}
            </tbody>)}
            {!activeRows.length && <tbody><tr><td colSpan={13}>没有符合筛选条件的已覆盖用料。</td></tr></tbody>}
            <tfoot><TotalRow rows={activeRows} label={tab === 'floors' ? '分区分别采购合计' : '整楼合并采购合计'}/></tfoot>
          </table>
        </div>
      </div>
      {selected ? <section ref={detailPanel} className="r3d-report-detail" aria-label="材料详细信息"><div className="r3d-report-detail-head"><div className="r3d-report-sample" data-texture={selected.material.texture} style={{ backgroundColor: selected.material.color,
        backgroundImage: selected.material.image ? `url(${selected.material.image})` : undefined }}/><div><h3>{selected.material.name}</h3><p>{selected.kind === 'paint' ? '漆面' : '瓷砖'} · {textureLabels[selected.material.texture]} · ¥{number(selected.unitPrice, 2)}/m²</p></div>
        <button aria-label="关闭材料详情" onClick={() => setSelected(undefined)}><X size={16}/></button></div>
        <p className="r3d-report-note">{selected.regionId === 'all' ? '全楼' : reportRegions.find(region => region.id === selected.regionId)?.label} · {selectedDetails.length} 个对应面。分面排版片数沿用上方砖格归属，采购按本汇总行实际规则计算，不跨面复用裁切余料。</p><p className="r3d-report-note" data-purchase-process>{purchaseExplanation(selected.tiles,selected.rule??defaultPurchaseRule(selected.kind==='paint'),selected.kind==='paint'?selected.areaMm2/1e6:undefined)}</p>
        <ul>{selectedDetails.map(detail => <li key={`${detail.regionId}:${detail.faceId}`}><div><strong>{reportRegions.find(region => region.id === detail.regionId)?.label} · {detail.faceLabel}</strong>
          <span>{number(detail.areaMm2 / 1e6, 3)} m²{detail.kind !== 'paint' ? ` · 排版 ${number(detail.tiles)} 片` : ''}</span></div>
          {detail.kind === 'paint' ? <p>连续纯色漆面 · 颜色 {selected.material.color.toUpperCase()}</p> : <p>{detail.finish.widthMm} × {detail.finish.heightMm} mm · {detail.finish.direction === 'horizontal' ? '长边横铺' : '长边竖铺'} · {detail.finish.alignment === 'edge' ? '墙角起铺' : '居中起铺'} · 砖缝 {detail.finish.groutMm} mm / {detail.finish.groutColor.toUpperCase()} · 材料颜色 {selected.material.color.toUpperCase()}</p>}</li>)}</ul>
      </section> : null}
      <p className="r3d-report-note">Excel 保存「分层明细」「整楼汇总」两张用量表及采购规则、材料编号、交付说明，按当前筛选保存编辑方案快照；室内面、未覆盖材料的结构封底不计；方案和材料库仍分别保存。</p>
    </div>
  </dialog>;
}
