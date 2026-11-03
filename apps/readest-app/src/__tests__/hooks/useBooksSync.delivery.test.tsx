import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import { useBooksSync } from '@/app/library/hooks/useBooksSync';

const mocks = vi.hoisted(() => ({
  library: [] as Book[],
  syncedBooks: [] as Book[],
  setLibrary: vi.fn(),
  saveLibraryBooks: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { saveLibraryBooks: mocks.saveLibraryBooks } }),
}));
vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({
    syncedBooks: mocks.syncedBooks,
    syncBooks: vi.fn(),
    lastSyncedAtBooks: 0,
    useSyncInited: false,
  }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: Object.assign(
    () => ({
      library: mocks.library,
      libraryLoaded: true,
      isSyncing: false,
      setLibrary: mocks.setLibrary,
    }),
    { getState: () => ({ library: mocks.library }) },
  ),
}));

describe('synced book delivery restrictions', () => {
  afterEach(cleanup);
  it.each([
    [1, 2, true, false],
    [2, 1, false, true],
    [2, 1, true, false],
    [1, 2, false, true],
  ])('retains a restriction from either side regardless of which metadata wins (%s/%s)', async (localTime, remoteTime, localRestriction, remoteRestriction) => {
    vi.clearAllMocks();
    const book = (updatedAt: number, appOnlyReading: boolean, title: string): Book => ({
      hash: 'gift-hash',
      title,
      author: 'Author',
      format: 'EPUB',
      createdAt: 1,
      updatedAt,
      metadata: {
        title,
        author: 'Author',
        language: 'en',
        ...(appOnlyReading ? { appOnlyReading } : {}),
      },
    });
    mocks.library = [book(Number(localTime), Boolean(localRestriction), 'Local')];
    mocks.syncedBooks = [book(Number(remoteTime), Boolean(remoteRestriction), 'Remote')];
    renderHook(() => useBooksSync());
    await waitFor(() => expect(mocks.saveLibraryBooks).toHaveBeenCalled());
    expect(mocks.setLibrary.mock.calls[0]?.[0][0].metadata).toMatchObject({
      appOnlyReading: true,
      title: Number(localTime) > Number(remoteTime) ? 'Local' : 'Remote',
    });
  });
});
