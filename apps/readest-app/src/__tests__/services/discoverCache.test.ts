import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  getBaseUrl: () => 'https://api.test',
}));
vi.mock('@/utils/access', () => ({ getAccessToken: vi.fn() }));

import { fetchDiscoverFeed } from '@/services/catalog';
import {
  prefetchDiscoverFeed,
  readDiscoverCache,
  writeDiscoverCache,
} from '@/services/discoverCache';

const rows = [
  { id: 'popular_classics', kind: 'popular_classics', title: 'Classics', query: {}, books: [] },
];

describe('Discover prefetch', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('saves the first feed and shares its request with an opening Discover tab', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rows, etag: 'e1', generated_at: 'now' }),
    });
    vi.stubGlobal('fetch', fetch);
    await Promise.all([prefetchDiscoverFeed(), fetchDiscoverFeed()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readDiscoverCache()).toEqual({ rows, etag: 'e1', generatedAt: 'now' });
  });

  it('skips prefetch when saved picks are already available', async () => {
    writeDiscoverCache(rows, 'e1');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await prefetchDiscoverFeed();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('handles an offline first launch without blocking the library', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(prefetchDiscoverFeed()).resolves.toBeUndefined();
    expect(readDiscoverCache()).toBeNull();
  });
});
