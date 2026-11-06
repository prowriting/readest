import React from 'react';
import { webcrypto } from 'node:crypto';
import type { DeliveryReceipt } from '@/libs/document';
import type { Book } from '@/types/book';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Set<(event: CustomEvent) => void>>();
  return {
    router: { push: vi.fn(), replace: vi.fn() },
    searchParams: new URLSearchParams('code=fbc83a2'),
    fetchBookByCode: vi.fn(),
    libraryLoaded: true,
    isAndroidApp: false,
    detectKindle: vi.fn(),
    signedIn: true,
    downloadGiftBook: vi.fn(),
    confirmGiftRedemption: vi.fn(),
    ingestFile: vi.fn(),
    importBook: vi.fn(),
    navigateToReader: vi.fn(),
    navigateToLibrary: vi.fn(),
    saveLibraryBooks: vi.fn(),
    loadBookContent: vi.fn(),
    setLibraryNotice: vi.fn(),
    handlers,
    dispatch: (name: string, detail: unknown) => {
      handlers.get(name)?.forEach((handler) => handler(new CustomEvent(name, { detail })));
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));
vi.mock('next/image', () => ({
  default: () => null,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      isAndroidApp: mocks.isAndroidApp,
      saveLibraryBooks: mocks.saveLibraryBooks,
      loadBookContent: mocks.loadBookContent,
      importBook: mocks.importBook,
    },
  }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    token: mocks.signedIn ? 'qa-token' : null,
    user: mocks.signedIn ? { id: 'reader-1' } : null,
  }),
}));
vi.mock('@/hooks/useLibrary', () => ({
  useLibrary: () => ({ libraryLoaded: mocks.libraryLoaded }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, options?: Record<string, unknown>) =>
    options?.['percent'] === undefined
      ? value
      : value.replace('{{percent}}', String(options['percent'])),
}));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/libraryStore', () => {
  const libraryState = {
    library: [],
    visibleLibrary: [],
    setLibrary: vi.fn(),
    setLibraryNotice: mocks.setLibraryNotice,
  };
  return {
    useLibraryStore: Object.assign(
      (selector: (state: typeof libraryState) => unknown) => selector(libraryState),
      { getState: () => libraryState },
    ),
  };
});
vi.mock('@/services/environment', () => ({
  isStoreCapture: () => false,
  isTauriAppPlatform: () => false,
  isWebAppPlatform: () => false,
}));
vi.mock('@/services/ingestService', () => ({ ingestFile: mocks.ingestFile }));
vi.mock('@/services/bookCode', () => ({
  BookCodeError: class extends Error {
    constructor(
      public readonly statusCode: number,
      message: string,
    ) {
      super(message);
    }
  },
  fetchBookByCode: mocks.fetchBookByCode,
  downloadGiftBook: mocks.downloadGiftBook,
  confirmGiftRedemption: mocks.confirmGiftRedemption,
}));
vi.mock('@/utils/bridge', () => ({ detectKindle: mocks.detectKindle, sendToKindleApp: vi.fn() }));
vi.mock('@/utils/nav', () => ({
  navigateToReader: mocks.navigateToReader,
  navigateToLibrary: mocks.navigateToLibrary,
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: (name: string, handler: (event: CustomEvent) => void) => {
      const listeners = mocks.handlers.get(name) ?? new Set();
      listeners.add(handler);
      mocks.handlers.set(name, listeners);
    },
    off: (name: string, handler: (event: CustomEvent) => void) => {
      mocks.handlers.get(name)?.delete(handler);
    },
    dispatch: mocks.dispatch,
  },
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));

import { BookCodeDialog } from '@/components/BookCodeDialog';
import ReadPage from '@/app/read/page';

const result = {
  giftId: 'gift-1',
  code: 'fbc83a2',
  book: {
    title: 'A Christmas Carol',
    author: 'Charles Dickens',
    coverImageUrl: null,
    description: 'A classic audiobook.',
    format: 'audiobook',
  },
  downloadRef: 'download-1',
  expiresAt: '',
};

