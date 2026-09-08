import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'https://reader.bookarc.test/api',
  getAuthorBaseUrl: () => 'https://author.bookarc.test',
}));

import { downloadGiftBook, fetchBookByCode } from '@/services/bookCode';

const claimResult = (coverImageUrl: string | null) => ({
  giftId: 'gift-1',
  code: 'fbc83a2',
  book: {
    title: 'A Christmas Carol',
    author: 'Charles Dickens',
    coverImageUrl,
    description: 'A classic audiobook.',
    format: 'audiobook',
  },
  downloadRef: 'download-1',
  expiresAt: '',
});

describe('book code service', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves a relative claim cover URL against the author-site origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => claimResult('/covers/books/cover.png'),
      } as Response),
    );

    const result = await fetchBookByCode('FBC83A2');

    expect(result.book.coverImageUrl).toBe('https://author.bookarc.test/covers/books/cover.png');
  });

  it('preserves an absolute claim cover URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => claimResult('https://cdn.bookarc.test/cover.png'),
      } as Response),
    );

    const result = await fetchBookByCode('FBC83A2');

    expect(result.book.coverImageUrl).toBe('https://cdn.bookarc.test/cover.png');
  });

  it('reports streamed download progress using the response content length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4, 5]));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(stream, {
          headers: { 'Content-Length': '5' },
        }),
      ),
    );
    const onProgress = vi.fn();

    const result = await downloadGiftBook('download-1', onProgress);

    expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4, 5]);
    expect(onProgress).toHaveBeenNthCalledWith(1, { receivedBytes: 2, totalBytes: 5 });
    expect(onProgress).toHaveBeenLastCalledWith({ receivedBytes: 5, totalBytes: 5 });
  });
});
