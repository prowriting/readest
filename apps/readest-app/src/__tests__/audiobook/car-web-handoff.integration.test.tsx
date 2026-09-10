import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, BookConfig, MediaOverlayLocation } from '@/types/book';

const BOOK_ID = 'bookhash';
const BOOK_KEY = `${BOOK_ID}-view-1`;

const mocks = vi.hoisted(() => ({
  appService: {
    loadBookConfig: vi.fn(),
    saveBookConfig: vi.fn(async () => {}),
  },
  envConfig: {},
  getPlaybackLocationFromCar: vi.fn(),
  libraryState: {
    library: [] as Book[],
    libraryLoaded: true,
    updateBook: vi.fn(async () => {}),
  },
  prepareCarAudiobookLibrary: vi.fn(async () => {}),
  pushChanges: vi.fn(async () => true),
  pushPlaybackLocationToCar: vi.fn(async () => {}),
  readerState: {} as Record<string, unknown>,
  settings: { alwaysInForeground: false },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: mocks.appService, envConfig: mocks.envConfig }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/useSync', () => ({ useSync: () => ({ pushChanges: mocks.pushChanges }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/libs/mediaSession', () => ({
  getMediaSession: () => null,
  TauriMediaSession: class {},
}));
vi.mock('@/services/audiobook/carLibraryPreparation', () => ({
  prepareCarAudiobookLibrary: mocks.prepareCarAudiobookLibrary,
}));
vi.mock('@/services/audiobook/carBridge', () => ({
  buildBridgeChapters: vi.fn(() => ({ bookId: BOOK_ID, chapters: [] })),
  consumePendingCarPlayIntent: vi.fn(() => null),
  getPlaybackLocationFromCar: mocks.getPlaybackLocationFromCar,
  listenCarControlIntents: vi.fn(async () => []),
  listenCarPlayIntents: vi.fn(async () => null),
  prepareAndPushCarPlayback: vi.fn(async () => false),
  pushChaptersToCar: vi.fn(async () => {}),
  pushLibraryToCar: vi.fn(async () => {}),
  pushPlaybackLocationToCar: mocks.pushPlaybackLocationToCar,
  setPendingCarPlayIntent: vi.fn(),
  takePendingBookmarksFromCar: vi.fn(async () => []),
}));
vi.mock('@/store/bookDataStore', async () => {
  const { create } = await import('zustand');
  const useBookDataStore = create<{
    booksData: Record<string, { book: Book; config: BookConfig }>;
    getBookData: (key: string) => { book: Book; config: BookConfig } | null;
    getConfig: (key: string) => BookConfig | null;
    setConfig: (key: string, patch: Partial<BookConfig>) => void;
    saveConfig: ReturnType<typeof vi.fn>;
    updateBooknotes: ReturnType<typeof vi.fn>;
  }>((set, get) => ({
    booksData: {},
    getBookData: (key) => get().booksData[key.split('-')[0]!] ?? null,
    getConfig: (key) => get().booksData[key.split('-')[0]!]?.config ?? null,
    setConfig: (key, configPatch) =>
      set((state) => {
        const id = key.split('-')[0]!;
        const current = state.booksData[id];
        if (!current) return state;
        return {
          booksData: {
            ...state.booksData,
            [id]: { ...current, config: { ...current.config, ...configPatch } },
          },
        };
      }),
    saveConfig: vi.fn(async () => {}),
    updateBooknotes: vi.fn(),
  }));
  return { useBookDataStore };
});
vi.mock('@/store/libraryStore', () => {
  const useLibraryStore = Object.assign(
    (selector?: (state: typeof mocks.libraryState) => unknown) =>
      selector ? selector(mocks.libraryState) : mocks.libraryState,
    { getState: () => mocks.libraryState },
  );
  return { useLibraryStore };
});
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => mocks.readerState,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: mocks.settings }),
}));
vi.mock('@/utils/nav', () => ({ navigateToReader: vi.fn() }));
vi.mock('@/utils/serializer', () => ({
  serializeConfig: (config: unknown) => JSON.stringify(config),
}));

import CarBridgeListener from '@/components/CarBridgeListener';
import { useAudiobookControl } from '@/app/reader/hooks/useAudiobookControl';
import { useBookDataStore } from '@/store/bookDataStore';

const manifest = {
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
          cues: [{ offset: 0, text: 'chapter.xhtml#sentence-1' }],
        },
      ],
    },
  ],
};

const engine = Object.assign(new EventTarget(), {
  activeSectionIndex: 0,
  sectionOffset: 2,
  exportPlaybackManifest: vi.fn(async () => manifest),
  pause: vi.fn(),
  resume: vi.fn(),
  playFromText: vi.fn(async () => true),
  seekRelative: vi.fn(async (_seconds: number) => {}),
  setRate: vi.fn(),
  setVolume: vi.fn(),
  start: vi.fn(async (_sectionIndex: number) => {}),
  startAtOffset: vi.fn(async (_sectionIndex: number, _sectionOffset: number) => {}),
  stop: vi.fn(),
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
  renderer: { getContents: () => [], setStyles: vi.fn() },
  resolveCFI: vi.fn(),
  resolveNavigation: vi.fn(() => ({ index: 0 })),
  startMediaOverlay: vi.fn(async () => {}),
});

