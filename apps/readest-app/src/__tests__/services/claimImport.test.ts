import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importClaimedBook } from '@/services/claimImport';
import type { Book } from '@/types/book';
import type { IngestFileDeps } from '@/services/ingestService';
import type { BookCodeResult } from '@/services/bookCode';

const mocks = vi.hoisted(() => ({
  ingestFile: vi.fn(),
  confirmGiftRedemption: vi.fn(),
  queueUpload: vi.fn(),
}));
vi.mock('@/services/ingestService', () => ({ ingestFile: mocks.ingestFile }));
vi.mock('@/services/bookCode', () => ({ confirmGiftRedemption: mocks.confirmGiftRedemption }));
vi.mock('@/services/transferManager', () => ({
  transferManager: { queueUpload: mocks.queueUpload },
}));
const book: Book = {
  hash: 'gift-hash',
  title: 'Gift',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  downloadedAt: 1,
};
const result: BookCodeResult = {
  giftId: 'gift',
  code: 'CODE',
  book: {
    title: 'Gift',
    author: 'Author',
    format: 'epub',
    coverImageUrl: null,
    description: '',
    appOnlyReading: true,
  },
  downloadRef: 'ref',
  expiresAt: '',
};
const file = new File(['personalized'], 'Gift.epub');

describe('durable claim import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ingestFile.mockImplementation(async ({ books }: { books: Book[] }) => {
      const imported = { ...book };
      books.push(imported);
      return imported;
    });
  });
  it('stores app-only metadata before publishing, confirming and uploading the gift', async () => {
    const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);
    const setLibrary = vi.fn();
    const deps = {
      appService: { saveLibraryBooks },
      settings: {},
      isLoggedIn: true,
    } as unknown as IngestFileDeps;
    const saved = await importClaimedBook(result, file, [], setLibrary, deps);
    expect(saved?.metadata?.appOnlyReading).toBe(true);
    expect(saveLibraryBooks.mock.calls[0]?.[0][0].metadata.appOnlyReading).toBe(true);
    expect(saveLibraryBooks.mock.invocationCallOrder[0]).toBeLessThan(
      setLibrary.mock.invocationCallOrder[0]!,
    );
    expect(saveLibraryBooks.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.confirmGiftRedemption.mock.invocationCallOrder[0]!,
    );
    expect(mocks.queueUpload).toHaveBeenCalledWith(saved);
  });
  it('does not leave an unsaved book in the live library on failure and can retry', async () => {
    const library: Book[] = [];
    const saveLibraryBooks = vi
      .fn()
      .mockRejectedValueOnce(new Error('Disk full'))
      .mockResolvedValueOnce(undefined);
    const setLibrary = vi.fn();
    const deps = {
      appService: { saveLibraryBooks },
      settings: {},
      isLoggedIn: true,
    } as unknown as IngestFileDeps;
    await expect(importClaimedBook(result, file, library, setLibrary, deps)).rejects.toThrow(
      'Disk full',
    );
    expect(library).toEqual([]);
    expect(setLibrary).not.toHaveBeenCalled();
    expect(mocks.confirmGiftRedemption).not.toHaveBeenCalled();
    expect(mocks.queueUpload).not.toHaveBeenCalled();
    await importClaimedBook(result, file, library, setLibrary, deps);
    expect(mocks.confirmGiftRedemption).toHaveBeenCalledTimes(1);
  });
});
