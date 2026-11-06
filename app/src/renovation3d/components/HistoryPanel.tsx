import { useState } from 'react';
import { Pencil, RefreshCw } from 'lucide-react';
import type { PlanMetadata } from '../store/plans-api';

export function HistoryPanel({ history, busy, onRefresh, onLoad, onRename }: {
  history: PlanMetadata[]; busy: boolean; onRefresh: () => Promise<boolean>;
  onLoad: (id: string) => Promise<boolean>; onRename: (id: string, name: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  return <section className="r3d-history"><h3>方案历史<button aria-label="刷新方案历史" title="刷新方案历史" disabled={busy} onClick={() => void onRefresh()}><RefreshCw size={13}/></button></h3>
    {!history.length ? <p className="r3d-subtle">{busy ? '正在读取方案…' : '保存方案后可在这里加载或重命名。'}</p> : <div className="r3d-history-list">{history.map(plan => <div className="r3d-history-item" key={plan.id}>
      {editing?.id === plan.id ? <form onSubmit={event => { event.preventDefault(); void onRename(plan.id, editing.name).then(success => { if (success) setEditing(undefined); }); }}>
        <input aria-label="方案新名称" autoFocus maxLength={80} required value={editing.name} disabled={busy} onChange={event => setEditing({ ...editing, name: event.target.value })}/>
        <button disabled={busy} type="submit">确认</button><button disabled={busy} type="button" onClick={() => setEditing(undefined)}>取消</button>
      </form> : <><button className="r3d-history-load" aria-label={`加载方案${plan.name}`} disabled={busy} onClick={() => void onLoad(plan.id)}>{plan.name}<small>{new Date(plan.createdAt).toLocaleString('zh-CN', { hour12: false })}</small></button><button aria-label={`重命名方案${plan.name}`} title="重命名" disabled={busy} onClick={() => setEditing({ id: plan.id, name: plan.name })}><Pencil size={13}/></button></>}
    </div>)}</div>}
  </section>;
}
