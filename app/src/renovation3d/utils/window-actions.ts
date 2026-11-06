import { buildingConfig as config } from '../config/building-config.ts';
import { windowDesignFor } from '../config/window-config.ts';
import { resolveWindowFinish, validateWindowFinish } from './window-finishes.ts';
import { quoteConfiguration } from './window-quotes.ts';
import { windowNumber } from './delivery-context.ts';
import type { Opening, RenovationState } from '../types';

const windows = config.walls.flatMap(w => w.openings).filter(o => o.kind === 'window');
export function windowTypeKey(opening: Opening, state: RenovationState) {
  const { openingId, ...configuration } = quoteConfiguration(opening, resolveWindowFinish(opening, state));
  const { mode, columns, rows, operablePanels } = windowDesignFor(opening);
  return JSON.stringify([configuration, mode, columns, rows ?? [1], operablePanels ?? null]);
}
export const matchingWindows = (state: RenovationState, key: string) => windows.filter(o => windowTypeKey(o, state) === key).map(o => o.id);
export const windowEditKey = (opening: Opening, state: RenovationState) => JSON.stringify([windowTypeKey(opening, state), resolveWindowFinish(opening, state).quotes ?? []]);
export function captureWindowType(opening: Opening, state: RenovationState) {
  const key = windowTypeKey(opening, state);
  return { key, editKey: windowEditKey(opening, state), ids: matchingWindows(state, key) };
}
export function replaceSameWindows(state: RenovationState, source: Opening, baseline: ReturnType<typeof captureWindowType>) {
  if (windowEditKey(source, state) === baseline.editKey) return { state, count: 0 };
  const finish = resolveWindowFinish(source, state), windowFinishes = { ...state.windowFinishes };
  let count = 0;
  for (const target of windows) {
    if (target.id === source.id || !baseline.ids.includes(target.id) || windowTypeKey(target, state) !== baseline.key) continue;
    const previous = resolveWindowFinish(target, state);
    const copied = (finish.quotes ?? []).map(q => ({ ...q, id: crypto.randomUUID(), status: q.status === 'confirmed' ? 'merchant' as const : q.status, checked: false,
      source: `沿用${windowNumber(source.id)}报价 · ${q.source}`.slice(0, 300), configuration: { ...q.configuration, openingId: target.id } }));
    windowFinishes[target.id] = validateWindowFinish({ ...finish, name: previous.name, quotes: [...(previous.quotes ?? []), ...copied] });
    count++;
  }
  return { state: count ? { ...state, windowFinishes } : state, count };
}
