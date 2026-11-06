import type { Rect } from '../types';

export type OutlineSegment = [[number, number], [number, number]];

function surfaceGrid(rects: Rect[], holes: Rect[]) {
  const valid = rects.filter(r => r.width > 0 && r.height > 0);
  if (!valid.length) return { xs: [], ys: [], solid: [], gross: [] };
  const bounds = { x: Math.min(...valid.map(r => r.x)), y: Math.min(...valid.map(r => r.y)),
    x2: Math.max(...valid.map(r => r.x + r.width)), y2: Math.max(...valid.map(r => r.y + r.height)) };
  const clipped = holes.map(h => {
    const x = Math.max(bounds.x, h.x), y = Math.max(bounds.y, h.y);
    return { x, y, width: Math.min(bounds.x2, h.x + h.width) - x, height: Math.min(bounds.y2, h.y + h.height) - y };
  }).filter(h => h.width > 0 && h.height > 0);
  const all = valid.concat(clipped);
  const xs = [...new Set(all.flatMap(r => [r.x, r.x + r.width]))].sort((a, b) => a - b);
  const ys = [...new Set(all.flatMap(r => [r.y, r.y + r.height]))].sort((a, b) => a - b);
  const contains = (rect: Rect, x: number, y: number) => x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height;
  const gross = ys.slice(0, -1).map((y, row) => xs.slice(0, -1).map((x, col) => valid.some(r => contains(r, (x + xs[col + 1]) / 2, (y + ys[row + 1]) / 2))));
  const solid = gross.map((row, yi) => row.map((filled, xi) => filled && !clipped.some(h => contains(h, (xs[xi] + xs[xi + 1]) / 2, (ys[yi] + ys[yi + 1]) / 2))));
  return { xs, ys, solid, gross };
}

// Decompose a rectangular union into disjoint solids, merging identical row spans.
export function rectUnion(rects: Rect[], holes: Rect[] = []): Rect[] {
  const { xs, ys, solid } = surfaceGrid(rects, holes), result: Rect[] = [];
  let previous = new Map<string, Rect>();
  solid.forEach((row, yi) => {
    const current = new Map<string, Rect>();
    let start = -1;
    for (let xi = 0; xi <= row.length; xi++) {
      if (row[xi] && start < 0) start = xi;
      if (!row[xi] && start >= 0) {
        const key = `${xs[start]}:${xs[xi]}`, old = previous.get(key);
        const rect = old ?? { x: xs[start], y: ys[yi], width: xs[xi] - xs[start], height: 0 };
        rect.height += ys[yi + 1] - ys[yi];
        if (!old) result.push(rect);
        current.set(key, rect); start = -1;
      }
    }
    previous = current;
  });
  return result;
}

// Outer edges are retained original face boundaries; opening edges are exposed by subtraction.
export function surfaceOutline(rects: Rect[], holes: Rect[] = []) {
  const { xs, ys, solid, gross } = surfaceGrid(rects, holes);
  const segments: OutlineSegment[] = [], outer: OutlineSegment[] = [], openings: OutlineSegment[] = [];
  const occupied = (grid: boolean[][], row: number, col: number) => grid[row]?.[col] ?? false;
  const boundary = (r1: number, c1: number, r2: number, c2: number) => {
    const a = occupied(solid, r1, c1), b = occupied(solid, r2, c2);
    if (a === b) return null;
    return occupied(gross, a ? r2 : r1, a ? c2 : c1) ? 'opening' : 'outer';
  };
  const trace = (axis: number[], kindAt: (i: number) => 'opening' | 'outer' | null, point: (n: number) => [number, number]) => {
    let start = 0, kind: 'opening' | 'outer' | null = null;
    for (let i = 0; i < axis.length; i++) {
      const next = i < axis.length - 1 ? kindAt(i) : null;
      if (next !== kind) {
        if (kind) {
          const segment: OutlineSegment = [point(start), point(axis[i])];
          segments.push(segment); (kind === 'outer' ? outer : openings).push(segment);
        }
        start = axis[i]; kind = next;
      }
    }
  };
  ys.forEach((y, row) => trace(xs, col => boundary(row - 1, col, row, col), x => [x, y]));
  xs.forEach((x, col) => trace(ys, row => boundary(row, col - 1, row, col), y => [x, y]));
  return { segments, outer, openings };
}

// No shared rectangle edges, cut-fragment edges or lines across open door thresholds.
export function outlineSegments(rect: Rect | Rect[], holes: Rect[] = []): OutlineSegment[] {
  return surfaceOutline(Array.isArray(rect) ? rect : [rect], holes).segments;
}
