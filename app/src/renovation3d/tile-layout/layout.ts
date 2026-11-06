import type { Layout, Rect, TileSettings } from '../types';

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 1e-7 && height > 1e-7 ? { x, y, width, height } : null;
}

// Four disjoint rectangles, rather than four overlapping strips.
export function subtract(a: Rect, hole: Rect): Rect[] {
  const b = intersect(a, hole);
  if (!b) return [a];
  return [
    { x: a.x, y: a.y, width: a.width, height: b.y - a.y },
    { x: a.x, y: b.y + b.height, width: a.width, height: a.y + a.height - b.y - b.height },
    { x: a.x, y: b.y, width: b.x - a.x, height: b.height },
    { x: b.x + b.width, y: b.y, width: a.x + a.width - b.x - b.width, height: b.height },
  ].filter(r => r.width > 1e-7 && r.height > 1e-7);
}
export const clipHoles = (rect: Rect, holes: Rect[]) => holes.reduce<Rect[]>((pieces, hole) => pieces.flatMap(p => subtract(p, hole)), [rect]);
export const area = (rect: Rect) => rect.width * rect.height;
export const tileDimensions = (settings: TileSettings) => ({
  width: settings.direction === 'horizontal' ? Math.max(settings.widthMm, settings.heightMm) : Math.min(settings.widthMm, settings.heightMm),
  height: settings.direction === 'horizontal' ? Math.min(settings.widthMm, settings.heightMm) : Math.max(settings.widthMm, settings.heightMm),
});

export function validateTile(settings: TileSettings) {
  for (const n of [settings.widthMm, settings.heightMm]) {
    if (!Number.isFinite(n) || n < 20 || n > 2400) throw new Error('瓷砖边长须为 20–2400 mm。');
  }
  if (!Number.isFinite(settings.groutMm) || settings.groutMm < 0 || settings.groutMm > 20) throw new Error('砖缝须为 0–20 mm。');
  if (!['horizontal', 'vertical'].includes(settings.direction) || !['edge', 'center'].includes(settings.alignment)) throw new Error('铺贴参数无效。');
}

export function layoutTiles(width: number, height: number, holes: Rect[], settings: TileSettings, maxCells = 6000): Layout {
  validateTile(settings);
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('墙面尺寸须为正数。');
  if (holes.some(h => ![h.x, h.y, h.width, h.height].every(Number.isFinite) || h.width <= 0 || h.height <= 0 || h.x < 0 || h.y < 0 || h.x + h.width > width + 1e-6 || h.y + h.height > height + 1e-6)) throw new Error('洞口超出墙面或尺寸无效。');
  const { width: w, height: h } = tileDimensions(settings);
  const px = w + settings.groutMm, py = h + settings.groutMm;
  const phase = (size: number, pitch: number) => {
    if (settings.alignment === 'edge') return 0;
    const count = Math.ceil((size + settings.groutMm) / pitch);
    return (size - (count * pitch - settings.groutMm)) / 2;
  };
  const ox = phase(width, px), oy = phase(height, py);
  const cols = Math.ceil((width - ox) / px), rows = Math.ceil((height - oy) / py);
  if (cols * rows > maxCells) throw new Error('当前规格产生过多砖格，请增大瓷砖规格后再应用。');
  const result: Layout = { pieces: [], sourceTiles: 0, cutTiles: 0, narrowPieces: 0, tileAreaMm2: 0, netAreaMm2: clipHoles({ x: 0, y: 0, width, height }, holes).reduce((sum, r) => sum + area(r), 0) };
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const tile = { x: ox + col * px, y: oy + row * py, width: w, height: h };
    const clipped = intersect(tile, { x: 0, y: 0, width, height });
    if (!clipped) continue;
    const fragments = clipHoles(clipped, holes);
    if (!fragments.length) continue;
    result.sourceTiles++;
    const cut = fragments.length !== 1 || Math.abs(area(fragments[0]) - area(tile)) > 1e-5;
    if (cut) result.cutTiles++;
    for (const piece of fragments) {
      result.pieces.push({ ...piece, sourceTileId: `${row}:${col}`, row, col, cut,
        uv: [(piece.x - tile.x) / w, (piece.y - tile.y) / h, (piece.x + piece.width - tile.x) / w, (piece.y + piece.height - tile.y) / h] });
      result.tileAreaMm2 += area(piece);
      if (Math.min(piece.width, piece.height) < 100) result.narrowPieces++;
    }
  }
  return result;
}
