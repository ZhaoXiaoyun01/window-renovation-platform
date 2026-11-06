import type { Vec3 } from '../types';

// Illustrative east -> south -> west arc, with noon on the south facade (+Z).
// No geographic coordinates/date are assumed, so this is a lighting preview.
export function sunlight(hour: number) {
  const angle = (hour - 6) / 12 * Math.PI;
  return { position: [30 * Math.cos(angle), Math.max(2, 30 * Math.sin(angle)), 16 * Math.sin(angle)] as Vec3,
    intensity: 1.1 + 1.6 * Math.sin(angle), ambient: .65 + .65 * Math.sin(angle), color: hour < 8 || hour > 16 ? '#ffd7a8' : '#ffffff' };
}
export const timeLabel = (hour: number) => `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round(hour % 1 * 60)).padStart(2, '0')}`;
