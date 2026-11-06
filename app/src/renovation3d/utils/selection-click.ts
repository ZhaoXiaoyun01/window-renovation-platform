export type SelectionGesture = { x: number; y: number; startedAt: number; pointerId: number; moved: boolean; button: number };
const maxMovementPx = 5, maxClickDurationMs = 350;

export function moveSelectionGesture(gesture: SelectionGesture, x: number, y: number): SelectionGesture {
  return { ...gesture, moved: gesture.moved || Math.hypot(x - gesture.x, y - gesture.y) > maxMovementPx };
}

export function isSelectionClick(gesture: SelectionGesture, endedAt: number): boolean {
  return gesture.button === 0 && !gesture.moved && endedAt - gesture.startedAt < maxClickDurationMs;
}
