import { afterEach, describe, expect, it, vi } from 'vitest';

const getAccessToken = vi.fn();
vi.mock('@/utils/access', () => ({
  getAccessToken: () => getAccessToken(),
}));
vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'https://api.test/api',
  getBaseUrl: () => 'https://api.test',
}));

import {
  fetchCatalogBook,
  fetchDiscoverFeed,
  parseDiscoverBookId,
  searchCatalog,
} from '@/services/catalog';

const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data }) as Response;

describe('catalog service', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetchDiscoverFeed GETs the v1 discover feed anonymously and unwraps it', async () => {
    const payload = { version: 1, generated_at: 'x', etag: 'e', rows: [] };
    const globalFetch = vi.fn().mockResolvedValueOnce(jsonResponse(payload));
    vi.stubGlobal('fetch', globalFetch);

    const result = await fetchDiscoverFeed();

    const [url, init] = globalFetch.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/discover/feed');
    expect(init.method).toBe('GET');
    // No prior etag → no conditional header.
    expect((init.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
    expect(result).toEqual({ rows: [], etag: 'e', generatedAt: 'x', notModified: false });
  });

  it('fetchDiscoverFeed sends a quoted If-None-Match and reports 304 as notModified', async () => {
    const globalFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 304 } as Response);
    vi.stubGlobal('fetch', globalFetch);

    const result = await fetchDiscoverFeed('e');

    const [, init] = globalFetch.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"e"');
    expect(result).toEqual({ rows: [], etag: 'e', generatedAt: '', notModified: true });
  });

  it('fetchCatalogBook resolves a book by source/sourceId via the by-id endpoint', async () => {
    const payload = { source: 'gutenberg', sourceId: '1661', title: 'Sherlock', author: 'Doyle' };
    const globalFetch = vi.fn().mockResolvedValueOnce(jsonResponse(payload));
    vi.stubGlobal('fetch', globalFetch);

    const result = await fetchCatalogBook('gutenberg', '1661');

    expect(globalFetch).toHaveBeenCalledWith(
      'https://api.test/api/catalog/books/gutenberg/1661',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.sourceId).toBe('1661');
  });

  it('parseDiscoverBookId splits "source:sourceId"', () => {
    expect(parseDiscoverBookId('gutenberg:1661')).toEqual({
      source: 'gutenberg',
      sourceId: '1661',
    });
    expect(parseDiscoverBookId('nocolon')).toBeNull();
  });

  it('searchCatalog builds the query string and attaches the token when signed in', async () => {
    getAccessToken.mockResolvedValueOnce('tok123');
    const globalFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [], total: 0, page: 2, pageSize: 20 }));
    vi.stubGlobal('fetch', globalFetch);

    const result = await searchCatalog({ topic: 'Fiction', sort: 'popular', page: 2 });

    const [url, init] = globalFetch.mock.calls[0]!;
    expect(url).toContain('https://api.test/api/catalog/search?');
    expect(url).toContain('topic=Fiction');
    expect(url).toContain('page=2');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
    expect(result.page).toBe(2);
  });

  it('searchCatalog omits the Authorization header when signed out', async () => {
    getAccessToken.mockResolvedValueOnce(null);
    const globalFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [], total: 0, page: 1, pageSize: 20 }));
    vi.stubGlobal('fetch', globalFetch);

    await searchCatalog({ topic: 'Fiction' });

    const [, init] = globalFetch.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });
});
