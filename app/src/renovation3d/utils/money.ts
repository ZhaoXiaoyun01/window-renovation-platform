// Multiply decimal inputs exactly and round the sum half-up to integer cents.
// Keep estimates consistent with the exporter's Decimal calculations.
export function amountCents(products: number[][]): number {
  const terms = products.map(factors => factors.reduce(({ value, scale }, factor) => {
    const [mantissa, exponent = '0'] = String(factor).toLowerCase().split('e');
    const decimals = mantissa.split('.')[1]?.length ?? 0, digits = BigInt(mantissa.replace('.', ''));
    const places = decimals - Number(exponent);
    return { value: value * digits * (places < 0 ? 10n ** BigInt(-places) : 1n), scale: scale + Math.max(0, places) };
  }, { value: 1n, scale: 0 }));
  const scale = Math.max(2, ...terms.map(term => term.scale));
  const sum = terms.reduce((total, term) => total + term.value * 10n ** BigInt(scale - term.scale), 0n);
  const divisor = 10n ** BigInt(scale - 2);
  return Number((sum + divisor / 2n) / divisor);
}
