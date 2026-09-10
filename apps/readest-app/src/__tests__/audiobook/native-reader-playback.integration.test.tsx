import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
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
  synchronizeAtOffset: vi.fn(async (_sectionIndex: number, _offset: number) => true),
  textOffset: vi.fn(async () => null),
});

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

const config: {
  booknotes: never[];
  viewSettings: typeof viewSettings;
  mediaOverlayLocation?: import('@/types/book').MediaOverlayLocation;
} = {
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

const environment = { appService: null, envConfig: {} };

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => environment,
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

import AudiobookMiniBar from '@/app/reader/components/audiobook/AudiobookMiniBar';
import { useAudiobookControl } from '@/app/reader/hooks/useAudiobookControl';
import { useAudiobookStore } from '@/store/audiobookStore';
import { eventDispatcher } from '@/utils/event';
import { Channel } from '@tauri-apps/api/core';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/misc', async (original) => ({
  ...(await original<typeof import('@/utils/misc')>()),
  getOSPlatform: () => 'android',
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const snapshot = (
  sequence: number,
  state: AudiobookPlaybackSnapshot['state'] = 'playing',
  chapterIndex = 0,
  overrides: Partial<AudiobookPlaybackSnapshot> = {},
): AudiobookPlaybackSnapshot => ({
  sessionId: 'android-auto-session',
  sequence,
  bookId: book.hash,
  state,
  chapterIndex,
  chapterPositionMs: 5_000,
  chapterDurationMs: 10_000,
  playbackRate: 1,
  isBookmarked: false,
  location: {
    schemaVersion: 2,
    editionId: book.hash,
    updatedAt: sequence * 1_000,
    locator: {
      href: chapterIndex ? 'audio/chapter-2.mp3' : 'audio/chapter.mp3',
      type: 'audio/mpeg',
      locations: { fragments: [chapterIndex ? 't=25' : 't=5'] },
    },
    textLocator: {
      href: chapterIndex ? 'chapter-2.xhtml' : 'chapter.xhtml',
      type: 'application/xhtml+xml',
      locations: { fragments: [chapterIndex ? 'sentence-1' : 'sentence-2'] },
    },
  },
  ...overrides,
});

// Keep the real Tauri addPluginListener, Channel, native backend and reader hook.
// Only the IPC/native service is replaced. Plugin.trigger sends a direct snapshot,
// unlike the { payload } envelope used by Tauri's separate global event API.
let nativeSnapshot: AudiobookPlaybackSnapshot;
const channels = new Map<number, Channel<AudiobookPlaybackSnapshot>>();
const control = vi.fn<(command: AudiobookCommand) => Promise<AudiobookPlaybackSnapshot>>();
const getSnapshot = vi.fn<() => Promise<AudiobookPlaybackSnapshot>>();
const register = vi.fn<() => Promise<void>>();
const unregistered = vi.fn();
const emit = (value: AudiobookPlaybackSnapshot) => {
  nativeSnapshot = value;
  for (const channel of [...channels.values()]) channel.onmessage(value);
};
const visibility = (value: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
};
const mountReader = async () => {
  const result = renderHook(() => useAudiobookControl(BOOK_KEY));
  await waitFor(() => expect(channels.size).toBe(1));
  await waitFor(() => expect(result.result.current.state).toBe(nativeSnapshot.state));
  return result;
};

beforeEach(() => {
  vi.clearAllMocks();
  nativeSnapshot = snapshot(1);
  channels.clear();
  delete config.mediaOverlayLocation;
  viewSettings.moReadAlongEnabled = true;
  viewSettings.moPlaybackRate = 1;
  engine.synchronizeAtOffset.mockReset().mockResolvedValue(true);
  engine.stop.mockImplementation(() => {});
  bookDataStore.setConfig.mockImplementation((_key, patch) => Object.assign(config, patch));
  useAudiobookStore.setState({
    available: {},
    playbackStates: {},
    trayCollapsed: {},
    playerExpanded: {},
  });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  register.mockReset().mockResolvedValue();
  getSnapshot.mockReset().mockImplementation(async () => nativeSnapshot);
  control.mockReset().mockImplementation(async (command) => {
    nativeSnapshot = snapshot(
      nativeSnapshot.sequence + 1,
      command.action === 'pause' ? 'paused' : 'playing',
      nativeSnapshot.chapterIndex,
    );
    // Intentionally no event: a command response must also reconcile the UI.
    return nativeSnapshot;
  });
  mockIPC(async (command, args) => {
    const payload = args as Record<string, unknown> | undefined;
    switch (command) {
      case 'plugin:native-tts|register_listener': {
        expect(payload?.['event']).toBe('audiobook-playback-state');
        await register();
        const channel = payload?.['handler'] as Channel<AudiobookPlaybackSnapshot>;
        expect(channel).toBeInstanceOf(Channel);
        channels.set(channel.id, channel);
        return;
      }
      case 'plugin:native-tts|remove_listener':
        channels.delete(payload?.['channelId'] as number);
        unregistered();
        return;
      case 'plugin:native-tts|get_audiobook_playback_snapshot':
        return getSnapshot();
      case 'plugin:native-tts|control_audiobook_playback':
        return control(payload?.['payload'] as AudiobookCommand);
      default:
        throw new Error(`Unexpected IPC: ${command}`);
    }
  });
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  clearMocks();
  vi.restoreAllMocks();
});

describe('native audiobook phone/car synchronization through the real Tauri client', () => {
  it.each([
    'playing',
    'loading',
  ] as const)('changes the visible Pause button to Play from the phone command response while %s', async (state) => {
    nativeSnapshot = snapshot(1, state);
    const Player = () => {
      const player = useAudiobookControl(BOOK_KEY);
      return (
        <AudiobookMiniBar
          state={player.state}
          title={player.title}
          elapsed={player.elapsed}
          total={player.total}
          rate={player.rate}
          skipForwardSec={player.skipForwardSec}
          bottomInset={0}
          followSuspended={player.followSuspended}
          footerVisible={false}
          onTogglePlay={player.togglePlay}
          onSkipForward={player.skipForward}
          onCycleRate={() => {}}
          onReturnToPlaying={player.returnToPlaying}
          onExpand={() => {}}
          onDismiss={() => {}}
        />
      );
    };
    render(<Player />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await screen.findByRole('button', { name: 'Play' });
    expect(control).toHaveBeenCalledWith({ action: 'pause' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(control.mock.calls.at(-1)?.[0].action).toBe('play');
    expect(engine.start).not.toHaveBeenCalled();
    expect(engine.resume).not.toHaveBeenCalled();
  });

  it('adopts a pause made in Android Auto from a direct plugin event', async () => {
    const { result } = await mountReader();
    await act(async () => emit(snapshot(2, 'paused')));
    expect(result.current.state).toBe('paused');
  });

  it('follows live native cues into the next chapter without starting browser audio', async () => {
    const { result } = await mountReader();
    engine.synchronizeAtOffset.mockClear();
    await act(async () => emit(snapshot(2, 'playing', 1)));
    await waitFor(() => expect(view.goTo).toHaveBeenLastCalledWith('chapter-2.xhtml#sentence-1'));
    expect(engine.synchronizeAtOffset).toHaveBeenCalledWith(1, 5);
    expect(result.current.chapterElapsed).toBe(5);
    expect(result.current.sectionIndex).toBe(1);
    expect(engine.start).not.toHaveBeenCalled();
  });

  it.each([
    'visibility',
    'focus',
  ] as const)('refreshes missed car state on foreground %s', async (event) => {
    const { result } = await mountReader();
    act(() => visibility('hidden'));
    nativeSnapshot = snapshot(2, 'paused', 1);
    act(() => {
      if (event === 'visibility') visibility('visible');
      else {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        });
        window.dispatchEvent(new Event('focus'));
      }
    });
    await waitFor(() => expect(result.current.state).toBe('paused'));
    await waitFor(() => expect(view.goTo).toHaveBeenLastCalledWith('chapter-2.xhtml#sentence-1'));
  });

  it('waits until native event registration completes before fetching the initial snapshot', async () => {
    const pending = deferred<void>();
    register.mockReturnValue(pending.promise);
    renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      await Promise.resolve();
    });
    expect(getSnapshot).not.toHaveBeenCalled();
    nativeSnapshot = snapshot(2, 'paused');
    await act(async () => pending.resolve());
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledOnce());
  });

  it('does not recreate native listeners on position updates or React renders', async () => {
    const { rerender } = await mountReader();
    await act(async () => emit(snapshot(2, 'playing', 1)));
    rerender();
    await act(async () => {
      await Promise.resolve();
    });
    expect(register).toHaveBeenCalledOnce();
    expect(channels.size).toBe(1);
  });

  it('repaints the current sentence on foreground even when its snapshot sequence is unchanged', async () => {
    await mountReader();
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalled());
    engine.synchronizeAtOffset.mockClear();
    act(() => visibility('hidden'));
    act(() => visibility('visible'));
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledWith(0, 5));
  });

  it('does not navigate or synchronize a hidden reader; catches up when visible', async () => {
    await mountReader();
    act(() => visibility('hidden'));
    engine.synchronizeAtOffset.mockClear();
    view.goTo.mockClear();
    await act(async () => emit(snapshot(2, 'playing', 1)));
    expect(engine.synchronizeAtOffset).not.toHaveBeenCalled();
    expect(view.goTo).not.toHaveBeenCalled();
    act(() => visibility('visible'));
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledWith(1, 5));
  });

  it('restores highlighting after reopening the tray within the same sentence', async () => {
    const { rerender } = await mountReader();
    act(() => useAudiobookStore.getState().setTrayCollapsed(BOOK_KEY, true));
    await act(async () => emit(snapshot(2, 'playing', 1)));
    engine.synchronizeAtOffset.mockClear();
    act(() => useAudiobookStore.getState().setTrayCollapsed(BOOK_KEY, false));
    rerender();
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledWith(1, 5));
  });

  it('repaints the current sentence when read-along is re-enabled without new audio events', async () => {
    viewSettings.moReadAlongEnabled = false;
    const { rerender } = await mountReader();
    engine.synchronizeAtOffset.mockClear();
    viewSettings.moReadAlongEnabled = true;
    rerender();
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledWith(0, 5));
  });
});

