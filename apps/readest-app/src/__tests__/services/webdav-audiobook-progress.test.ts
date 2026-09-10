import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pullBookConfig, pushBookConfig } from '@/services/webdav/WebDAVSync';
import type { Book, BookConfig, MediaOverlayLocation } from '@/types/book';
import type { WebDAVSettings } from '@/types/settings';

const originalFetch = globalThis.fetch;

const settings: WebDAVSettings = {
  enabled: true,
  serverUrl: 'https://dav.example.com',
  username: 'reader',
  password: 'secret',
  rootPath: '/',
};

const book = {
  hash: 'edition-1',
  metaHash: 'shared-metadata',
  title: 'Audiobook',
  author: 'Author',
  format: 'EPUB',
} as Book;

const location: MediaOverlayLocation = {
  schemaVersion: 2,
  editionId: 'edition-1',
  locator: {
    href: 'audio/chapter.mp3',
    type: 'audio/mpeg',
    locations: { fragments: ['t=12.5'], progression: 0.25, totalProgression: 0.1 },
  },
  textLocator: {
    href: 'text/chapter.xhtml',
    type: 'application/xhtml+xml',
    locations: { fragments: ['sentence-4'] },
  },
  updatedAt: 200,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('WebDAV audiobook progress', () => {
  it('includes the complete Readium locator in the progress payload', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
    const config: BookConfig = {
      bookHash: book.hash,
      mediaOverlayLocation: location,
      updatedAt: 300,
    };

    await pushBookConfig(settings, book, config, 'device-1');

    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put).toBeDefined();
    const payload = JSON.parse(String(put?.[1]?.body));
    expect(payload.config.mediaOverlayLocation).toEqual(location);
  });

  it('round-trips the locator while rejecting progress for another edition', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          bookHash: book.hash,
          config: { mediaOverlayLocation: location, updatedAt: 300 },
          booknotes: [],
          writerDeviceId: 'device-2',
          writerVersion: 'readest-webdav-1',
          updatedAt: 300,
        }),
        { status: 200 },
      ),
    );
    const result = await pullBookConfig(settings, book, { updatedAt: 100 });
    expect(result.mergedConfig?.mediaOverlayLocation).toEqual(location);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          bookHash: book.hash,
          config: {
            mediaOverlayLocation: { ...location, editionId: 'different-edition', updatedAt: 500 },
            updatedAt: 500,
          },
          booknotes: [],
          writerDeviceId: 'device-3',
          writerVersion: 'readest-webdav-1',
          updatedAt: 500,
        }),
        { status: 200 },
      ),
    );
    const mismatched = await pullBookConfig(settings, book, {
      mediaOverlayLocation: location,
      updatedAt: 100,
    });
    expect(mismatched.mergedConfig?.mediaOverlayLocation).toEqual(location);
  });
});
