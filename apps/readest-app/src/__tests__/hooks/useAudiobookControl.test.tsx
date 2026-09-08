import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BOOK_KEY = 'bookhash-view-1';
const pageDocument = document.implementation.createHTMLDocument('chapter');
pageDocument.body.innerHTML = '<p><span id="sentence-2">The second sentence.</span></p>';

const engine = Object.assign(new EventTarget(), {
  activeSectionIndex: 0,
  sectionOffset: 0,
  pause: vi.fn(),
  playFromText: vi.fn(async () => true),
  seekRelative: vi.fn(async () => {}),
  setRate: vi.fn(),
  setVolume: vi.fn(),
  start: vi.fn(async () => {}),
  startAtOffset: vi.fn(async () => {}),
  textOffset: vi.fn(async () => null),
});

const view = Object.assign(new EventTarget(), {
  book: {
    sections: [{ mediaOverlay: {}, mediaOverlayDuration: 10 }],
    toc: [{ href: 'chapter.xhtml', label: 'Chapter 1' }],
  },
  getCFI: vi.fn(),
  goTo: vi.fn(),
  mediaOverlay: engine,
  mediaOverlayFollowEnabled: true,
  mediaOverlayHighlightEnabled: true,
  renderer: {
    getContents: () => [{ doc: pageDocument, index: 0 }],
    setStyles: vi.fn(),
  },
  resolveCFI: vi.fn(),
  resolveNavigation: vi.fn(() => ({ index: 0 })),
  startMediaOverlay: vi.fn(async () => {}),
});

const viewSettings = {
  moHighlightOptions: { style: 'highlight', color: '#ffff00' },
  moPlaybackRate: 1,
  moReadAlongEnabled: true,
  moSkipBackSec: 15,
  moSkipForwardSec: 30,
};

const book = {
  author: 'Charles Dickens',
  format: 'EPUB',
  hasAudio: true,
  hash: 'bookhash',
  title: 'A Christmas Carol',
};

const config = {
  booknotes: [],
  viewSettings,
};

const settingsStore = { settings: { alwaysInForeground: false } };
const bookDataStore = {
  getBookData: vi.fn(() => ({ book })),
  getConfig: vi.fn(() => config),
  saveConfig: vi.fn(),
  setConfig: vi.fn(),
  updateBooknotes: vi.fn(),
};
const libraryStore = { updateBook: vi.fn(async () => {}) };
const readerStore = {
  getView: vi.fn(() => view),
  getViewSettings: vi.fn(() => viewSettings),
  setViewSettings: vi.fn(),
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null, envConfig: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => settingsStore,
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => bookDataStore,
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => libraryStore,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => readerStore,
}));

vi.mock('@/libs/mediaSession', () => ({
  getMediaSession: () => null,
  TauriMediaSession: class {},
}));

vi.mock('@/services/audiobook/carBridge', () => ({
  buildBridgeChapters: vi.fn(() => ({ bookId: 'bookhash', chapters: [] })),
  consumePendingCarPlayIntent: vi.fn(() => null),
  prepareAndPushCarPlayback: vi.fn(async () => {}),
  pushChaptersToCar: vi.fn(async () => {}),
}));

import { useAudiobookControl } from '@/app/reader/hooks/useAudiobookControl';
import { useAudiobookStore } from '@/store/audiobookStore';
import { eventDispatcher } from '@/utils/event';

describe('useAudiobookControl page tap lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAudiobookStore.setState({
      available: {},
      playbackStates: {},
      trayCollapsed: {},
      playerExpanded: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not seek or highlight a tapped sentence after leaving Android Auto and dismissing the player', async () => {
    renderHook(() => useAudiobookControl(BOOK_KEY));

    // Android Auto starts playback through the car bridge. Disconnecting the
    // head unit currently emits no web event, so the hook remains active.
    await act(async () => {
      await eventDispatcher.dispatch('car-audiobook-play', {
        bookId: 'bookhash',
        chapterIndex: 0,
      });
    });

    // This is the close button on the in-page audiobook mini player.
    act(() => {
      useAudiobookStore.getState().setTrayCollapsed(BOOK_KEY, true);
    });

    const sentence = pageDocument.getElementById('sentence-2')!;
    await act(async () => {
      sentence.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(engine.playFromText).not.toHaveBeenCalled();
  });

  it('restores tap-to-seek after the dismissed player is shown again', async () => {
    renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      await eventDispatcher.dispatch('car-audiobook-play', {
        bookId: 'bookhash',
        chapterIndex: 0,
      });
    });

    act(() => {
      useAudiobookStore.getState().setTrayCollapsed(BOOK_KEY, true);
      useAudiobookStore.getState().setTrayCollapsed(BOOK_KEY, false);
    });

    pageDocument
      .getElementById('sentence-2')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(engine.playFromText).toHaveBeenCalledWith(0, 'sentence-2');
  });

  it('removes page tap handlers when the audiobook control unmounts', async () => {
    const { unmount } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      await eventDispatcher.dispatch('car-audiobook-play', {
        bookId: 'bookhash',
        chapterIndex: 0,
      });
    });

    unmount();
    engine.playFromText.mockClear();
    pageDocument
      .getElementById('sentence-2')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(engine.playFromText).not.toHaveBeenCalled();
  });
});