describe('native playback ordering, failures and teardown', () => {
  it('ignores a delayed initial snapshot after a newer live update', async () => {
    const pending = deferred<AudiobookPlaybackSnapshot>();
    getSnapshot.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await waitFor(() => expect(channels.size).toBe(1));
    await act(async () => emit(snapshot(10, 'paused', 1)));
    await act(async () => pending.resolve(snapshot(2)));
    expect(result.current.state).toBe('paused');
    expect(result.current.sectionIndex).toBe(1);
  });

  it('ignores an old command response after a newer car command', async () => {
    const { result } = await mountReader();
    const pending = deferred<AudiobookPlaybackSnapshot>();
    control.mockReturnValueOnce(pending.promise);
    act(() => result.current.togglePlay());
    await act(async () => emit(snapshot(10, 'playing', 1)));
    await act(async () => pending.resolve(snapshot(2, 'paused')));
    expect(result.current.state).toBe('playing');
    expect(result.current.sectionIndex).toBe(1);
  });

  it('accepts a restarted native service and rejects its retired session', async () => {
    const { result } = await mountReader();
    await act(async () => emit(snapshot(1, 'paused', 1, { sessionId: 'restarted' })));
    await act(async () => emit(snapshot(99)));
    expect(result.current.state).toBe('paused');
    expect(result.current.sectionIndex).toBe(1);
  });

  it('stops displaying this book as playing when Android Auto switches to another book', async () => {
    const { result } = await mountReader();
    view.goTo.mockClear();
    await act(async () => emit(snapshot(2, 'playing', 1, { bookId: 'another-book' })));
    expect(result.current.state).toBe('stopped');
    expect(view.goTo).not.toHaveBeenCalled();
  });

  it('keeps the last confirmed playing state when pause fails and permits retry', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await mountReader();
    control.mockRejectedValueOnce(new Error('service disconnected'));
    await act(async () => result.current.togglePlay());
    expect(result.current.state).toBe('playing');
    expect(warning).toHaveBeenCalled();
    await act(async () => result.current.togglePlay());
    expect(result.current.state).toBe('paused');
  });

  it('exits loading when a phone Play command fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    nativeSnapshot = snapshot(1, 'stopped');
    const { result } = await mountReader();
    control.mockRejectedValueOnce(new Error('service unavailable'));
    await act(async () => result.current.togglePlay());
    await waitFor(() => expect(result.current.state).toBe('error'));
  });

  it('recovers on another foreground event after a snapshot query failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await mountReader();
    getSnapshot.mockRejectedValueOnce(new Error('temporarily unavailable'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(result.current.state).toBe('playing');
    nativeSnapshot = snapshot(2, 'paused', 1);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(result.current.state).toBe('paused');
  });

  it('retries a failed listener registration when the phone returns to the foreground', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    register.mockRejectedValueOnce(new Error('bridge unavailable'));
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await act(async () => {
      await Promise.resolve();
    });
    nativeSnapshot = snapshot(2, 'paused');
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(channels.size).toBe(1));
    expect(result.current.state).toBe('paused');
  });

  it('unregisters an attachment that completes after unmount', async () => {
    const pending = deferred<void>();
    register.mockReturnValueOnce(pending.promise);
    const { unmount } = renderHook(() => useAudiobookControl(BOOK_KEY));
    unmount();
    await act(async () => pending.resolve());
    await waitFor(() => expect(channels.size).toBe(0));
    expect(unregistered).toHaveBeenCalledOnce();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('removes listeners and ignores delayed command responses after unmount', async () => {
    const { result, unmount } = await mountReader();
    const pending = deferred<AudiobookPlaybackSnapshot>();
    control.mockReturnValueOnce(pending.promise);
    act(() => result.current.togglePlay());
    unmount();
    view.goTo.mockClear();
    bookDataStore.setConfig.mockClear();
    await act(async () => pending.resolve(snapshot(2, 'paused', 1)));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(channels.size).toBe(0);
    expect(view.goTo).not.toHaveBeenCalled();
    expect(bookDataStore.setConfig).not.toHaveBeenCalled();
    expect(getSnapshot).toHaveBeenCalledOnce();
  });

  it('serializes slow chapter synchronization and finishes at the newest cue', async () => {
    const pending = deferred<boolean>();
    engine.synchronizeAtOffset.mockReturnValueOnce(pending.promise);
    await mountReader();
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledOnce());
    await act(async () => emit(snapshot(2, 'playing', 1)));
    expect(engine.synchronizeAtOffset).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(true));
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenLastCalledWith(1, 5));
    expect(view.goTo).toHaveBeenCalledTimes(1);
    expect(view.goTo).toHaveBeenLastCalledWith('chapter-2.xhtml#sentence-1');
  });

  it('does not starve read-along when multiple snapshots arrive during a slow cue load', async () => {
    const pending = deferred<boolean>();
    engine.synchronizeAtOffset.mockReturnValueOnce(pending.promise);
    await mountReader();
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledOnce());
    await act(async () => {
      emit(snapshot(2));
      emit(snapshot(3));
      emit(snapshot(4));
    });
    await act(async () => pending.resolve(true));
    await waitFor(() => expect(view.goTo).toHaveBeenCalledWith('chapter.xhtml#sentence-2'));
    expect(engine.synchronizeAtOffset).toHaveBeenCalledOnce();
  });

  it('keeps state updates working after a read-along failure and retries the next cue', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    engine.synchronizeAtOffset.mockRejectedValueOnce(new Error('chapter loading failed'));
    const { result } = await mountReader();
    await act(async () => emit(snapshot(2, 'paused', 1)));
    await waitFor(() => expect(view.goTo).toHaveBeenCalledWith('chapter-2.xhtml#sentence-1'));
    expect(result.current.state).toBe('paused');
  });

  it('does not navigate after an in-flight highlight finishes following unmount', async () => {
    const pending = deferred<boolean>();
    engine.synchronizeAtOffset.mockReturnValueOnce(pending.promise);
    const { unmount } = await mountReader();
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledOnce());
    unmount();
    await act(async () => pending.resolve(true));
    expect(view.goTo).not.toHaveBeenCalled();
  });

  it('adopts seek and rate command replies even when their live events are missed', async () => {
    const { result } = await mountReader();
    control.mockResolvedValueOnce(snapshot(2, 'playing', 1));
    await act(async () => result.current.skipForward());
    expect(result.current.sectionIndex).toBe(1);
    control.mockResolvedValueOnce(snapshot(3, 'playing', 1, { playbackRate: 1.5 }));
    await act(async () => result.current.setRate(1.5));
    expect(result.current.rate).toBe(1.5);
  });

  it('preserves deliberate browsing when foreground refresh restores highlighting', async () => {
    const { result } = await mountReader();
    act(() =>
      view.dispatchEvent(new CustomEvent('relocate', { detail: { section: { current: 1 } } })),
    );
    expect(result.current.followSuspended).toBe(true);
    view.goTo.mockClear();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(view.goTo).not.toHaveBeenCalled();
    act(() => result.current.returnToPlaying());
    await waitFor(() => expect(view.goTo).toHaveBeenCalledWith('chapter.xhtml#sentence-2'));
  });
});

