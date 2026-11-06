import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import { prepareFireKindleFile, type KindleSource } from '@/services/fireKindle';

vi.mock('@/services/environment', () => ({ getAPIBaseUrl: () => 'https://reader.test/api' }));
const mobi = new TextEncoder().encode('BOOKMOBI personalized fixture');
const sourceSha = 'a'.repeat(64);
const files = new Map<string, string | ArrayBuffer>();
const app = {
  createDir: vi.fn(),
  exists: vi.fn(async (path: string) => files.has(path)),
  readFile: vi.fn(async (path: string) => files.get(path)),
  writeFile: vi.fn(async (path: string, _base: string, bytes: string | ArrayBuffer) => {
    files.set(path, bytes);
  }),
  resolveFilePath: vi.fn(async (path: string) => '/data/' + path),
} as unknown as AppService;
const source = (): KindleSource => ({
  id: 'saved-book',
  title: 'Gift',
  format: 'EPUB',
  delivery: { receipt: 'protected-receipt', sourceSha256: sourceSha },
  loadOriginal: vi.fn().mockRejectedValue(new Error('EPUB must not be loaded')),
});
async function response(status = 200) {
  const digest = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', mobi)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return new Response(status === 202 ? '{}' : mobi, {
    status,
    headers: {
      'X-BookArc-Delivery-Receipt': 'protected-receipt',
      'X-BookArc-Source-SHA256': sourceSha,
      'X-BookArc-File-SHA256': digest,
      'X-BookArc-Converter-Version': 'calibre-9.8.0-hybrid-v1',
      'Content-Type': status === 202 ? 'application/json' : 'application/x-mobipocket-ebook',
      'Retry-After': '0',
    },
  });
}

describe('Fire Kindle preparation', () => {
  beforeEach(() => {
    files.clear();
    vi.clearAllMocks();
    vi.stubGlobal('crypto', webcrypto);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('requests a saved personalized variant without reading or uploading the EPUB', async () => {
    const fetch = vi.fn().mockResolvedValue(await response());
    vi.stubGlobal('fetch', fetch);
    const input = source();
    const result = await prepareFireKindleFile(app, input, new AbortController().signal);
    expect(result.path).toMatch(/\.mobi$/);
    expect(input.loadOriginal).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0]?.[0]).toBe('https://reader.test/api/delivery/file');
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      receipt: 'protected-receipt',
      format: 'mobi',
    });
    expect(fetch.mock.calls.some(([url]) => String(url).includes('claim'))).toBe(false);
  });
  it('reuses a verified disk cache after restart while offline', async () => {
    const fetch = vi.fn().mockResolvedValue(await response());
    vi.stubGlobal('fetch', fetch);
    await prepareFireKindleFile(app, source(), new AbortController().signal);
    fetch.mockRejectedValue(new Error('Offline'));
    fetch.mockClear();
    await prepareFireKindleFile(app, source(), new AbortController().signal);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requests MOBI first for a claim and polls using its receipt without redeeming again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(await response(202))
      .mockResolvedValueOnce(await response());
    vi.stubGlobal('fetch', fetch);
    await prepareFireKindleFile(
      app,
      { ...source(), delivery: undefined, downloadRef: 'new-claim' },
      new AbortController().signal,
    );
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://reader.test/api/claim/download?ref=new-claim&format=mobi',
    );
    expect(fetch.mock.calls[1]?.[0]).toBe('https://reader.test/api/delivery/file');
  });
  it('does not upload a local copy after a receipt is refused', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    const input = source();
    await expect(prepareFireKindleFile(app, input, new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
    expect(input.loadOriginal).not.toHaveBeenCalled();
  });
  it('accepts and caches a newer server converter version without requiring an app update', async () => {
    const updated = await response();
    updated.headers.set('X-BookArc-Converter-Version', 'calibre-9.9.0-hybrid-v1');
    const fetch = vi.fn().mockResolvedValue(updated);
    vi.stubGlobal('fetch', fetch);
    const first = await prepareFireKindleFile(app, source(), new AbortController().signal);
    expect(first.converterVersion).toBe('calibre-9.9.0-hybrid-v1');
    fetch.mockClear();
    const second = await prepareFireKindleFile(app, source(), new AbortController().signal);
    expect(second.path).toBe(first.path);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uploads ordinary imports once, then reuses the verified conversion offline', async () => {
    const bytes = new TextEncoder().encode('actual imported EPUB');
    const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
    const converted = await response();
    converted.headers.set('X-BookArc-Source-SHA256', digest);
    const fetch = vi.fn().mockResolvedValue(converted);
    vi.stubGlobal('fetch', fetch);
    const file = new File([bytes], 'import.epub');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    const imported = {
      ...source(),
      delivery: undefined,
      loadOriginal: vi.fn().mockResolvedValue(file),
    };
    await prepareFireKindleFile(app, imported, new AbortController().signal);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://reader.test/api/delivery/convert');
    expect(fetch.mock.calls[0]?.[1].body).toBe(bytes.buffer);
    fetch.mockReset().mockRejectedValue(new Error('Offline'));
    await prepareFireKindleFile(app, imported, new AbortController().signal);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels preparation without publishing a cache and allows a fresh retry', async () => {
    const pending = await response(202);
    pending.headers.set('Retry-After', '15');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(await response());
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const preparing = prepareFireKindleFile(app, source(), controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    expect(files.size).toBe(0);
    await prepareFireKindleFile(app, source(), new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not reuse an interrupted local write and repairs it on retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(await response())
      .mockResolvedValueOnce(await response());
    vi.stubGlobal('fetch', fetch);
    vi.mocked(app.writeFile).mockImplementationOnce(async (path: string) => {
      files.set(path, new ArrayBuffer(2));
      throw new Error('Storage interrupted');
    });
    await expect(
      prepareFireKindleFile(app, source(), new AbortController().signal),
    ).rejects.toThrow('Storage interrupted');
    expect([...files.keys()].some((path) => path.endsWith('.json'))).toBe(false);
    await prepareFireKindleFile(app, source(), new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a variant for a different personalized source without caching it', async () => {
    const wrong = await response();
    wrong.headers.set('X-BookArc-Source-SHA256', 'b'.repeat(64));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(wrong));
    await expect(
      prepareFireKindleFile(app, source(), new AbortController().signal),
    ).rejects.toThrow('does not match');
    expect(files.size).toBe(0);
  });
});
