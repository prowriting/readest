import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AudiobookCommand,
  AudiobookPlaybackSnapshot,
} from '@/services/audiobook/playbackBackend';

const BOOK_KEY = 'bookhash-view-1';
const pageDocument = document.implementation.createHTMLDocument('chapter');
pageDocument.body.innerHTML = '<p><span id="sentence-2">The second sentence.</span></p>';

const engine = Object.assign(new EventTarget(), {
  activeSectionIndex: 0,
  sectionOffset: 0,
  exportPlaybackManifest: vi.fn(async () => ({
    sections: [
      {
        sectionIndex: 0,
        duration: 10,
        segments: [
          {
            source: 'audio/chapter.mp3',
            type: 'audio/mpeg',
            clipBegin: 0,
            clipEnd: 10,
            sourceDuration: 10,
            cues: [{ offset: 0, text: 'chapter.xhtml#sentence-2' }],
          },
        ],
      },
      {
        sectionIndex: 1,
        duration: 10,
        segments: [
          {
            source: 'audio/chapter-2.mp3',
            type: 'audio/mpeg',
            clipBegin: 20,
            clipEnd: 30,
            sourceDuration: 40,
            cues: [{ offset: 0, text: 'chapter-2.xhtml#sentence-1' }],
          },
        ],
      },
    ],
  })),
  pause: vi.fn(),
  resume: vi.fn(),
  playFromText: vi.fn(async () => true),
  seekRelative: vi.fn(async (_seconds: number) => {}),
  setRate: vi.fn(),
  setVolume: vi.fn(),
  start: vi.fn(async (_sectionIndex: number) => {}),
  startAtOffset: vi.fn(async (_sectionIndex: number, _sectionOffset: number) => {}),
  stop: vi.fn(),
  synchronizeAtOffset: vi.fn(async () => true),
  textOffset: vi.fn(async () => null),
});

const playbackBackendMock = vi.hoisted(() => ({
  kind: 'web' as 'web' | 'native',
  control: vi.fn<(command: AudiobookCommand) => Promise<AudiobookPlaybackSnapshot | undefined>>(
    async () => undefined,
  ),
  getSnapshot: vi.fn<() => Promise<AudiobookPlaybackSnapshot | undefined>>(async () => undefined),
  subscribe: vi.fn<
    (
      listener: (snapshot: AudiobookPlaybackSnapshot) => void,
    ) => Promise<{ unregister: () => Promise<void> } | null>
  >(async () => null),
}));

const view = Object.assign(new EventTarget(), {
  book: {
    sections: [
      { mediaOverlay: {}, mediaOverlayDuration: 10 },
      { mediaOverlay: {}, mediaOverlayDuration: 10 },
    ],
    toc: [
      { href: 'chapter.xhtml', label: 'Chapter 1' },
      { href: 'chapter-2.xhtml', label: 'Chapter 2' },
    ],
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
  getPlaybackLocationFromCar: vi.fn(async () => undefined),
  listenCarControlIntents: vi.fn(async () => []),
  prepareAndPushCarPlayback: vi.fn(async () => {}),
  pushChaptersToCar: vi.fn(async () => {}),
  pushPlaybackLocationToCar: vi.fn(async () => {}),
  takePendingBookmarksFromCar: vi.fn(async () => []),
}));

vi.mock('@/services/audiobook/playbackBackend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/audiobook/playbackBackend')>();
  return {
    ...actual,
    createAudiobookPlaybackBackend: (
      options?: Parameters<typeof actual.createAudiobookPlaybackBackend>[0],
    ) => {
      if (playbackBackendMock.kind === 'native') return playbackBackendMock;
      if (!options) throw new Error('Web audiobook backend options are required');
      return actual.createWebAudiobookPlaybackBackend(options);
    },
  };
});

import { useAudiobookControl } from '@/app/reader/hooks/useAudiobookControl';
import { useAudiobookStore } from '@/store/audiobookStore';
import { eventDispatcher } from '@/utils/event';