describe('native Play preparation and automatic page navigation', () => {
  it('does not start audio if the reader unmounts while waiting for TTS teardown', async () => {
    nativeSnapshot = snapshot(1, 'paused');
    const pending = deferred<void>();
    const onStop = () => pending.promise;
    eventDispatcher.on('tts-stop', onStop);
    try {
      const { result, unmount } = await mountReader();
      act(() => result.current.togglePlay());
      unmount();
      await act(async () => pending.resolve());
      expect(control).not.toHaveBeenCalled();
    } finally {
      eventDispatcher.off('tts-stop', onStop);
    }
  });

  it('does not replace newer confirmed car playback with an older Play failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    nativeSnapshot = snapshot(1, 'paused');
    const { result } = await mountReader();
    const pending = deferred<AudiobookPlaybackSnapshot>();
    control.mockReturnValueOnce(pending.promise);
    await act(async () => result.current.togglePlay());
    await act(async () => emit(snapshot(3, 'playing', 1)));
    await act(async () => pending.reject(new Error('old command failed')));
    expect(result.current.state).toBe('playing');
    expect(result.current.sectionIndex).toBe(1);
  });

  it('does not mistake automatic native chapter navigation for deliberate browsing', async () => {
    const { result } = await mountReader();
    engine.synchronizeAtOffset.mockImplementation(async (sectionIndex: number) => {
      view.dispatchEvent(
        new CustomEvent('relocate', { detail: { section: { current: sectionIndex } } }),
      );
      return true;
    });
    await act(async () => emit(snapshot(2, 'playing', 1)));
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledWith(1, 5));
    expect(result.current.followSuspended).toBe(false);
  });
});

