import { purchaseExplanation,defaultPurchaseRule } from '../utils/purchasing';
import { useState, type ReactNode } from 'react';
import { purchaseTiles, tileQuantityKey, tileQuantityTotals, type TileQuantity } from '../utils/tile-quantities';
import type { Finish, TileMaterial, RenovationState } from '../types';

export function TileQuantityPanel({ scopeRows, allRows, materials, selectedFinish, scopeLabel, children, purchaseRules }: {
  purchaseRules?:RenovationState['purchaseRules'];
  children?: ReactNode;
  scopeRows: TileQuantity[]; allRows: TileQuantity[]; materials: TileMaterial[]; selectedFinish?: Finish; scopeLabel: string;
}) {
  const [mode, setMode] = useState<'scope' | 'same' | 'all'>('scope');
  const activeMode = mode === 'same' && !selectedFinish ? 'scope' : mode;
  const selectedKind = materials.find(m => m.id === selectedFinish?.materialId)?.kind;
  const rows = activeMode === 'all' ? allRows : activeMode === 'same' ? allRows.filter(row => tileQuantityKey(row) === tileQuantityKey({ ...selectedFinish!, kind: selectedKind })) : scopeRows;
  const totals = tileQuantityTotals(rows,purchaseRules), count = (n: number) => n.toLocaleString('zh-CN');
  const paintOnly = rows.length > 0 && rows.every(row => row.kind === 'paint');
  return <section className="r3d-quantities" aria-label="材料用量统计"><h3>{paintOnly ? '漆面用量' : '瓷砖用量'} <small>{activeMode === 'scope' ? scopeLabel : '包含所有楼层'}</small></h3>
    <div className="r3d-quantity-tabs" role="group" aria-label="统计范围">
      <button aria-pressed={activeMode === 'scope'} onClick={() => setMode('scope')}>当前范围</button>
      <button aria-pressed={activeMode === 'same'} disabled={!selectedFinish} onClick={() => setMode('same')}>全楼同种</button>
      <button aria-pressed={activeMode === 'all'} onClick={() => setMode('all')}>全楼全部</button>
    </div>
    {paintOnly ? <dl className="r3d-metric-cards"><div><dt>涂刷面积</dt><dd>{totals.paintArea.toFixed(2)}<small> m²</small></dd></div></dl> : <><dl className="r3d-metric-cards"><div><dt>排版需砖</dt><dd>{count(totals.tiles)}<small> 片</small></dd></div><div><dt>预计购买 · 按材料规则</dt><dd>{count(totals.purchase)}<small> 片</small></dd></div></dl>{totals.paintArea > 0 ? <p className="r3d-subtle">另有漆面 {totals.paintArea.toFixed(2)} m²，不计入砖数。</p> : null}</>}
    {!paintOnly && rows.length > 0 && <p className="r3d-subtle">预计购买合计 {totals.purchaseArea.toFixed(2)} m²</p>}
    <details className="r3d-quantity-details"><summary>用料与铺贴详细信息</summary>
    {paintOnly ? null : rows.length ? <>
      <table><thead><tr><th>材料 / 规格</th><th>需砖/片</th><th>购买/片</th></tr></thead><tbody>{rows.map(row => <tr key={tileQuantityKey(row)}>
        <td>{materials.find(m => m.id === row.materialId)?.name ?? row.materialId}<small>{row.kind === 'paint' ? `涂刷 ${(row.areaMm2 / 1e6).toFixed(2)} m²` : `${row.widthMm} × ${row.heightMm} mm`}</small><small>{purchaseExplanation(row.tiles,purchaseRules?.[row.materialId]??defaultPurchaseRule(row.kind==='paint'),row.kind==='paint'?row.areaMm2/1e6:undefined)}</small></td>
        <td>{row.kind === 'paint' ? '—' : count(row.tiles)}</td><td>{row.kind === 'paint' ? '—' : count(purchaseTiles(row.tiles,purchaseRules?.[row.materialId]))}</td>
      </tr>)}</tbody></table></> : <p className="r3d-subtle">请选择可铺贴面，或切换至全楼统计。</p>}
    <p className="r3d-subtle">{paintOnly ? '漆面为连续纯色，不分砖格。涂料采购量还需产品涂布率及遍数，当前仅统计面积。' : '按模型真实排砖计数，包含边缘裁砖；不同面不复用余料。同材同规格合并，实际预留比例与整箱过程见各行。'}全楼包含隐藏楼层；未建模的施工回铺不计。</p>
    {children}
    </details>
  </section>;
}
