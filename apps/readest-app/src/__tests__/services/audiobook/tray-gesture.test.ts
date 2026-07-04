import { describe, expect, it } from 'vitest';
import { TRAY_DRAG_THRESHOLD_PX, resolveTrayDragIntent } from '@/services/audiobook/trayGesture';

// v2 PRD §5.2/5.3: dragging the tray handle up expands to the fullscreen
// player, dragging it down dismisses the tray. Small wiggles do nothing.
describe('resolveTrayDragIntent', () => {
  it('expands when dragged up past the threshold', () => {
    expect(resolveTrayDragIntent(-TRAY_DRAG_THRESHOLD_PX)).toBe('expand');
    expect(resolveTrayDragIntent(-200)).toBe('expand');
  });

  it('dismisses when dragged down past the threshold', () => {
    expect(resolveTrayDragIntent(TRAY_DRAG_THRESHOLD_PX)).toBe('dismiss');
    expect(resolveTrayDragIntent(200)).toBe('dismiss');
  });

  it('does nothing for small movements', () => {
    expect(resolveTrayDragIntent(0)).toBeNull();
    expect(resolveTrayDragIntent(-(TRAY_DRAG_THRESHOLD_PX - 1))).toBeNull();
    expect(resolveTrayDragIntent(TRAY_DRAG_THRESHOLD_PX - 1)).toBeNull();
  });

  it('honors a custom threshold', () => {
    expect(resolveTrayDragIntent(-20, 20)).toBe('expand');
    expect(resolveTrayDragIntent(19, 20)).toBeNull();
  });
});
