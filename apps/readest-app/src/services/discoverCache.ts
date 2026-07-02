import type { DiscoverRow } from '@/services/catalog';

const DISCOVER_CACHE_KEY = 'bookarc:discover-cache';

export interface DiscoverCacheEntry {
  rows: DiscoverRow[];
  /** Server ETag of the cached feed, replayed via If-None-Match to get 304s. */
  etag?: string;
  generatedAt?: string;
}

/** Read the last successfully-loaded Discover feed, or null when none/corrupt. */
export function readDiscoverCache(): DiscoverCacheEntry | null {
  try {
    const raw = localStorage.getItem(DISCOVER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Current shape: { rows, etag, generatedAt }.
    if (parsed && Array.isArray(parsed.rows)) {
      return {
        rows: parsed.rows as DiscoverRow[],
        etag: typeof parsed.etag === 'string' ? parsed.etag : undefined,
        generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined,
      };
    }
    // Back-compat: earlier versions stored a bare rows array.
    if (Array.isArray(parsed)) return { rows: parsed as DiscoverRow[] };
    return null;
  } catch {
    return null;
  }
}

/** Persist the latest Discover feed (with its ETag) so opens can paint instantly. */
export function writeDiscoverCache(rows: DiscoverRow[], etag?: string, generatedAt?: string): void {
  try {
    localStorage.setItem(DISCOVER_CACHE_KEY, JSON.stringify({ rows, etag, generatedAt }));
  } catch {
    // Best-effort; a full/unavailable localStorage just means no offline cache.
  }
}