describe('useAudiobookControl page tap lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (config as Record<string, unknown>)['mediaOverlayLocation'];
    engine.activeSectionIndex = 0;
    engine.sectionOffset = 0;
    engine.seekRelative.mockImplementation(async (seconds: number) => {
      engine.sectionOffset += seconds;
    });
    engine.start.mockImplementation(async (sectionIndex: number) => {
      engine.activeSectionIndex = sectionIndex;
      engine.sectionOffset = 0;
    });
    engine.startAtOffset.mockImplementation(async (sectionIndex: number, sectionOffset: number) => {
      engine.activeSectionIndex = sectionIndex;
      engine.sectionOffset = sectionOffset;
    });
    engine.stop.mockImplementation(() => {
      engine.activeSectionIndex = -1;
      engine.sectionOffset = 0;
    });
    engine.resume.mockImplementation(() => {});
    playbackBackendMock.kind = 'web';
    playbackBackendMock.control.mockResolvedValue(undefined);
    playbackBackendMock.getSnapshot.mockResolvedValue(undefined);
    playbackBackendMock.subscribe.mockResolvedValue(null);
    viewSettings.moPlaybackRate = 1;
    useAudiobookStore.setState({
      available: {},
      playbackStates: {},
      trayCollapsed: {},
      playerExpanded: {},
    });
  });

  it.each([
    'stopped',
    'ended',
  ] as const)('closing a %s web player preserves the next Play behavior', async (initialState) => {
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
    if (initialState === 'ended') {
      await act(async () => result.current.togglePlay());
      await act(async () => engine.dispatchEvent(new CustomEvent('ended')));
    }
    await waitFor(() => expect(result.current.state).toBe(initialState));
    await act(async () => result.current.dismiss());
    expect(result.current.state).toBe(initialState);
    engine.start.mockClear();
    engine.resume.mockClear();
    act(() => useAudiobookStore.getState().setTrayCollapsed(BOOK_KEY, false));
    await act(async () => result.current.togglePlay());
    expect(engine.start).toHaveBeenCalledOnce();
    expect(engine.resume).not.toHaveBeenCalled();
  });

  it('closing the web player pauses and saves its exact position without discarding resumable audio', async () => {
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });
    await act(async () => engine.dispatchEvent(new CustomEvent('highlight')));
    engine.sectionOffset = 3;
    engine.stop.mockClear();
    const events = vi.spyOn(engine, 'dispatchEvent');
    try {
      await act(async () => result.current.dismiss());
      expect(result.current.state).toBe('paused');
      expect(engine.pause).toHaveBeenCalled();
      expect(engine.stop).not.toHaveBeenCalled();
      expect(bookDataStore.setConfig).toHaveBeenCalledWith(
        BOOK_KEY,
        expect.objectContaining({
          mediaOverlayLocation: expect.objectContaining({
            locator: expect.objectContaining({
              locations: expect.objectContaining({ fragments: ['t=3'] }),
            }),
          }),
        }),
      );
      expect(useAudiobookStore.getState().trayCollapsed[BOOK_KEY]).toBe(true);
      expect(events.mock.calls.some(([event]) => event.type === 'unhighlight')).toBe(true);
      expect(view.mediaOverlayHighlightEnabled).toBe(false);
      expect(view.mediaOverlayFollowEnabled).toBe(false);
      const resumes = engine.resume.mock.calls.length;
      act(() => useAudiobookStore.getState().setTrayCollapsed(BOOK_KEY, false));
      expect(engine.resume).toHaveBeenCalledTimes(resumes);
      await act(async () => result.current.togglePlay());
      expect(engine.resume).toHaveBeenCalledTimes(resumes + 1);
      expect(engine.sectionOffset).toBe(3);
    } finally {
      events.mockRestore();
    }
  });

  it('routes phone transport controls exclusively to the native mobile player', async () => {
    playbackBackendMock.kind = 'native';
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));

    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(playbackBackendMock.control).toHaveBeenCalledWith({
        action: 'play',
        bookId: 'bookhash',
        location: undefined,
        rate: 1,
      }),
    );
    expect(engine.start).not.toHaveBeenCalled();
    expect(view.startMediaOverlay).not.toHaveBeenCalled();

    act(() => result.current.skipForward());
    expect(playbackBackendMock.control).toHaveBeenCalledWith({
      action: 'seekRelative',
      offsetMs: 30_000,
    });
  });

  it('waits for TTS teardown before starting the shared Android playback service', async () => {
    playbackBackendMock.kind = 'native';
    let finishTtsTeardown!: () => void;
    const ttsTeardownFinished = new Promise<void>((resolve) => {
      finishTtsTeardown = resolve;
    });
    const teardownListener = vi.fn(async () => {
      await ttsTeardownFinished;
    });
    eventDispatcher.on('tts-stop', teardownListener);

    try {
      const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
      act(() => result.current.togglePlay());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(teardownListener).toHaveBeenCalledOnce();
      expect(playbackBackendMock.control).not.toHaveBeenCalled();

      finishTtsTeardown();
      await waitFor(() =>
        expect(playbackBackendMock.control).toHaveBeenCalledWith({
          action: 'play',
          bookId: 'bookhash',
          location: undefined,
          rate: 1,
        }),
      );
    } finally {
      finishTtsTeardown();
      eventDispatcher.off('tts-stop', teardownListener);
    }
  });

  it('starts native playback atomically with the current book playback rate', async () => {
    playbackBackendMock.kind = 'native';
    viewSettings.moPlaybackRate = 1.5;
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));

    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(playbackBackendMock.control).toHaveBeenCalledWith({
        action: 'play',
        bookId: 'bookhash',
        location: undefined,
        rate: 1.5,
      }),
    );
    expect(playbackBackendMock.control).not.toHaveBeenCalledWith({
      action: 'setRate',
      rate: 1.5,
    });
  });

  it('adopts a playback-rate change made by the native car player', async () => {
    playbackBackendMock.kind = 'native';
    playbackBackendMock.getSnapshot.mockResolvedValue({
      sessionId: 'car-session',
      sequence: 2,
      bookId: 'bookhash',
      state: 'paused',
      chapterIndex: 0,
      chapterPositionMs: 2_000,
      chapterDurationMs: 10_000,
      playbackRate: 1.5,
      isBookmarked: false,
    });

    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));

    await waitFor(() => expect(result.current.rate).toBe(1.5));
  });

  it('keeps the phone player active through a foreground snapshot refresh', async () => {
    playbackBackendMock.kind = 'native';
    let nativeListener: ((snapshot: AudiobookPlaybackSnapshot) => void) | undefined;
    playbackBackendMock.subscribe.mockImplementation(async (listener) => {
      nativeListener = listener;
      return { unregister: vi.fn(async () => {}) };
    });
    const activeLocation = {
      schemaVersion: 2 as const,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=6'] },
      },
      textLocator: {
        href: 'chapter.xhtml',
        type: 'application/xhtml+xml',
        locations: { fragments: ['sentence-2'] },
      },
      updatedAt: 6_000,
    };
    const snapshot = (
      sequence: number,
      state: AudiobookPlaybackSnapshot['state'],
    ): AudiobookPlaybackSnapshot => ({
      sessionId: 'android-auto-session',
      sequence,
      bookId: 'bookhash',
      state,
      location: activeLocation,
      chapterIndex: 0,
      chapterPositionMs: 6_000,
      chapterDurationMs: 10_000,
      playbackRate: 1,
      isBookmarked: false,
    });

    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await waitFor(() => expect(nativeListener).toBeDefined());

    act(() => nativeListener?.(snapshot(20, 'playing')));
    await waitFor(() => expect(result.current.state).toBe('playing'));

    // ExoPlayer can briefly be ready-but-not-playing while it fulfils the
    // retained Play request. Native maps that transition to loading so the
    // phone continues to render Pause instead of flickering back to Play.
    act(() => nativeListener?.(snapshot(21, 'loading')));

    await waitFor(() => expect(result.current.state).toBe('loading'));
  });

  it('still synchronizes the page and sentence when rapid native snapshots share a cue', async () => {
    playbackBackendMock.kind = 'native';
    let nativeListener: ((snapshot: AudiobookPlaybackSnapshot) => void) | undefined;
    playbackBackendMock.subscribe.mockImplementation(async (listener) => {
      nativeListener = listener;
      return { unregister: vi.fn(async () => {}) };
    });
    const activeLocation = {
      schemaVersion: 2 as const,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter-2.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=25'] },
      },
      textLocator: {
        href: 'chapter-2.xhtml',
        type: 'application/xhtml+xml',
        locations: { fragments: ['sentence-1'] },
      },
      updatedAt: 25_000,
    };
    const snapshot = (sequence: number): AudiobookPlaybackSnapshot => ({
      sessionId: 'android-auto-session',
      sequence,
      bookId: 'bookhash',
      state: 'playing',
      location: activeLocation,
      chapterIndex: 1,
      chapterPositionMs: 5_000,
      chapterDurationMs: 10_000,
      playbackRate: 1,
      isBookmarked: false,
    });

    renderHook(() => useAudiobookControl(BOOK_KEY));
    await waitFor(() => expect(nativeListener).toBeDefined());
    engine.synchronizeAtOffset.mockClear();
    view.goTo.mockClear();

    act(() => {
      nativeListener?.(snapshot(30));
      nativeListener?.(snapshot(31));
    });

    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledWith(1, 5));
    expect(view.goTo).toHaveBeenCalledWith('chapter-2.xhtml#sentence-1');
  });

  it('unregisters a native snapshot listener that resolves after unmount', async () => {
    playbackBackendMock.kind = 'native';
    const unregister = vi.fn(async () => {});
    const finishRegistrations: Array<(listener: { unregister: typeof unregister }) => void> = [];
    playbackBackendMock.subscribe.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRegistrations.push(resolve);
        }),
    );

    const { unmount } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await waitFor(() => expect(playbackBackendMock.subscribe).toHaveBeenCalled());
    unmount();
    const registrationCount = finishRegistrations.length;
    finishRegistrations.forEach((finish) => finish({ unregister }));

    await waitFor(() => expect(unregister).toHaveBeenCalledTimes(registrationCount));
  });

  afterEach(() => {
    cleanup();
  });

  it('pauses audiobook ownership before TTS starts', async () => {
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
      engine.dispatchEvent(new CustomEvent('highlight'));
    });
    engine.pause.mockClear();

    await act(async () => {
      await eventDispatcher.dispatch('audiobook-pause', {});
    });

    expect(engine.pause).toHaveBeenCalledOnce();
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

  it('ignores a legacy chapter offset and starts at the beginning', async () => {
    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      sectionIndex: 0,
      offset: 6,
      updatedAt: 1,
    };
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));

    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });

    expect(engine.start).toHaveBeenCalledWith(0);
    expect(engine.startAtOffset).not.toHaveBeenCalled();
  });

  it('resumes a valid locator at its exact resource-clock position', async () => {
    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=4'] },
      },
      updatedAt: 2,
    };
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));

    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });

    expect(engine.startAtOffset).toHaveBeenCalledWith(0, 4);
    expect(view.startMediaOverlay).not.toHaveBeenCalled();
  });

  it('hands a newer Android Auto locator off to an already-mounted paused web player', async () => {
    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=2'] },
      },
      updatedAt: 2,
    };
    engine.sectionOffset = 2;
    const { result, rerender } = renderHook(() => useAudiobookControl(BOOK_KEY));

    // The reader was playing before Android Auto took over, leaving its web
    // audio element paused at the old position while the car advanced.
    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });
    await waitFor(() => expect(engine.startAtOffset).toHaveBeenCalledWith(0, 2));
    act(() => {
      engine.dispatchEvent(
        new CustomEvent('highlight', { detail: { text: 'chapter.xhtml#sentence-2' } }),
      );
    });
    act(() => result.current.togglePlay());
    expect(result.current.state).toBe('paused');

    // Foreground reconciliation writes the newer native locator into the
    // open book config. The mounted hook must adopt it, not resume the stale
    // (and potentially suspended) HTML audio element.
    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=8'] },
      },
      updatedAt: Date.now() + 10_000,
    };
    rerender();
    engine.startAtOffset.mockClear();
    engine.resume.mockClear();

    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });

    await waitFor(() => expect(engine.startAtOffset).toHaveBeenCalledWith(0, 8));
    expect(engine.resume).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.chapterElapsed).toBe(8));
  });

  it('adopts a newer Android Auto locator that crosses into another chapter', async () => {
    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=2'] },
      },
      updatedAt: 2,
    };
    engine.sectionOffset = 2;
    const { result, rerender } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await waitFor(() => expect(result.current.chapterElapsed).toBe(2));

    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });
    await waitFor(() => expect(engine.startAtOffset).toHaveBeenCalledWith(0, 2));
    act(() => {
      engine.dispatchEvent(
        new CustomEvent('highlight', { detail: { text: 'chapter.xhtml#sentence-2' } }),
      );
      result.current.togglePlay();
    });
    expect(result.current.state).toBe('paused');

    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter-2.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=21'] },
      },
      textLocator: {
        href: 'chapter-2.xhtml',
        type: 'application/xhtml+xml',
        locations: { fragments: ['sentence-1'] },
      },
      updatedAt: Date.now() + 10_000,
    };
    rerender();
    engine.startAtOffset.mockClear();
    engine.resume.mockClear();

    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });

    await waitFor(() => expect(engine.startAtOffset).toHaveBeenCalledWith(1, 1));
    expect(engine.resume).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.sectionIndex).toBe(1);
      expect(result.current.chapterElapsed).toBe(1);
    });
  });

  it('shows a paused handoff state when newer car progress arrives while web playback is active', async () => {
    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=2'] },
      },
      updatedAt: 2,
    };
    engine.sectionOffset = 2;
    const { result, rerender } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });
    act(() => {
      engine.dispatchEvent(
        new CustomEvent('highlight', { detail: { text: 'chapter.xhtml#sentence-2' } }),
      );
    });
    expect(result.current.state).toBe('playing');

    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=8'] },
      },
      updatedAt: 8,
    };
    rerender();

    await waitFor(() => expect(result.current.state).toBe('paused'));
    expect(result.current.chapterElapsed).toBe(8);
  });

  it('recovers a loading web player when Android Auto returns a newer locator', async () => {
    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=1'] },
      },
      updatedAt: 1,
    };
    const { result, rerender } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });
    expect(result.current.state).toBe('loading');

    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=7'] },
      },
      updatedAt: 7,
    };
    rerender();
    engine.startAtOffset.mockClear();

    await waitFor(() => expect(result.current.state).toBe('paused'));
    expect(result.current.chapterElapsed).toBe(7);
    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });
    expect(engine.startAtOffset).toHaveBeenCalledWith(0, 7);
  });

  it('keeps the newest locator through repeated Auto reconnect cycles', async () => {
    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=1'] },
      },
      updatedAt: 1,
    };
    const { result, rerender } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await waitFor(() => expect(result.current.chapterElapsed).toBe(1));

    for (const position of [3, 5, 9]) {
      (config as Record<string, unknown>)['mediaOverlayLocation'] = {
        schemaVersion: 2,
        editionId: 'bookhash',
        locator: {
          href: 'audio/chapter.mp3',
          type: 'audio/mpeg',
          locations: { fragments: [`t=${position}`] },
        },
        updatedAt: position,
      };
      rerender();
    }

    await waitFor(() => expect(result.current.chapterElapsed).toBe(9));
    engine.startAtOffset.mockClear();
    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });
    expect(engine.startAtOffset).toHaveBeenCalledWith(0, 9);
  });

  it('still resumes the retained engine when no newer external locator arrived', async () => {
    (config as Record<string, unknown>)['mediaOverlayLocation'] = {
      schemaVersion: 2,
      editionId: 'bookhash',
      locator: {
        href: 'audio/chapter.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=4'] },
      },
      updatedAt: 4,
    };
    engine.sectionOffset = 4;
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });
    act(() => {
      engine.dispatchEvent(
        new CustomEvent('highlight', { detail: { text: 'chapter.xhtml#sentence-2' } }),
      );
      result.current.togglePlay();
    });
    engine.startAtOffset.mockClear();
    engine.resume.mockClear();

    act(() => result.current.togglePlay());

    await waitFor(() => expect(engine.resume).toHaveBeenCalledOnce());
    expect(engine.startAtOffset).not.toHaveBeenCalled();
  });

  it('shows paused when the browser interrupts the actual audio element', async () => {
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });
    act(() => {
      engine.dispatchEvent(
        new CustomEvent('highlight', { detail: { text: 'chapter.xhtml#sentence-2' } }),
      );
    });
    expect(result.current.state).toBe('playing');

    act(() => engine.dispatchEvent(new CustomEvent('pause')));

    expect(result.current.state).toBe('paused');
  });
});
