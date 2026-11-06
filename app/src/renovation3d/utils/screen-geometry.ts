import type { Part, Vec3 } from '../types';

// Real bars leave open gaps. The envelope is used only for selection and bounds.
export function screenBars(part: Part): { centerMm: Vec3; sizeMm: Vec3 }[] {
  if (!part.screen) return [];
  const [depth, height, width] = part.sizeMm, { slatWidthMm: slat, gapMm: gap, frameWidthMm: frame } = part.screen;
  const clearWidth = width - frame * 2, clearHeight = height - frame * 2;
  const count = Math.max(1, Math.floor((clearWidth - gap) / (slat + gap)));
  const spacing = (clearWidth - count * slat) / (count + 1);
  return [
    ...[-1, 1].flatMap(sign => [
      { centerMm: [0, sign * (height - frame) / 2, 0] as Vec3, sizeMm: [depth, frame, width] as Vec3 },
      { centerMm: [0, 0, sign * (width - frame) / 2] as Vec3, sizeMm: [depth, clearHeight, frame] as Vec3 },
    ]),
    ...Array.from({ length: count }, (_, i) => ({ centerMm: [0, 0, -clearWidth / 2 + spacing + slat / 2 + i * (slat + spacing)] as Vec3,
      sizeMm: [depth, clearHeight, slat] as Vec3 })),
  ];
}
