import type { RenovationState } from '../types';

const viewKeys = ['hiddenFloors', 'hiddenGroups', 'exploded', 'background', 'sunHour'] as const;
export const editSnapshot = (state: RenovationState) => Object.fromEntries(Object.entries(state).filter(([key]) => !viewKeys.includes(key as typeof viewKeys[number])));
// Immutable state shares unchanged branches, including large image strings.
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a,b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys=(value:object)=>Object.keys(value).filter(key=>(value as Record<string,unknown>)[key]!==undefined);
  const left=keys(a),right=keys(b);
  return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&sameValue((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));
}
export const sameEdits=(a:RenovationState,b:RenovationState)=>sameValue(editSnapshot(a),editSnapshot(b));
const edits=editSnapshot;
export class EditHistory {
  past: ReturnType<typeof edits>[] = [];
  future: ReturnType<typeof edits>[] = [];
  private grouped = false;
  private recorded = false;
  current: RenovationState;
  private limit: number;
  constructor(current: RenovationState, limit = 30) { this.current=current; this.limit=limit; }
  begin() { this.grouped = true; this.recorded = false; }
  end() { this.grouped = false; this.recorded = false; }
  replace(state: RenovationState) { this.current = state; this.past = []; this.future = []; this.end(); }
  update(state: RenovationState) {
    if (!sameEdits(state,this.current)) {
      if (!this.grouped || !this.recorded) { this.past.push(edits(this.current)); if (this.past.length > this.limit) this.past.shift(); }
      this.recorded = true; this.future = [];
    }
    this.current = state; return state;
  }
  travel(redo = false) {
    this.end(); const from = redo ? this.future : this.past, to = redo ? this.past : this.future, snapshot = from.pop();
    if (!snapshot) return this.current;
    to.push(edits(this.current));
    this.current = { ...snapshot, ...Object.fromEntries(viewKeys.map(key => [key, this.current[key]])) } as RenovationState;
    return this.current;
  }
}