const viewSettings = {
  moHighlightOptions: { style: 'highlight' as const, color: '#ffff00' },
  moPlaybackRate: 1,
  moReadAlongEnabled: true,
  moSkipBackSec: 15,
  moSkipForwardSec: 30,
};

const book = {
  author: 'Author',
  audioDuration: 10,
  downloadedAt: 1,
  format: 'EPUB',
  hasAudio: true,
  hash: BOOK_ID,
  metaHash: 'metadata-id',
  title: 'Book',
  updatedAt: 1,
} as Book;

const location = (time: number, updatedAt: number): MediaOverlayLocation => ({
  schemaVersion: 2,
  editionId: BOOK_ID,
  locator: {
    href: 'audio/chapter.mp3',
    type: 'audio/mpeg',
    locations: { fragments: [`t=${time}`], totalProgression: time / 10 },
  },
  updatedAt,
});

describe('car bridge and mounted reader integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPlaybackLocationFromCar.mockReset();
    mocks.getPlaybackLocationFromCar.mockResolvedValue(undefined);
    engine.activeSectionIndex = 0;
    engine.sectionOffset = 2;
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
    const config = {
      bookHash: BOOK_ID,
      booknotes: [],
      mediaOverlayLocation: location(2, 2),
      updatedAt: 2,
      viewSettings,
    } as BookConfig;
    useBookDataStore.setState({
      booksData: {
        [BOOK_ID]: {
          id: BOOK_ID,
          book,
          config,
          file: null,
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    mocks.libraryState.library = [book];
    mocks.readerState = {
      getView: () => view,
      getViewSettings: () => viewSettings,
      setViewSettings: vi.fn(),
    };
    mocks.appService.loadBookConfig.mockImplementation(
      async () => useBookDataStore.getState().getConfig(BOOK_KEY)!,
    );
  });

  afterEach(() => {
    cleanup();
    useBookDataStore.setState({ booksData: {} });
  });

  it('carries the native locator through reconciliation into the mounted player', async () => {
    const hook = renderHook(() => useAudiobookControl(BOOK_KEY));
    await waitFor(() => expect(hook.result.current.chapterElapsed).toBe(2));
    await act(async () => {
      hook.result.current.togglePlay();
      await Promise.resolve();
    });
    act(() => {
      engine.dispatchEvent(
        new CustomEvent('highlight', { detail: { text: 'chapter.xhtml#sentence-1' } }),
      );
      hook.result.current.togglePlay();
    });

    const nativeLocation = location(8, Date.now() + 10_000);
    mocks.getPlaybackLocationFromCar.mockResolvedValue(nativeLocation);
    render(<CarBridgeListener />);
    await waitFor(() =>
      expect(useBookDataStore.getState().getConfig(BOOK_KEY)?.mediaOverlayLocation).toEqual(
        nativeLocation,
      ),
    );
    engine.startAtOffset.mockClear();
    engine.resume.mockClear();
    engine.stop.mockClear();

    await act(async () => {
      hook.result.current.togglePlay();
      await Promise.resolve();
    });

    // Foliate's real MediaOverlay deliberately keeps startAtOffset paused
    // when its internal state is paused. A car handoff therefore has to stop
    // the stale element before starting the exact native locator.
    expect(engine.stop).toHaveBeenCalledOnce();
    expect(engine.startAtOffset).toHaveBeenCalledWith(0, 8);
    expect(engine.stop.mock.invocationCallOrder[0]).toBeLessThan(
      engine.startAtOffset.mock.invocationCallOrder[0]!,
    );
    expect(engine.resume).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.chapterElapsed).toBe(8));
  });

  it('cold-opens at the final Android Auto position without breaking the first Play request', async () => {
    let resolveNativeLocation: ((value: MediaOverlayLocation) => void) | undefined;
    mocks.getPlaybackLocationFromCar.mockReturnValue(
      new Promise<MediaOverlayLocation>((resolve) => {
        resolveNativeLocation = resolve;
      }),
    );

    // The app shell foregrounds first and begins reading the native marker,
    // but the user can open the book before that bridge call completes.
    render(<CarBridgeListener />);
    await waitFor(() => expect(mocks.getPlaybackLocationFromCar).toHaveBeenCalledWith(BOOK_ID));

    const hook = renderHook(() => useAudiobookControl(BOOK_KEY));
    await waitFor(() => expect(hook.result.current.chapterElapsed).toBe(2));

    // One tap should be enough. It must not start stale web audio and then
    // leave the player paused when the final native locator arrives.
    await act(async () => {
      hook.result.current.togglePlay();
      await Promise.resolve();
    });

    const finalNativeLocation = location(8, Date.now() + 10_000);
    resolveNativeLocation?.(finalNativeLocation);
    await waitFor(() =>
      expect(useBookDataStore.getState().getConfig(BOOK_KEY)?.mediaOverlayLocation).toEqual(
        finalNativeLocation,
      ),
    );
    await waitFor(() => expect(hook.result.current.chapterElapsed).toBe(8));

    expect({
      lastEngineStart: engine.startAtOffset.mock.lastCall,
      playerState: hook.result.current.state,
    }).toEqual({
      lastEngineStart: [0, 8],
      playerState: 'loading',
    });
  });
});
