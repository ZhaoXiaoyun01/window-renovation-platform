import type { GlassType, Opening, Vec3, WindowDesign } from '../types';

type WindowReference = { page: number; status: 'drawing' | 'pending'; image: string; symbol: 'left' | 'right' | 'top'; note: string };
export const windowDesigns: Record<string, WindowDesign> = {};
export const windowEvidence: Record<string, WindowReference> = {};
const front = '微信图片_2026-03-03_185030_943.png', back = '微信图片_2026-03-03_185024_405.png';
const west = '微信图片_2026-03-03_185049_157.png', east = '微信图片_2026-03-03_185036_982.png';
const add = (ids: string[], page: number, image: string, design: WindowDesign, status: WindowReference['status'] = 'drawing') => {
  for (const id of ids) {
    windowDesigns[id] = design;
    windowEvidence[id] = { page, image, status, symbol: design.mode === 'top-hung' ? 'top' : page === 6 || ['entry-side', 'f4-s-glass'].includes(id) ? 'right' : 'left',
      note: '总宽高沿用PDF洞口；分格比例按立面与效果图估计，未标注的分格尺寸及五金节点待核实。' };
  }
};
const fixed = (columns = [1]): WindowDesign => ({ mode: 'fixed', columns, note: '图中未画开启符号，暂按固定分格展示；是否可开启待核实。' });
const casement = (columns = [1], operablePanels = [0], rows?: number[]): WindowDesign => ({
  mode: 'casement', columns, operablePanels, ...(rows ? { rows } : {}),
  note: '按立面开启符号绘制开启扇；内外开、铰链侧及五金型号待核实。亮子仅位于小扇列，未给分格实测尺寸。',
});

add(['f1-s-window'], 5, front, casement([0.24, 0.76], [0], [0.22, 0.78]));
add(['f2-s-window'], 5, front, casement([0.24, 0.76]));
add(['f3-s-window'], 5, front, casement([0.24, 0.76], [0], [0.7, 0.3]));
add(['entry-side'], 5, front, casement([0.7, 0.3], [1], [0.22, 0.78]));
add(['entry-slot', 'f4-s-window'], 5, front, fixed(), 'pending');
add(['f2-balcony-slot', 'f3-balcony-slot'], 5, front, fixed(), 'pending');
windowEvidence['f2-balcony-slot'].note = '二层小窗按用户画线改为600×2700mm，下口100mm、上口2800mm，与旁边落地窗对齐；开启方式仍待核实。';
add(['f2-balcony-door', 'f3-balcony-door'], 5, front, fixed([1, 1, 1]), 'pending');
add(['f4-s-glass'], 5, front, casement([0.83, 0.17], [1]));
add(['f1-n-window', 'f2-n-window'], 6, back, fixed(), 'pending');
add(['f2-n-stair', 'f3-n-stair', 'f4-n-stair'], 6, back, casement());
add(['f4-n-window'], 6, back, casement([0.83, 0.17], [1]));
add(['f1-w-0', 'f1-w-1', 'f1-w-2'], 7, west, casement([1], [0], [0.75, 0.25]));
add(['f2-w-stair', 'f3-w-stair', 'f2-w-0', 'f2-w-1', 'f2-w-2', 'f3-w-0', 'f3-w-1', 'f3-w-2', 'f4-w-b'], 7, west, casement());
add(['f4-w-a'], 7, west, fixed(), 'pending');
add(['f1-w-low'], 7, west, { mode: 'top-hung', columns: [1], operablePanels: [0], note: '西立面低窗的顶部三角开启符号按上悬扇展示；实际开启角度及五金待核实。' });
add(['f1-e-low'], 8, east, fixed([0.72, 0.28]), 'pending');
add(['f1-e-window'], 8, east, casement([0.28, 0.72], [0], [0.75, 0.25]));
add(['f2-e-window', 'f3-e-window', 'f4-e-window'], 8, east, casement([0.28, 0.72]));
add(['f2-e-narrow', 'f3-e-narrow'], 8, east, {
  mode: 'top-hung', columns: [1], operablePanels: [0], note: '东立面顶部三角开启符号与效果图外翻扇相符，按上悬扇示意；实际角度及五金待核实。',
});

export function windowDesignFor(opening: Opening): WindowDesign {
  return opening.design ?? windowDesigns[opening.id] ?? { mode: 'fixed', columns: [1], note: 'pending：该洞口未配置可核实的分格与开启形式，暂绘单格。' };
}

export const glassPresets: Record<GlassType, { label: string; color: string; opacity: number }> = {
  low: { label: '低透 Low-E', color: '#263e49', opacity: 0.92 },
  medium: { label: '中透 Low-E', color: '#68838d', opacity: 0.78 },
  high: { label: '高透 Low-E', color: '#b3c9ce', opacity: 0.66 },
};
export const windowModeLabels: Record<WindowDesign['mode'], string> = { fixed: '固定分格（开启待核实）', sliding: '推拉扇', casement: '开启扇（立面图示）', 'top-hung': '上悬扇（图示）' };
export const windowRender = { handleSizeMm: [18, 90, 12] as Vec3, handleInsetMm: 24, glassDepthRatio: 0.65, symbolDepthRatio: 0.64, doorHandleInsetMm: 100, doorHandleHeightMm: 1000 };
