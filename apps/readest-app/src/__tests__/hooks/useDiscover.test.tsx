import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoverRow } from '@/services/catalog';

const fetchDiscoverFeed = vi.fn();
vi.mock('@/services/catalog', () => ({
  fetchDiscoverFeed: (etag?: string) => fetchDiscoverFeed(etag),
}));

import { useDiscover } from '@/hooks/useDiscover';
import { readDiscoverCache, writeDiscoverCache } from '@/services/discoverCache';

const rowA: DiscoverRow = {
  id: 'popular_classics',
  kind: 'popular_classics',
  title: 'Popular Classics',
  query: { sort: 'popular' },
  books: [],
};

const rowB: DiscoverRow = {
  id: 'popular_in_fiction',
  kind: 'popular_in_category',
  title: 'Popular in Fiction',
  query: { topic: 'Fiction', sort: 'popular' },
  books: [],
};

describe('useDiscover', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => localStorage.clear());

  it('loads fresh content on open and caches it', async () => {
    fetchDiscoverFeed.mockResolvedValueOnce({ rows: [rowA], etag: 'e1', notModified: false });

    const { result } = renderHook(() => useDiscover());

    await waitFor(() => expect(result.current.status).toBe('fresh'));
    expect(result.current.rows).toEqual([rowA]);
  });

  it('falls back to cached content when the server is unreachable', async () => {
    fetchDiscoverFeed.mockResolvedValueOnce({ rows: [rowA], etag: 'e1', notModified: false });
    const { result } = renderHook(() => useDiscover());
    await waitFor(() => expect(result.current.status).toBe('fresh'));

    fetchDiscoverFeed.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.status).toBe('cached');
    expect(result.current.rows).toEqual([rowA]);
  });

  it('reports empty when there is no server and no cache', async () => {
    fetchDiscoverFeed.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useDiscover());

    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.rows).toEqual([]);
  });

  // --- stale-while-revalidate first paint ---

  it('paints cached rows instantly without a loading spinner', () => {
    writeDiscoverCache([rowA], 'e1');
    // Never resolves — proves the first render does not wait on the network.
    fetchDiscoverFeed.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDiscover());

    expect(result.current.status).toBe('cached');
    expect(result.current.rows).toEqual([rowA]);
  });

  it('shows a spinner (loading) only when there is no cache', () => {
    fetchDiscoverFeed.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDiscover());

    expect(result.current.status).toBe('loading');
    expect(result.current.rows).toEqual([]);
  });

  it('revalidates with If-None-Match and keeps cached rows on 304', async () => {
    writeDiscoverCache([rowA], 'e1');
    fetchDiscoverFeed.mockResolvedValueOnce({ rows: [], etag: 'e1', notModified: true });

    const { result } = renderHook(() => useDiscover());

    await waitFor(() => expect(result.current.status).toBe('fresh'));
    expect(fetchDiscoverFeed).toHaveBeenCalledWith('e1');
    expect(result.current.rows).toEqual([rowA]); // unchanged on 304
  });

  it('swaps to fresh rows and updates the cached etag on 200', async () => {
    writeDiscoverCache([rowA], 'e1');
    fetchDiscoverFeed.mockResolvedValueOnce({ rows: [rowB], etag: 'e2', notModified: false });

    const { result } = renderHook(() => useDiscover());

    await waitFor(() => expect(result.current.rows).toEqual([rowB]));
    expect(result.current.status).toBe('fresh');
    expect(readDiscoverCache()?.etag).toBe('e2');
  });
});