describe('cancelling a pending native Play', () => {
  it('does not restart audio when Pause arrives while Play is still restoring the saved location', async () => {
    nativeSnapshot = snapshot(1, 'paused');
    const { getPlaybackLocationFromCar } = await import('@/services/audiobook/carBridge');
    const pending = deferred<import('@/types/book').MediaOverlayLocation | undefined>();
    vi.mocked(getPlaybackLocationFromCar).mockReturnValueOnce(pending.promise);
    const { result } = await mountReader();
    await act(async () => result.current.togglePlay());
    await waitFor(() => expect(getPlaybackLocationFromCar).toHaveBeenCalled());
    await act(async () => result.current.togglePlay());
    expect(result.current.state).toBe('paused');
    await act(async () => pending.resolve({ ...snapshot(1).location!, updatedAt: 1_500 }));
    expect(control.mock.calls.map(([command]) => command.action)).toEqual(['pause']);
    expect(result.current.state).toBe('paused');
    expect(config.mediaOverlayLocation?.updatedAt).toBe(2_000);
  });
});

describe('native service restarts during IPC', () => {
  it('does not adopt an unseen old session from a query completed after a new service event', async () => {
    const pending = deferred<AudiobookPlaybackSnapshot>();
    getSnapshot.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useAudiobookControl(BOOK_KEY));
    await waitFor(() => expect(channels.size).toBe(1));
    await act(async () => emit(snapshot(1, 'paused', 1, { sessionId: 'new-service' })));
    await act(async () => pending.resolve(snapshot(100, 'playing')));
    expect(result.current.state).toBe('paused');
    expect(result.current.sectionIndex).toBe(1);
  });

  it('ignores an unseen old command session after a newer service has taken ownership', async () => {
    const { result } = await mountReader();
    const pending = deferred<AudiobookPlaybackSnapshot>();
    control.mockReturnValueOnce(pending.promise);
    act(() => result.current.togglePlay());
    await act(async () => emit(snapshot(1, 'playing', 1, { sessionId: 'new-service' })));
    await act(async () =>
      pending.resolve(snapshot(99, 'paused', 0, { sessionId: 'intermediate-service' })),
    );
    expect(result.current.state).toBe('playing');
    expect(result.current.sectionIndex).toBe(1);
  });
});

