import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFoliateEvents } from '@/app/reader/hooks/useFoliateEvents';
import type { FoliateView } from '@/types/view';

afterEach(cleanup);

describe('reader event callbacks', () => {
  it('uses the updated reading callback after consent changes without reopening the book', () => {
    const target = Object.assign(new EventTarget(), { renderer: new EventTarget() });
    const view = target as unknown as FoliateView;
    const beforeConsent = vi.fn();
    const afterConsent = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ onRelocate }) => useFoliateEvents(view, { onRelocate }),
      { initialProps: { onRelocate: beforeConsent } },
    );
    target.dispatchEvent(new Event('relocate'));
    expect(beforeConsent).toHaveBeenCalledTimes(1);
    rerender({ onRelocate: afterConsent });
    target.dispatchEvent(new Event('relocate'));
    expect(afterConsent).toHaveBeenCalledTimes(1);
    expect(beforeConsent).toHaveBeenCalledTimes(1);
    unmount();
    target.dispatchEvent(new Event('relocate'));
    expect(afterConsent).toHaveBeenCalledTimes(1);
  });
});
