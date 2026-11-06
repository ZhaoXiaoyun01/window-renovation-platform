import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Pipette, X } from 'lucide-react';

const SamplingContext = createContext<{ active: string; request: (label: string, receive: (color: string) => void) => void; pick: (color: string) => void; cancel: () => void } | null>(null);
export const useColorSampling = () => useContext(SamplingContext)!;
export function ColorSamplingProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(''), receive = useRef<((color: string) => void) | null>(null);
  const cancel = useCallback(() => { receive.current = null; setActive(''); }, []);
  const request = useCallback((label: string, callback: (color: string) => void) => { receive.current = callback; setActive(label); }, []);
  const pick = useCallback((color: string) => { const callback = receive.current; cancel(); callback?.(color); }, [cancel]);
  useEffect(() => { if (!active) return; const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } }; window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true); }, [active, cancel]);
  return <SamplingContext.Provider value={{ active, request, pick, cancel }}>{children}</SamplingContext.Provider>;
}

const presets = [{ name: '米白', color: '#e7e5dc' }, { name: '深灰', color: '#494e50' }, { name: '浅灰', color: '#a6aaa5' }, { name: '暖砂', color: '#b7a48c' }, { name: '白色', color: '#ffffff' }, { name: '黑色', color: '#1f2527' }, { name: '浅灰砖缝', color: '#bbb9b4' }];
export const rgbColor = (values: string[]) => values.length === 3 && values.every(value => /^\d{1,3}$/.test(value) && Number(value) <= 255) ? `#${values.map(value => Number(value).toString(16).padStart(2, '0')).join('')}` : undefined;
const hsvOf = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  return { h: d === 0 ? 0 : ((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360, s: max ? d / max : 0, v: max };
};
const hsvColor = (h: number, s: number, v: number) => `#${[5, 3, 1].map(n => {
  const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
}).join('')}`;

export function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const sampling = useColorSampling(), menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), latest = useRef(onChange), id = useId(); latest.current = onChange;
  const [open, setOpen] = useState(false), [hue, setHue] = useState(() => hsvOf(value).h), hsv = hsvOf(value);
  const [hex, setHex] = useState(value), [rgb, setRgb] = useState(() => [1, 3, 5].map(i => String(parseInt(value.slice(i, i + 2), 16))));
  useEffect(() => { setHex(value); setRgb([1, 3, 5].map(i => String(parseInt(value.slice(i, i + 2), 16)))); const next = hsvOf(value); if (next.s > 0) setHue(next.h); }, [value]);
  function toggle() {
    const el = menu.current!;
    if (el.matches(':popover-open')) { el.hidePopover(); return; }
    const field = trigger.current!, panel = field.closest('.r3d-panel')!.getBoundingClientRect(), rect = field.getBoundingClientRect();
    el.style.width = `${Math.min(304, panel.width - 32, window.innerWidth - 24)}px`;
    el.style.maxHeight = `${Math.min(window.innerHeight - 24, panel.height - 24)}px`;
    el.showPopover();
    el.style.left = `${Math.max(12, Math.min(panel.right - el.offsetWidth - 16, window.innerWidth - el.offsetWidth - 12))}px`;
    el.style.top = `${Math.max(12, panel.top + 12, Math.min(rect.bottom + 8, Math.min(panel.bottom, window.innerHeight) - el.offsetHeight - 12))}px`;
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function selectPoint(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    onChange(hsvColor(hue, Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), Math.max(0, Math.min(1, 1 - (event.clientY - box.top) / box.height))));
  }
  return <div className="r3d-color-field"><span>{label}</span><button ref={trigger} className="r3d-color-trigger" aria-label={`选择${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={toggle}><span className="r3d-color-current"><i style={{ backgroundColor: value }}/>{value.toUpperCase()}</span></button>
    <div id={id} ref={menu} popover="auto" role="dialog" aria-label={`${label}选择器`} className="r3d-color-popup" onToggle={e => setOpen(e.currentTarget.matches(':popover-open'))} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.current!.hidePopover(); trigger.current!.focus(); } }}>
    <div className="r3d-color-popup-head"><strong>{label}</strong><button aria-label={`关闭${label}选择器`} onClick={() => { menu.current!.hidePopover(); trigger.current!.focus(); }}><X size={16}/></button></div>
    <div className="r3d-color-presets" aria-label={`${label}预设颜色`}>{presets.map(preset => <button key={preset.color} aria-label={`${label}使用${preset.name}`} aria-pressed={value.toLowerCase() === preset.color} onClick={() => onChange(preset.color)} title={preset.name} style={{ backgroundColor: preset.color }}/>)}</div>
    <button className="r3d-color-sample" onClick={() => { menu.current!.hidePopover(); sampling.request(label, color => latest.current(color)); }}><Pipette size={14}/>吸管吸取模型颜色</button>
    <div className="r3d-color-plane" role="slider" tabIndex={0} aria-label={`${label}颜色面板`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.v * 100)} aria-valuetext={`饱和度${Math.round(hsv.s * 100)}%，明度${Math.round(hsv.v * 100)}%`} style={{ backgroundColor: `hsl(${hue} 100% 50%)` }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); selectPoint(event); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) selectPoint(event); }} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault();
      onChange(hsvColor(hue, Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowRight' ? .01 : event.key === 'ArrowLeft' ? -.01 : 0))), Math.max(0, Math.min(1, hsv.v + (event.key === 'ArrowUp' ? .01 : event.key === 'ArrowDown' ? -.01 : 0)))));
    }}><i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}/></div>
    <label className="r3d-hue-field">色相<input aria-label={`${label}色相`} type="range" min="0" max="360" value={hue} onChange={event => { const h = Number(event.target.value); setHue(h); onChange(hsvColor(h, hsv.s, hsv.v)); }}/></label>
    <div className="r3d-rgb-fields">{['R', 'G', 'B'].map((channel, index) => <label key={channel}>{channel}<input aria-label={`${label}${channel}`} inputMode="numeric" value={rgb[index]} onChange={e => { const next = [...rgb]; next[index] = e.target.value; setRgb(next); const color = rgbColor(next); if (color) onChange(color); }}/></label>)}</div>
    <label className="r3d-hex-field">HEX<input aria-label={`${label}HEX`} value={hex} maxLength={7} onChange={e => { setHex(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }}/></label>
    <p className="r3d-subtle">吸管读取模型显示颜色（含当前光照）；RGB范围0–255。</p>
    </div>
  </div>;
}
