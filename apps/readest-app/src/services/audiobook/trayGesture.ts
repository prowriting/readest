export type TrayDragIntent = 'expand' | 'dismiss';

export const TRAY_DRAG_THRESHOLD_PX = 48;

/**
 * Resolve a vertical drag on the tray handle (v2 PRD §5.2/5.3): dragging up
 * past the threshold expands the fullscreen player, dragging down dismisses
 * the tray; anything smaller is treated as an accidental wiggle.
 */
export const resolveTrayDragIntent = (
  dyPx: number,
  threshold: number = TRAY_DRAG_THRESHOLD_PX,
): TrayDragIntent | null => {
  if (dyPx <= -threshold) return 'expand';
  if (dyPx >= threshold) return 'dismiss';
  return null;
};
