import { describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import { getKindleAvailability, preserveDeliveryRestrictions } from '@/utils/bookDelivery';
import { loadKindleFile, shareKindleFile } from '@/services/kindle';
import { transformBookFromDB, transformBookToDB } from '@/utils/transform';

const { shareFile } = vi.hoisted(() => ({ shareFile: vi.fn() }));
vi.mock('@choochmeque/tauri-plugin-sharekit-api', () => ({ shareFile }));

const book: Book = {
  hash: 'personalized-file-hash',
  title: 'The Writer’s Mind',
  author: 'Chris Banks',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  downloadedAt: 1,
};

describe('Kindle library delivery', () => {
  it.each([
    'EPUB',
    'PDF',
    'TXT',
  ] as const)('offers local %s books, including ordinary imports', (format) => {
    expect(getKindleAvailability({ ...book, format })).toBe('ready');
  });

  it('hides unsupported, audio-only and app-only books but explains cloud-only books', () => {
    expect(getKindleAvailability({ ...book, format: 'MOBI' })).toBe('hidden');
    expect(getKindleAvailability({ ...book, isAudioOnly: true })).toBe('hidden');
    expect(
      getKindleAvailability({
        ...book,
        metadata: { title: book.title, author: book.author, language: 'en', appOnlyReading: true },
      }),
    ).toBe('hidden');
    expect(getKindleAvailability({ ...book, downloadedAt: null, uploadedAt: 1 })).toBe('download');
    expect(getKindleAvailability(undefined)).toBe('hidden');
  });

  it('uses the saved file after restart without any redemption or download requests', async () => {
    const restored: Book = JSON.parse(JSON.stringify(book));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Claim expired'));
    const file = new File(['Personalized for chrisdbanks@protonmail.com'], 'hash.epub');
    const appService = { loadBookContent: vi.fn().mockResolvedValue({ book: {}, file }) };
    const exported = await loadKindleFile(appService, restored);
    expect(appService.loadBookContent).toHaveBeenCalledWith(restored);
    expect(exported.name).toBe('The Writer’s Mind.epub');
    expect(exported.type).toBe('application/epub+zip');
    const contents = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(exported);
    });
    expect(contents).toBe('Personalized for chrisdbanks@protonmail.com');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('shares the actual file with its MIME type and never deletes the library copy', async () => {
    const file = new File(['personalized'], 'Book.pdf', { type: 'application/pdf' });
    const appService = {
      createDir: vi.fn(),
      writeFile: vi.fn(),
      resolveFilePath: vi.fn().mockResolvedValue('/tmp/kindle/Book.pdf'),
    };
    await shareKindleFile(appService, file);
    expect(appService.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/Book-[\w-]+\.pdf$/),
      'Temp',
      file,
    );
    expect(shareFile).toHaveBeenCalledWith(
      'file:///tmp/kindle/Book.pdf',
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
  });

  it('uses unique share filenames so a native cached copy cannot replace a personalized file', async () => {
    const file = new File(['personalized'], 'Book.epub');
    const appService = {
      createDir: vi.fn(),
      writeFile: vi.fn(),
      resolveFilePath: vi.fn().mockResolvedValue('/tmp/book.epub'),
    };
    await shareKindleFile(appService, file);
    await shareKindleFile(appService, file);
    expect(appService.writeFile.mock.calls[0]?.[0].split('/').pop()).not.toBe(
      appService.writeFile.mock.calls[1]?.[0].split('/').pop(),
    );
  });

  it('preserves app-only restrictions through edits, old-client sync and JSON storage', () => {
    const metadata = {
      title: book.title,
      author: book.author,
      language: 'en',
      appOnlyReading: true,
    };
    const edited = preserveDeliveryRestrictions(metadata, {
      ...metadata,
      title: 'Edited',
      appOnlyReading: false,
    });
    expect(edited).toMatchObject({ title: 'Edited', appOnlyReading: true });
    expect(preserveDeliveryRestrictions(metadata, undefined)?.appOnlyReading).toBe(true);
    const restored = transformBookFromDB(transformBookToDB({ ...book, metadata: edited }, 'user'));
    expect(getKindleAvailability(restored)).toBe('hidden');
    expect(getKindleAvailability(transformBookFromDB(transformBookToDB(book, 'user')))).not.toBe(
      'hidden',
    );
  });
});
