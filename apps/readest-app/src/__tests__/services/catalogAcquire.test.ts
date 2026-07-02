import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogBookResult } from '@/services/catalog';
import type { AppService } from '@/types/system';

const downloadFile = vi.fn();
vi.mock('@/libs/storage', () => ({ downloadFile: (args: unknown) => downloadFile(args) }));
vi.mock('@/app/opds/utils/opdsReq', () => ({
  needsProxy: () => false,
  getProxiedURL: (url: string) => url,
}));
vi.mock('@/libs/document', () => ({ getFileExtFromMimeType: () => 'epub' }));
vi.mock('@/services/constants', () => ({ READEST_OPDS_USER_AGENT: 'test-agent' }));

import { acquireCatalogBook, pickDownloadFormat } from '@/services/catalogAcquire';

const book: CatalogBookResult = {
  source: 'gutenberg',
  sourceId: '1661',
  title: 'Sherlock',
  author: 'Doyle',
  downloadCount: 1,
  formats: [
    { mimeType: 'text/html', url: 'https://x/page.html' },
    { mimeType: 'application/epub+zip', url: 'https://x/1661.epub' },
  ],
};

const appService = {
  resolveFilePath: vi.fn().mockResolvedValue('/cache/gutenberg-1661.epub'),
  importBook: vi.fn().mockResolvedValue({ hash: 'abc', title: 'Sherlock' }),
} as unknown as AppService;

describe('catalogAcquire', () => {
  afterEach(() => vi.clearAllMocks());

  it('pickDownloadFormat prefers the EPUB format', () => {
    expect(pickDownloadFormat(book)?.url).toBe('https://x/1661.epub');
    expect(
      pickDownloadFormat({ ...book, formats: [{ mimeType: 'text/html', url: 'h' }] }),
    ).toBeNull();
  });

  it('downloads the EPUB and imports it into the library', async () => {
    const library: never[] = [];
    const result = await acquireCatalogBook(book, { appService, library });

    expect(downloadFile).toHaveBeenCalledTimes(1);
    const passed = downloadFile.mock.calls[0]![0] as { url: string; dst: string };
    expect(passed.url).toBe('https://x/1661.epub');
    expect(passed.dst).toBe('/cache/gutenberg-1661.epub');

    expect(appService.importBook).toHaveBeenCalledWith('/cache/gutenberg-1661.epub', library);
    expect(result).toEqual({ hash: 'abc', title: 'Sherlock' });
  });

  it('throws when the book has no downloadable EPUB', async () => {
    const noEpub = { ...book, formats: [{ mimeType: 'text/html', url: 'h' }] };
    await expect(acquireCatalogBook(noEpub, { appService, library: [] })).rejects.toThrow();
    expect(downloadFile).not.toHaveBeenCalled();
  });
});
