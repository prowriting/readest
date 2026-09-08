import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Set<(event: CustomEvent) => void>>();
  return {
    router: { push: vi.fn() },
    downloadGiftBook: vi.fn(),
    confirmGiftRedemption: vi.fn(),
    ingestFile: vi.fn(),
    navigateToReader: vi.fn(),
    saveLibraryBooks: vi.fn(),
    handlers,
    dispatch: (name: string, detail: unknown) => {
      handlers.get(name)?.forEach((handler) => handler(new CustomEvent(name, { detail })));
    },
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('next/image', () => ({
  default: () => null,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { isAndroidApp: false, saveLibraryBooks: mocks.saveLibraryBooks },
  }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'reader-1' } }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, options?: Record<string, unknown>) =>
    options?.['percent'] === undefined
      ? value
      : value.replace('{{percent}}', String(options['percent'])),
}));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/libraryStore', () => {
  const libraryState = { library: [], visibleLibrary: [], setLibrary: vi.fn() };
  return {
    useLibraryStore: (selector: (state: typeof libraryState) => unknown) => selector(libraryState),
  };
});
vi.mock('@/services/environment', () => ({
  isStoreCapture: () => false,
  isTauriAppPlatform: () => false,
  isWebAppPlatform: () => false,
}));
vi.mock('@/services/ingestService', () => ({ ingestFile: mocks.ingestFile }));
vi.mock('@/services/bookCode', () => ({
  BookCodeError: class extends Error {},
  downloadGiftBook: mocks.downloadGiftBook,
  confirmGiftRedemption: mocks.confirmGiftRedemption,
}));
vi.mock('@/utils/bridge', () => ({ detectKindle: vi.fn(), sendToKindleApp: vi.fn() }));
vi.mock('@/utils/nav', () => ({ navigateToReader: mocks.navigateToReader }));
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
  });

  it('shows download progress and opens the saved book when import completes', async () => {
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

    await waitFor(() =>
      expect(mocks.navigateToReader).toHaveBeenCalledWith(mocks.router, [importedBook.hash]),
    );
  });
});
