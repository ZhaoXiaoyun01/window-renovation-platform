import { buildingConfig as config } from '../config/building-config.ts';
import { glassPresets, windowModeLabels, windowDesignFor } from '../config/window-config.ts';
import { facadeLabels } from './units.ts';
import { resolveWindowFinish, validateWindowFinish, windowGeometry } from './window-finishes.ts';
import { amountCents as priceCents } from './money.ts';
import type { RenovationState, WindowFinish } from '../types';
import { quoteInfo } from './window-quotes.ts';
import { deliveryMetadata,windowNumber } from './delivery-context.ts';
import { glassUpgradeLabel } from './glass-upgrades.ts';

export const windowHeadings = ['楼层', '窗户名称', '宽度 mm', '高度 mm', '面积 m²', '窗框颜色', '玻璃', '开启方式', '开口扇数', '单价 元/m²', '开口扇单价 元/扇', '玻璃升级规格', '升级单价 元/m²', '升级金额 元', '总价 元'];
export function buildWindowReport(state: RenovationState) {
  return config.walls.flatMap(wall => wall.openings.filter(o => o.kind === 'window').map((opening, index) => {
    const finish = resolveWindowFinish(opening, state), area = opening.width * opening.height / 1e6;
    const floor = config.floors.find(f => f.id === wall.floorId)!.label;
    const name = finish.name ?? `${facadeLabels[wall.facade]} · 窗${index + 1}`;
    const sashCount = finish.sashCount ?? windowGeometry(opening).panes.filter(pane => pane.operable).length;
    const priced = finish.pricePerM2 !== undefined && (sashCount === 0 || finish.sashPrice !== undefined);
    const upgradePrice = finish.glassUpgrade?.pricePerM2 ?? 0;
    const upgradeAmountCents = priceCents([[opening.width, opening.height, 1e-6, upgradePrice]]);
    const amountCents = priced ? priceCents([[opening.width, opening.height, 1e-6, finish.pricePerM2!], [sashCount, finish.sashPrice ?? 0], [opening.width, opening.height, 1e-6, upgradePrice]]) : undefined;
    return { id: opening.id, floorId: wall.floorId, floor, name, widthMm: opening.width, heightMm: opening.height, area,
      frameColor: finish.frameColor, glassType: finish.glassType, glass: glassPresets[finish.glassType].label, glassUpgrade: finish.glassUpgrade, upgradeSpec: finish.glassUpgrade ? glassUpgradeLabel(finish.glassUpgrade.spec) : '无升级', upgradePrice, upgradeAmountCents, mode: windowModeLabels[windowDesignFor(opening).mode], sashCount, pricePerM2: finish.pricePerM2, sashPrice: finish.sashPrice, amountCents,quote:quoteInfo(opening,finish),quotes:finish.quotes,code:windowNumber(opening.id),dimensionStatus:opening.evidence.status==='drawing'?'图纸标注值 · 待现场复核':'模型值 · 待核实',dimensionNote:opening.evidence.note };
  }));
}
export type WindowReportRow = ReturnType<typeof buildWindowReport>[number];
export const windowRowValues = (row: WindowReportRow) => [row.floor, row.name, row.widthMm, row.heightMm, row.area, row.frameColor, row.glass, row.mode, row.sashCount,
  row.pricePerM2 ?? '未设置', row.sashPrice ?? '未设置', row.upgradeSpec, row.upgradePrice, row.upgradeAmountCents / 100, row.amountCents === undefined ? '待报价' : row.amountCents / 100];
export const windowReportTotals = (rows: WindowReportRow[]) => rows.reduce((total, row) => ({ count: total.count + 1, area: total.area + row.area,
  sashes: total.sashes + row.sashCount, upgradeAmountCents: total.upgradeAmountCents + row.upgradeAmountCents, amountCents: total.amountCents + (row.amountCents ?? 0), unpriced: total.unpriced + Number(row.amountCents === undefined) }), { count: 0, area: 0, sashes: 0, upgradeAmountCents: 0, amountCents: 0, unpriced: 0 });
export function updateWindow(state: RenovationState, id: string, changes: Partial<WindowFinish>) {
  const opening = config.walls.flatMap(w => w.openings).find(o => o.id === id && o.kind === 'window');
  if (!opening) throw new Error('窗户不存在。');
  const finish = validateWindowFinish({ ...resolveWindowFinish(opening, state), ...changes });
  return { ...state, windowFinishes: { ...state.windowFinishes, [id]: finish } };
}
export const windowExportPayload = (rows: WindowReportRow[], name: string, generatedAt: string,basePlanId='') => ({ name, generatedAt,metadata:deliveryMetadata(basePlanId), rows: rows.map(({ id, floorId, name, widthMm, heightMm, frameColor, glassType, mode, sashCount, pricePerM2, sashPrice,glassUpgrade,quotes,code,dimensionStatus,dimensionNote }) => ({ id, floorId, name, widthMm, heightMm, frameColor, glassType, mode, sashCount, pricePerM2, sashPrice,code,dimensionStatus,dimensionNote,...(glassUpgrade?{glassUpgrade}:{}),...(quotes?{quotes}:{}) })) });
