import { getAPIBaseUrl, getBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';

// --- /api/catalog/search and /api/catalog/books/{source}/{sourceId} (camelCase) ---

export interface CatalogFormat {
  mimeType: string;
  url: string;
  size?: number | null;
}

/** A catalog row as returned by /api/catalog/search and the by-id detail endpoint. */
export interface CatalogBookResult {
  source: string;
  sourceId: string;
  title: string;
  author: string;
  description?: string | null;
  language?: string | null;
  subjects?: string[] | null;
  coverUrl?: string | null;
  landingUrl?: string | null;
  downloadCount: number;
  formats?: CatalogFormat[] | null;
}

export interface CatalogSearchResponse {
  results: CatalogBookResult[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CatalogSearchParams {
  q?: string;
  topic?: string | null;
  language?: string | null;
  sort?: string;
  page?: number;
  pageSize?: number;
}

// --- /v1/discover/feed (Discover API v1; snake_case field names per the contract) ---

export interface CatalogRowQuery {
  topic?: string | null;
  language?: string | null;
  sort?: string;
}

export interface DiscoverCategory {
  id: string;
  name: string;
}

export interface DiscoverBook {
  /** "{source}:{sourceId}", e.g. "gutenberg:1661". */
  id: string;
  title: string;
  authors: string[];
  cover_url: string;
  description?: string | null;
  categories?: DiscoverCategory[] | null;
  rating_average?: number | null;
  rating_count?: number | null;
  is_free: boolean;
}

export interface DiscoverRow {
  id: string;
  kind: string;
  title: string;
  category?: DiscoverCategory | null;
  /** Search params that reproduce the row's full contents (for "See all"). */
  query: CatalogRowQuery;
  /** Preview slice for the carousel, most-popular-first. */
  books: DiscoverBook[];
}

export interface DiscoverFeedResponse {
  version: number;
  generated_at: string;
  etag: string;
  rows: DiscoverRow[];
}

/** Outcome of a Discover fetch; `notModified` means the server returned 304. */
export interface DiscoverFeedResult {
  rows: DiscoverRow[];
  etag: string;
  generatedAt: string;
  notModified: boolean;
}

/**
 * GET /v1/discover/feed — the global, server-driven Discover feed (anonymous).
 * When `etag` (from a prior response) is supplied, sends `If-None-Match` so an
 * unchanged feed comes back as a bodyless 304. The server quotes its ETag, so we
 * quote the stored hash to match its comparison.
 */
export async function fetchDiscoverFeed(etag?: string): Promise<DiscoverFeedResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (etag) headers['If-None-Match'] = `"${etag}"`;

  const res = await fetch(`${getBaseUrl()}/v1/discover/feed`, { method: 'GET', headers });

  if (res.status === 304) {
    return { rows: [], etag: etag ?? '', generatedAt: '', notModified: true };
  }
  if (!res.ok) throw new Error(`Discover feed failed: HTTP ${res.status}`);

  const body = (await res.json()) as DiscoverFeedResponse;
  return { rows: body.rows, etag: body.etag, generatedAt: body.generated_at, notModified: false };
}

/** Split a DiscoverBook id ("source:sourceId") into its parts. */
export function parseDiscoverBookId(id: string): { source: string; sourceId: string } | null {
  const sep = id.indexOf(':');
  if (sep <= 0 || sep >= id.length - 1) return null;
  return { source: id.slice(0, sep), sourceId: id.slice(sep + 1) };
}

/** GET /api/catalog/books/{source}/{sourceId} — full record incl. download formats. */
export async function fetchCatalogBook(
  source: string,
  sourceId: string,
): Promise<CatalogBookResult> {
  const res = await fetch(
    `${getAPIBaseUrl()}/catalog/books/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Catalog book failed: HTTP ${res.status}`);
  return res.json() as Promise<CatalogBookResult>;
}

/**
 * GET /api/catalog/search — used by the See-all overlay to page a row. Catalog
 * browsing is anonymous-friendly, so the bearer token is attached only when the
 * reader is signed in rather than hard-required client-side.
 */
export async function searchCatalog(params: CatalogSearchParams): Promise<CatalogSearchResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.topic) qs.set('topic', params.topic);
  if (params.language) qs.set('language', params.language);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = await getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${getAPIBaseUrl()}/catalog/search?${qs.toString()}`, {
    method: 'GET',
    headers,
  });
  if (!res.ok) throw new Error(`Catalog search failed: HTTP ${res.status}`);
  return res.json() as Promise<CatalogSearchResponse>;
}
