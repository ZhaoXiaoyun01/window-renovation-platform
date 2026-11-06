import type { GlassUpgrade } from '../types';

export const glassUpgrades = { '5': 28, '6': 55, '8': 203, '10': 350 } as const;
export const glassUpgradeLabel = (spec: GlassUpgrade['spec']) => `${spec}+(6-27)A+${spec}离线LOWE`;
export function validateGlassUpgrade(value: unknown): GlassUpgrade | undefined {
  if (value === undefined) return;
  const upgrade = value as GlassUpgrade;
  if (!upgrade || typeof upgrade.spec !== 'string' || !Object.hasOwn(glassUpgrades, upgrade.spec) || !Number.isFinite(upgrade.pricePerM2) || upgrade.pricePerM2 < 0 || upgrade.pricePerM2 > 1000000) throw new Error('玻璃升级规格或单价无效。');
  return { spec: upgrade.spec, pricePerM2: upgrade.pricePerM2 };
}