describe('BookCodeDialog', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveLibraryBooks.mockResolvedValue(undefined);
    mocks.handlers.clear();
    mocks.searchParams = new URLSearchParams('code=fbc83a2');
    mocks.libraryLoaded = true;
    mocks.isAndroidApp = false;
    mocks.signedIn = true;
  });

  it('replaces the claim dialog with the Fire handoff and restores it when closed', async () => {
    mocks.isAndroidApp = true;
    mocks.detectKindle.mockResolvedValue({ isFire: true, kindleInstalled: true });
    render(<BookCodeDialog />);
    act(() =>
      mocks.dispatch('book-code-found', {
        result: { ...result, book: { ...result.book, format: 'EPUB' } },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Kindle' }));
    await screen.findByRole('button', { name: 'Save to Books' });
    expect(screen.queryByRole('button', { name: 'Save to My Library' })).toBeNull();
    expect(mocks.downloadGiftBook).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('button', { name: 'Save to My Library' })).toBeTruthy();
  });

  it('shows download progress and returns to the library without opening the saved book', async () => {
    let finishDownload: ((bytes: ArrayBuffer) => void) | undefined;
    mocks.downloadGiftBook.mockImplementation(
      async (
        _downloadRef: string,
        onProgress: (progress: { receivedBytes: number; totalBytes: number | null }) => void,
      ) => {
        onProgress({ receivedBytes: 25, totalBytes: 100 });
        return new Promise<ArrayBuffer>((resolve) => {
          finishDownload = resolve;
        });
      },
    );
    const importedBook = { hash: 'christmas-carol-hash' };
    mocks.ingestFile.mockResolvedValue(importedBook);

    render(<BookCodeDialog />);
    act(() => mocks.dispatch('book-code-found', { result }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save to My Library' }));

    const progress = await screen.findByRole('progressbar', { name: 'Downloading book' });
    expect(progress.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText('Downloading… 25%')).toBeTruthy();

    await act(async () => finishDownload?.(new ArrayBuffer(8)));

    await waitFor(() => expect(mocks.navigateToLibrary).toHaveBeenCalledWith(mocks.router));
    expect(mocks.navigateToReader).not.toHaveBeenCalled();
    expect(mocks.confirmGiftRedemption).toHaveBeenCalledWith('download-1');
    expect(mocks.setLibraryNotice).toHaveBeenCalledWith('added');
    expect(screen.queryByRole('button', { name: 'Save to My Library' })).toBeNull();
  });

  it.each([
    'Save to My Library',
    'Start Reading',
  ])('keeps the claim open and unconsumed when persistence fails for %s', async (action) => {
    mocks.downloadGiftBook.mockResolvedValue(new ArrayBuffer(8));
    mocks.ingestFile.mockResolvedValue({ hash: 'unsaved-hash' });
    mocks.saveLibraryBooks.mockRejectedValueOnce(new Error('Disk full'));
    render(<BookCodeDialog />);
    act(() => mocks.dispatch('book-code-found', { result }));
    fireEvent.click(await screen.findByRole('button', { name: action }));
    await waitFor(() => expect(mocks.saveLibraryBooks).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save to My Library' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    expect(mocks.confirmGiftRedemption).not.toHaveBeenCalled();
    expect(mocks.navigateToReader).not.toHaveBeenCalled();
    expect(mocks.navigateToLibrary).not.toHaveBeenCalled();
    expect(mocks.setLibraryNotice).not.toHaveBeenCalled();
  });

  it('opens a signed-out browser read link directly and persists analytics consent before opening', async () => {
    mocks.signedIn = false;
    const feedbackResult = {
      ...result,
      book: { ...result.book, format: 'epub', requestAnalytics: true },
    };
    mocks.fetchBookByCode.mockResolvedValue(feedbackResult);
    mocks.downloadGiftBook.mockResolvedValue(new ArrayBuffer(8));
    const importedBook = {
      hash: 'feedback-hash',
      analyticsStatus: undefined as string | undefined,
    };
    mocks.ingestFile.mockResolvedValue(importedBook);
    mocks.importBook.mockResolvedValue(importedBook);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(feedbackResult))));
    render(<ReadPage />);

    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith('/reader?ids=feedback-hash'),
    );
    expect(screen.queryByRole('button', { name: 'Start Reading' })).toBeNull();
    expect(mocks.ingestFile.mock.calls[0]?.[1]).toMatchObject({ isLoggedIn: false });
    expect(importedBook.analyticsStatus).toBe('ask');
    expect(mocks.saveLibraryBooks).toHaveBeenCalled();
    expect(mocks.saveLibraryBooks.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.router.replace.mock.invocationCallOrder[0]!,
    );
    expect(mocks.confirmGiftRedemption).toHaveBeenCalledWith('download-1');
  });

  it('saves a browser claim receipt before confirming or opening the reader', async () => {
    mocks.signedIn = false;
    vi.stubGlobal('crypto', webcrypto);
    const bytes = new TextEncoder().encode('immutable personalized edition').buffer;
    const delivery = {
      receipt: 'protected-copy',
      sourceSha256: Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex'),
    };
    mocks.fetchBookByCode.mockResolvedValue({
      ...result,
      book: { ...result.book, format: 'EPUB' },
    });
    mocks.downloadGiftBook.mockImplementation(
      async (_ref: string, _progress: unknown, onDelivery?: (value: DeliveryReceipt) => void) => {
        onDelivery?.(delivery);
        return bytes;
      },
    );
    mocks.ingestFile.mockImplementation(async ({ books }: { books: Book[] }) => {
      const book = { hash: 'receipt-book', title: 'Book', author: 'Author' } as Book;
      books.push(book);
      return book;
    });
    mocks.loadBookContent.mockResolvedValue({ file: { arrayBuffer: async () => bytes } });
    render(<ReadPage />);
    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith('/reader?ids=receipt-book'),
    );
    expect(mocks.saveLibraryBooks).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          hash: 'receipt-book',
          metadata: expect.objectContaining({ delivery }),
        }),
      ]),
    );
    expect(mocks.saveLibraryBooks.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.confirmGiftRedemption.mock.invocationCallOrder[0]!,
    );
  });

  it('persists a direct EPUB URL import before navigating to the reader', async () => {
    mocks.searchParams = new URLSearchParams('url=https://example.test/preview.epub');
    mocks.importBook.mockResolvedValue({ hash: 'preview-hash' });
    render(<ReadPage />);
    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith('/reader?ids=preview-hash'),
    );
    expect(mocks.saveLibraryBooks).toHaveBeenCalled();
    expect(mocks.saveLibraryBooks.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.router.replace.mock.invocationCallOrder[0]!,
    );
  });

  it('waits for durable library storage before consuming the claim or opening the book', async () => {
    let finishSave: (() => void) | undefined;
    mocks.saveLibraryBooks.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    mocks.downloadGiftBook.mockResolvedValue(new ArrayBuffer(8));
    mocks.ingestFile.mockResolvedValue({ hash: 'persisted-hash' });
    render(<BookCodeDialog />);
    act(() => mocks.dispatch('book-code-found', { result }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Reading' }));
    await waitFor(() => expect(mocks.saveLibraryBooks).toHaveBeenCalled());
    expect(mocks.confirmGiftRedemption).not.toHaveBeenCalled();
    expect(mocks.navigateToReader).not.toHaveBeenCalled();
    await act(async () => finishSave?.());
    await waitFor(() =>
      expect(mocks.navigateToReader).toHaveBeenCalledWith(mocks.router, ['persisted-hash']),
    );
  });

  it('loads the existing library before importing a browser claim', async () => {
    mocks.libraryLoaded = false;
    mocks.fetchBookByCode.mockResolvedValue(result);
    mocks.downloadGiftBook.mockResolvedValue(new ArrayBuffer(8));
    mocks.ingestFile.mockResolvedValue({ hash: 'loaded-library-hash' });
    const { rerender } = render(<ReadPage />);
    await act(async () => {});
    expect(mocks.fetchBookByCode).not.toHaveBeenCalled();
    expect(mocks.importBook).not.toHaveBeenCalled();
    mocks.libraryLoaded = true;
    mocks.isAndroidApp = false;
    rerender(<ReadPage />);
    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith('/reader?ids=loaded-library-hash'),
    );
  });

  it('does not consume a browser claim when durable library storage fails', async () => {
    mocks.signedIn = false;
    mocks.fetchBookByCode.mockResolvedValue(result);
    mocks.downloadGiftBook.mockResolvedValue(new ArrayBuffer(8));
    mocks.ingestFile.mockResolvedValue({ hash: 'unsaved-hash' });
    mocks.saveLibraryBooks.mockRejectedValueOnce(new Error('Local storage is unavailable'));
    render(<ReadPage />);
    expect(await screen.findByText('Local storage is unavailable')).toBeTruthy();
    expect(mocks.confirmGiftRedemption).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it('opens a browser claim only once when React replays its mount effects', async () => {
    mocks.fetchBookByCode.mockResolvedValue(result);
    mocks.downloadGiftBook.mockResolvedValue(new ArrayBuffer(8));
    mocks.ingestFile.mockResolvedValue({ hash: 'one-import-hash' });
    render(
      <React.StrictMode>
        <ReadPage />
      </React.StrictMode>,
    );
    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith('/reader?ids=one-import-hash'),
    );
    expect(mocks.fetchBookByCode).toHaveBeenCalledTimes(1);
    expect(mocks.ingestFile).toHaveBeenCalledTimes(1);
    expect(mocks.confirmGiftRedemption).toHaveBeenCalledTimes(1);
  });
});
