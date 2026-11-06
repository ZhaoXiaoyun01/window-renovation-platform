import type { Rect, Wall } from '../types';

// A frame must clear every adjacent finish plane, including a recessed head or jamb.
// Corner-only contact with a remote colour zone does not locate the opening.
export function openingOffset(wall: Pick<Wall, 'finishZones'>, opening: Rect): number {
  const offsets = wall.finishZones.filter(zone => {
    const dx = Math.min(opening.x + opening.width, zone.x + zone.width) - Math.max(opening.x, zone.x);
    const dy = Math.min(opening.y + opening.height, zone.y + zone.height) - Math.max(opening.y, zone.y);
    return dx > 1e-6 && dy >= -1e-6 || dy > 1e-6 && dx >= -1e-6;
  }).map(zone => zone.offsetMm);
  return offsets.length ? Math.min(...offsets) : 0;
}
