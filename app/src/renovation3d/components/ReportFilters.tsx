import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Filter } from 'lucide-react';
import { matchesColumnSelections, type ColumnSelections } from '../utils/report-filters';

function FilterMenu({ heading, choices, selected, position, onApply, onClose }: {
  heading: string; choices: { key: string; label: string }[]; selected?: string[]; position: { left: number; top: number };
  onApply: (selection?: string[]) => void; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState(''), [draft, setDraft] = useState(() => new Set(selected ?? choices.map(c => c.key)));
  const visible = choices.filter(choice => choice.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  useEffect(() => { const el = menu.current!; el.showPopover(); el.querySelector('input')?.focus(); return () => { if (el.matches(':popover-open')) el.hidePopover(); }; }, []);
  return <div ref={menu} popover="auto" className="r3d-filter-menu" role="dialog" aria-label={`${heading}筛选菜单`} style={position}
    onToggle={e => { if (!e.currentTarget.matches(':popover-open')) onClose(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); menu.current?.hidePopover(); } }}>
    <strong>{heading}</strong><input aria-label="搜索筛选内容" placeholder="搜索" value={search} onChange={e => setSearch(e.target.value)}/>
    <label><input type="checkbox" aria-label="全选筛选值" checked={visible.length > 0 && visible.every(choice => draft.has(choice.key))} onChange={e => {
      const next = new Set(draft); for (const choice of visible) { if (e.target.checked) next.add(choice.key); else next.delete(choice.key); } setDraft(next);
    }}/>（全选）</label>
    <div className="r3d-filter-values">{visible.map(choice => <label key={choice.key}><input type="checkbox" aria-label={`筛选值：${choice.label}`} checked={draft.has(choice.key)} onChange={e => { const next = new Set(draft); if (e.target.checked) next.add(choice.key); else next.delete(choice.key); setDraft(next); }}/><span>{choice.label}</span></label>)}{!visible.length && <p>无匹配项</p>}</div>
    <button onClick={() => { onApply(undefined); onClose(); }}>清除此列筛选</button><div className="r3d-filter-actions"><button onClick={() => { const selection = (search ? visible : choices).filter(choice => draft.has(choice.key)).map(choice => choice.key); onApply(selection.length === choices.length ? undefined : selection); onClose(); }}>确定</button><button onClick={onClose}>取消</button></div>
  </div>;
}

export function ReportFilters({ headings, filters, onChange, values, enabled }: { headings: string[]; filters: ColumnSelections; onChange: (filters: ColumnSelections) => void; values: (string | number)[][]; enabled: boolean }) {
  const [open, setOpen] = useState<{ column: number; left: number; top: number }>();
  const choices = useMemo(() => open ? [...new Map(values.filter(row => matchesColumnSelections(row, filters, open.column)).map(row => {
    const value = row[open.column], key = String(value); return [key, { key, value, label: typeof value === 'number' ? value.toLocaleString('zh-CN', { maximumFractionDigits: 6 }) : value || '（空白）' }] as const;
  })).values()].sort((a, b) => typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : a.label.localeCompare(b.label, 'zh-CN')) : [], [open?.column, values, filters]);
  return <tr>{headings.map((heading, column) => <th key={heading} scope="col"><span className="r3d-filter-heading">{heading}{enabled && <button aria-label={`${heading}筛选下拉`} aria-expanded={open?.column === column} className={filters[column] !== undefined ? 'filtered' : ''} onClick={e => {
    const rect = e.currentTarget.getBoundingClientRect(); setOpen({ column, left: Math.max(10, Math.min(rect.left - 240, window.innerWidth - 290)), top: Math.max(10, Math.min(rect.bottom + 5, window.innerHeight - 420)) });
  }}>{filters[column] !== undefined ? <Filter size={12}/> : <ChevronDown size={12}/>}</button>}</span>
    {enabled && open?.column === column && <FilterMenu key={column} heading={heading} {...{ choices }} selected={filters[column]} position={{ left: open.left, top: open.top }} onClose={() => setOpen(undefined)} onApply={selection => { const next = [...filters]; next[column] = selection; onChange(next); }}/>}</th>)}</tr>;
}
