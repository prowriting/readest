import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';

const mocks = vi.hoisted(() => ({
  appService: { isIOSApp: false, hasWindow: false },
  router: {},
  navigateToLibrary: vi.fn(),
  setCheckOpenWithBooks: vi.fn(),
  handlers: new Map<string, (event: CustomEvent) => void>(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@tauri-apps/api/window', () => ({
  getAllWindows: vi.fn(),
  getCurrentWindow: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks.appService }) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ setCheckOpenWithBooks: mocks.setCheckOpenWithBooks }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { openBookInNewWindow: false } }) },
}));
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: mocks.navigateToLibrary,
  showLibraryWindow: vi.fn(),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: (name: string, handler: (event: CustomEvent) => void) => mocks.handlers.set(name, handler),
    off: (name: string) => mocks.handlers.delete(name),
  },
}));

const receive = async (urls: string[]) => {
  await act(async () => {
    mocks.handlers.get('app-incoming-url')?.(
      new CustomEvent('app-incoming-url', { detail: { urls } }),
    );
  });
};

describe('file import URL routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.appService.isIOSApp = false;
    window.OPEN_WITH_FILES = [];
  });

  it.each([
    'bookarc://open?code=example',
    'bookarc://share/example',
    'BOOKARC://book/hash/annotation/id',
    'readest://annotation/hash/id',
    'https://web.bookarc.app/o/book/hash/annotation/id',
  ])('leaves %s to its deep-link handler without navigating away', async (url) => {
    renderHook(() => useOpenWithBooks());
    await receive([url]);
    expect(mocks.navigateToLibrary).not.toHaveBeenCalled();
    expect(mocks.setCheckOpenWithBooks).not.toHaveBeenCalled();
    expect(window.OPEN_WITH_FILES).toEqual([]);
  });

  it('still imports files from a mixed URL payload', async () => {
    renderHook(() => useOpenWithBooks());
    await receive([
      'bookarc://open?code=example',
      'file:///downloads/My%20Book.epub',
      'content://documents/book.pdf',
      '/downloads/book.txt',
    ]);
    expect(window.OPEN_WITH_FILES).toEqual([
      '/downloads/My Book.epub',
      'content://documents/book.pdf',
      '/downloads/book.txt',
    ]);
    expect(mocks.setCheckOpenWithBooks).toHaveBeenCalledWith(true);
    expect(mocks.navigateToLibrary).toHaveBeenCalledOnce();
  });

  it('preserves the iOS file URL when importing a file', async () => {
    mocks.appService.isIOSApp = true;
    renderHook(() => useOpenWithBooks());
    await receive(['file:///downloads/My%20Book.epub']);
    expect(window.OPEN_WITH_FILES).toEqual(['file:///downloads/My Book.epub']);
    expect(mocks.navigateToLibrary).toHaveBeenCalledOnce();
  });
});
