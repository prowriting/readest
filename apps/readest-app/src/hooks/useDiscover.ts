import { useCallback, useEffect, useState } from 'react';
import { fetchDiscoverFeed, type DiscoverRow } from '@/services/catalog';
import { readDiscoverCache, writeDiscoverCache } from '@/services/discoverCache';

export type DiscoverStatus = 'loading' | 'fresh' | 'cached' | 'empty';

/**
 * Loads the Discover rows with stale-while-revalidate: on open it paints the last
 * cached feed immediately (no spinner) and revalidates in the background, swapping
 * to fresh content when the server responds. It sends the cached ETag so an
 * unchanged feed returns a bodyless 304. The spinner shows only on a true first
 * open with no cache; on failure it keeps the cached rows ("Showing saved picks").
 */
export function useDiscover() {
  // Read the cache once, synchronously, so the first render already has content.
  const [initial] = useState(() => readDiscoverCache());
  const [rows, setRows] = useState<DiscoverRow[]>(initial?.rows ?? []);
  const [status, setStatus] = useState<DiscoverStatus>(
    (initial?.rows.length ?? 0) > 0 ? 'cached' : 'loading',
  );

  const load = useCallback(async () => {
    const cached = readDiscoverCache();
    const hasCache = (cached?.rows.length ?? 0) > 0;
    // Only block with a spinner when there's nothing to show yet.
    if (!hasCache) setStatus('loading');

    try {
      const res = await fetchDiscoverFeed(cached?.etag);
      if (res.notModified) {
        if (cached) setRows(cached.rows);
        setStatus('fresh');
        return;
      }
      setRows(res.rows);
      writeDiscoverCache(res.rows, res.etag, res.generatedAt);
      setStatus('fresh');
    } catch {
      const fallback = readDiscoverCache();
      if (fallback && fallback.rows.length > 0) {
        setRows(fallback.rows);
        setStatus('cached');
      } else {
        setRows([]);
        setStatus('empty');
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, status, reload: load };
}
