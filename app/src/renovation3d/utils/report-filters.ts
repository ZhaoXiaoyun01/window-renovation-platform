export type ColumnSelections = (string[] | undefined)[];
export const matchesColumnSelections = (values: (string | number)[], filters: ColumnSelections, except = -1) => values.every((value, index) => index === except || filters[index] === undefined || filters[index]!.includes(String(value)));

// Retained for the 3.0 historical contract.
export function matchesReportFilters(values: (string | number)[], filters: string[]) {
  return values.every((value, index) => {
    const query = (filters[index] ?? '').trim();
    if (!query) return true;
    if (typeof value === 'number') {
      const range = query.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/);
      if (range) return value >= Number(range[1]) && value <= Number(range[2]);
      const compare = query.match(/^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/);
      if (!compare) return false;
      const target = Number(compare[2]);
      return compare[1] === '>=' ? value >= target : compare[1] === '<=' ? value <= target : compare[1] === '>' ? value > target : compare[1] === '<' ? value < target : Math.abs(value - target) < .0005;
    }
    return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
}
