import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { CatalogBookResult, CatalogFormat } from '@/services/catalog';
import { downloadFile } from '@/libs/storage';
import { needsProxy, getProxiedURL } from '@/app/opds/utils/opdsReq';
import { getFileExtFromMimeType } from '@/libs/document';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';

const EPUB_MIME = 'application/epub+zip';

/** The best downloadable format for a catalog book — EPUB only (what the reader opens). */
export function pickDownloadFormat(book: CatalogBookResult): CatalogFormat | null {
  const formats = book.formats ?? [];
  return (
    formats.find((f) => f.mimeType === EPUB_MIME) ??
    formats.find((f) => f.mimeType.includes('epub')) ??
    null
  );
}

export interface AcquireDeps {
  appService: AppService;
  library: Book[];
  onProgress?: (progress: { progress: number; total: number }) => void;
}

/**
 * Download a catalog book's EPUB to the cache and import it into {@link library}
 * (mutated in place, as {@link AppService.importBook} does). Reuses the same
 * proxy-aware download + import path the OPDS catalog uses, so it works across
 * web/desktop/mobile. The caller persists the library and updates the store.
 */
export async function acquireCatalogBook(
  book: CatalogBookResult,
  { appService, library, onProgress }: AcquireDeps,
): Promise<Book> {
  const format = pickDownloadFormat(book);
  if (!format) {
    throw new Error('No downloadable EPUB format for this book.');
  }

  const url = format.url;
  const useProxy = needsProxy(url);
  const downloadUrl = useProxy ? getProxiedURL(url, '', true) : url;
  const headers: Record<string, string> = {
    'User-Agent': READEST_OPDS_USER_AGENT,
    Accept: '*/*',
  };

  const ext = getFileExtFromMimeType(format.mimeType) || 'epub';
  const filename = `${book.source}-${book.sourceId}.${ext}`;
  const dst = await appService.resolveFilePath(filename, 'Cache');

  await downloadFile({
    appService,
    dst,
    cfp: '',
    url: downloadUrl,
    headers,
    singleThreaded: true,
    skipSslVerification: true,
    onProgress,
  });

  const imported = await appService.importBook(dst, library);
  if (!imported) {
    throw new Error('Failed to import the downloaded book.');
  }
  return imported;
}
