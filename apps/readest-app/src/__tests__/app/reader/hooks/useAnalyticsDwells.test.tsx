import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsStatus } from '@/types/book';

const h = vi.hoisted(() => ({
  initialBook: { hash: 'qa-book', analyticsStatus: 'ask' as AnalyticsStatus },
  libraryBook: { hash: 'qa-book', analyticsStatus: 'ask' as AnalyticsStatus },
  location: 'page-one',
  pushChanges: vi.fn(async () => true),
  syncBooks: vi.fn(async () => {}),
  flushDwells: vi.fn(() => [{ id: 'actual-dwell' }]),
  onRelocate: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ book: h.initialBook }) }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: (selector?: (state: object) => unknown) => {
    const state = {
      library: [h.libraryBook],
      updateBook: async (_env: unknown, book: typeof h.libraryBook) => {
        h.libraryBook = book;
      },
    };
    return selector ? selector(state) : state;
  },
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: object) => unknown) =>
    selector({ getProgress: () => ({ location: h.location }) }),
}));
vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({ pushChanges: h.pushChanges, syncBooks: h.syncBooks }),
}));
vi.mock('@/app/reader/hooks/useDwellTracking', () => ({
  useDwellTracking: () => ({ onRelocate: h.onRelocate, flushDwells: h.flushDwells }),
}));

import { useAnalyticsDwells } from '@/app/reader/hooks/useAnalyticsDwells';

describe('reader analytics consent and delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.flushDwells
      .mockReset()
      .mockReturnValueOnce([{ id: 'actual-dwell' }])
      .mockReturnValue([]);
    h.initialBook = { hash: 'qa-book', analyticsStatus: 'ask' };
    h.libraryBook = { ...h.initialBook };
    h.location = 'page-one';
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('sends reading data after accepting consent in the same reading session', async () => {
    const { result, rerender } = renderHook(() => useAnalyticsDwells('qa-book-view'));
    expect(result.current.showConsent).toBe(true);
    await act(async () => result.current.handleAllow());
    expect(h.libraryBook.analyticsStatus).toBe('collect');
    h.location = 'page-two';
    rerender();
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(h.pushChanges).toHaveBeenCalledWith({ dwells: [{ id: 'actual-dwell' }] });
  });

  it('does not send reading data when consent is declined', async () => {
    const { result, rerender } = renderHook(() => useAnalyticsDwells('qa-book-view'));
    await act(async () => result.current.handleDecline());
    h.location = 'page-two';
    rerender();
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(h.pushChanges).not.toHaveBeenCalled();
    expect(h.flushDwells).not.toHaveBeenCalled();
  });

  it('checks current consent when a pending reading-data timer fires', async () => {
    h.initialBook.analyticsStatus = 'collect';
    h.libraryBook.analyticsStatus = 'collect';
    const { result, rerender } = renderHook(() => useAnalyticsDwells('qa-book-view'));
    await act(async () => result.current.handleDecline());
    rerender();
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(h.pushChanges).not.toHaveBeenCalled();
  });

  it('retries reading records after a failed sync instead of discarding them', async () => {
    h.initialBook.analyticsStatus = 'collect';
    h.libraryBook.analyticsStatus = 'collect';
    h.pushChanges.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    h.flushDwells
      .mockReset()
      .mockReturnValueOnce([{ id: 'actual-dwell' }])
      .mockReturnValue([]);
    const { rerender } = renderHook(() => useAnalyticsDwells('qa-book-view'));
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    h.location = 'page-two';
    rerender();
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(h.pushChanges).toHaveBeenCalledTimes(2);
    expect(h.pushChanges).toHaveBeenLastCalledWith({ dwells: [{ id: 'actual-dwell' }] });
  });

  it('sends the final page when the reader closes the book without another page turn', async () => {
    h.initialBook.analyticsStatus = 'collect';
    h.libraryBook.analyticsStatus = 'collect';
    const { unmount } = renderHook(() => useAnalyticsDwells('qa-book-view'));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    unmount();
    await act(async () => {});
    expect(h.flushDwells).toHaveBeenCalledWith(true);
    expect(h.pushChanges).toHaveBeenCalledWith({ dwells: [{ id: 'actual-dwell' }] });
  });

  it('keeps the closing page when another reading-data request is still pending', async () => {
    h.initialBook.analyticsStatus = 'collect';
    h.libraryBook.analyticsStatus = 'collect';
    let finish!: (value: boolean) => void;
    h.pushChanges.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    h.flushDwells
      .mockReset()
      .mockReturnValueOnce([{ id: 'earlier-page' }])
      .mockReturnValueOnce([{ id: 'closing-page' }])
      .mockReturnValue([]);
    const { unmount } = renderHook(() => useAnalyticsDwells('qa-book-view'));
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    unmount();
    await act(async () => finish(true));
    expect(h.pushChanges).toHaveBeenCalledTimes(2);
    expect(h.pushChanges).toHaveBeenLastCalledWith({ dwells: [{ id: 'closing-page' }] });
  });
});