vi.mock('@/app/reader/components/audiobook/AudiobookPlayer', () => ({
  default: () => null,
  SPEED_PRESETS: [1, 1.5, 2],
}));
import AudiobookControl from '@/app/reader/components/audiobook/AudiobookControl';

const renderPhonePlayer = () =>
  render(
    <AudiobookControl
      bookKey={BOOK_KEY}
      gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      onGoToLibrary={() => {}}
    />,
  );

describe('closing the actual phone mini-player', () => {
  it.each([
    'playing',
    'loading',
    'paused',
  ] as const)('pauses shared %s playback, clears highlighting and preserves the resume location', async (state) => {
    nativeSnapshot = snapshot(1, state);
    const events = vi.spyOn(engine, 'dispatchEvent');
    renderPhonePlayer();
    await waitFor(() => expect(getSnapshot).toHaveBeenCalled());
    await waitFor(() => expect(useAudiobookStore.getState().playbackStates[BOOK_KEY]).toBe(state));
    fireEvent.click(screen.getByRole('button', { name: 'Close Player and Pause Audio' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Audiobook Mini Player' })).toBeNull(),
    );
    expect(control).toHaveBeenCalledWith({ action: 'pause' });
    expect(nativeSnapshot.state).toBe('paused');
    expect(config.mediaOverlayLocation?.locator.locations.fragments).toEqual(['t=5']);
    expect(bookDataStore.saveConfig).toHaveBeenCalled();
    expect(events.mock.calls.some(([event]) => event.type === 'unhighlight')).toBe(true);
    expect(view.mediaOverlayHighlightEnabled).toBe(false);
    expect(view.mediaOverlayFollowEnabled).toBe(false);

    const commandCount = control.mock.calls.length;
    act(() => useAudiobookStore.getState().setTrayCollapsed(BOOK_KEY, false));
    await screen.findByRole('button', { name: 'Play' });
    expect(control).toHaveBeenCalledTimes(commandCount);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() =>
      expect(control.mock.calls.at(-1)?.[0]).toMatchObject({
        action: 'play',
        location: { locator: { locations: { fragments: ['t=5'] } } },
      }),
    );
  });

  it('keeps controls visible when a newer car Play supersedes the close request', async () => {
    renderPhonePlayer();
    await screen.findByRole('button', { name: 'Pause' });
    const pending = deferred<AudiobookPlaybackSnapshot>();
    control.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Close Player and Pause Audio' }));
    await act(async () => emit(snapshot(3, 'playing')));
    await act(async () => pending.resolve(snapshot(2, 'paused')));
    expect(screen.getByRole('region', { name: 'Audiobook Mini Player' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('prevents an in-flight sentence update from following after closing', async () => {
    const pending = deferred<boolean>();
    engine.synchronizeAtOffset.mockReturnValueOnce(pending.promise);
    renderPhonePlayer();
    await screen.findByRole('button', { name: 'Pause' });
    await waitFor(() => expect(engine.synchronizeAtOffset).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Close Player and Pause Audio' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Audiobook Mini Player' })).toBeNull(),
    );
    view.goTo.mockClear();
    await act(async () => pending.resolve(true));
    expect(view.goTo).not.toHaveBeenCalled();
    expect(view.mediaOverlayHighlightEnabled).toBe(false);
  });

  it('keeps the player visible if the native pause fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderPhonePlayer();
    await screen.findByRole('button', { name: 'Pause' });
    control.mockRejectedValueOnce(new Error('service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Close Player and Pause Audio' }));
    await waitFor(() => expect(control).toHaveBeenCalled());
    expect(screen.getByRole('region', { name: 'Audiobook Mini Player' })).toBeTruthy();
    expect(nativeSnapshot.state).toBe('playing');
  });
});
