import { buildingConfig as config } from '../config/building-config.ts';
import { windowDesignFor } from '../config/window-config.ts';
import type { Opening, Rect, RenovationState, WindowFinish } from '../types';
import { validateQuotes } from './window-quotes.ts';
import { validateGlassUpgrade } from './glass-upgrades.ts';

export const defaultWindowFinish = (): WindowFinish => ({ frameColor: config.openings.frameColor, glassType: 'medium', pricePerM2: 500, sashPrice: 500 });

export function validateWindowFinish(value: unknown): WindowFinish {
  if (!value || typeof value !== 'object') throw new Error('窗户参数无效。');
  const finish = value as WindowFinish;
  if (typeof finish.frameColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(finish.frameColor) || !['low', 'medium', 'high'].includes(finish.glassType)) throw new Error('窗框颜色或玻璃透光类型无效。');
  if (finish.name !== undefined && (typeof finish.name !== 'string' || !finish.name.trim() || finish.name.length > 80)) throw new Error('窗户名称须为1至80个字符。');
  for (const field of ['pricePerM2', 'sashPrice', 'sashCount'] as const) {
    const n = finish[field];
    if (n !== undefined && (!Number.isFinite(n) || n < 0 || n > (field === 'sashCount' ? 100 : 1000000) || field === 'sashCount' && !Number.isInteger(n))) throw new Error('窗户单价或开口扇数量无效。');
  }
  const glassUpgrade = validateGlassUpgrade(finish.glassUpgrade);
  if(finish.quotes!==undefined)validateQuotes(finish.quotes);
  return { frameColor: finish.frameColor, glassType: finish.glassType, ...(glassUpgrade ? { glassUpgrade } : {}), ...(finish.name === undefined ? {} : { name: finish.name.trim() }),
    ...(finish.pricePerM2 === undefined ? {} : { pricePerM2: finish.pricePerM2 }), ...(finish.sashPrice === undefined ? {} : { sashPrice: finish.sashPrice }),
    ...(finish.sashCount === undefined ? {} : { sashCount: finish.sashCount }),...(finish.quotes===undefined?{}:{quotes:finish.quotes.map(q=>({...q,configuration:{...q.configuration}}))}) };
}

export const resolveWindowFinish = (opening: Opening, state: RenovationState): WindowFinish => ({ ...defaultWindowFinish(), ...state.windowFinishes?.[opening.id] });

// Rows run from bottom to top. Where a design has operable columns, transoms
// stay inside those columns; the largest row is the operable sash.
export function windowGeometry(opening: Opening, frameMm = config.openings.frameMm) {
  const design = windowDesignFor(opening), { width: w, height: h } = opening;
  const f = Math.min(frameMm, w / 4, h / 4), innerW = w - 2 * f, innerH = h - 2 * f;
  const positions = (weights: number[], start: number, size: number) => {
    const total = weights.reduce((sum, n) => sum + n, 0), edges = [start];
    for (const weight of weights) edges.push(edges[edges.length - 1] + size * weight / total);
    return edges;
  };
  const columns = positions(design.columns, f, innerW);
  const frames: Rect[] = [{ x: 0, y: 0, width: w, height: f }, { x: 0, y: h - f, width: w, height: f },
    { x: 0, y: f, width: f, height: innerH }, { x: w - f, y: f, width: f, height: innerH }];
  for (const x of columns.slice(1, -1)) frames.push({ x: x - f / 2, y: f, width: f, height: innerH });
  const panes: (Rect & { column: number; row: number; operable: boolean })[] = [];
  for (let column = 0; column < design.columns.length; column++) {
    const operable = design.mode !== 'fixed' && (design.operablePanels ?? design.columns.map((_, i) => i)).includes(column);
    const weights = design.rows && (!design.operablePanels || operable) ? design.rows : [1];
    const rows = positions(weights, f, innerH), largest = weights.indexOf(Math.max(...weights));
    const left = columns[column] + (column ? f / 2 : 0), right = columns[column + 1] - (column < design.columns.length - 1 ? f / 2 : 0);
    for (const y of rows.slice(1, -1)) frames.push({ x: left, y: y - f / 2, width: right - left, height: f });
    for (let row = 0; row < weights.length; row++) {
      const bottom = rows[row] + (row ? f / 2 : 0), top = rows[row + 1] - (row < weights.length - 1 ? f / 2 : 0);
      panes.push({ x: left, y: bottom, width: right - left, height: top - bottom, column, row, operable: operable && row === largest });
    }
  }
  return { design, frames, panes };
}
