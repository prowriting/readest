import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => mocks);
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => 'android' }));

import {
  createAudiobookPlaybackBackend,
  createWebAudiobookPlaybackBackend,
  isNewerPlaybackSnapshot,
  type AudiobookPlaybackSnapshot,
} from '@/services/audiobook/playbackBackend';
import type { MediaOverlayEngine, MediaOverlayPlaybackManifest } from '@/types/mediaOverlay';

const createEngine = () => {
  const manifest: MediaOverlayPlaybackManifest = {
    sections: [
      {
        sectionIndex: 0,
        duration: 60,
        segments: [
          {
            source: 'audio/chapter.mp3',
            type: 'audio/mpeg',
            clipBegin: 0,
            clipEnd: 60,
            sourceDuration: 60,
            cues: [
              { offset: 0, text: 'text/chapter.xhtml#p1' },
              { offset: 10, text: 'text/chapter.xhtml#p2' },
            ],
          },
        ],
      },
      {
        sectionIndex: 1,
        duration: 30,
        segments: [
          {
            source: 'audio/chapter-2.mp3',
            type: 'audio/mpeg',
            clipBegin: 0,
            clipEnd: 30,
            sourceDuration: 30,
            cues: [{ offset: 0, text: 'text/chapter-2.xhtml#p1' }],
          },
        ],
      },
    ],
  };
  return Object.assign(new EventTarget(), {
    activeSectionIndex: -1,
    sectionOffset: 0,
    sectionDuration: 60,
    activeAudioSource: null,
    audioTime: 0,
    audioDuration: 60,
    start: vi.fn(async function (this: MediaOverlayEngine, sectionIndex: number) {
      Object.assign(this, { activeSectionIndex: sectionIndex, sectionOffset: 0 });
    }),
    startAtOffset: vi.fn(async function (
      this: MediaOverlayEngine,
      sectionIndex: number,
      offset: number,
    ) {
      Object.assign(this, { activeSectionIndex: sectionIndex, sectionOffset: offset });
    }),
    synchronizeAtOffset: vi.fn(async () => true),
    seekRelative: vi.fn(async function (this: MediaOverlayEngine, seconds: number) {
      Object.assign(this, { sectionOffset: this.sectionOffset + seconds });
    }),
    playFromText: vi.fn(async () => false),
    textOffset: vi.fn(async () => null),
    exportPlaybackManifest: vi.fn(async () => manifest),
    loadAudioSource: vi.fn(async () => new Blob()),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    prev: vi.fn(),
    next: vi.fn(),
    setVolume: vi.fn(),
    setRate: vi.fn(),
  }) as MediaOverlayEngine & {
    activeSectionIndex: number;
    sectionOffset: number;
    resume: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
};

describe('native audiobook playback backend', () => {
  it('rejects duplicate and out-of-order snapshots within a native session', () => {
    expect(isNewerPlaybackSnapshot(null, { sessionId: 'a', sequence: 3 })).toBe(true);
    expect(
      isNewerPlaybackSnapshot({ sessionId: 'a', sequence: 3 }, { sessionId: 'a', sequence: 3 }),
    ).toBe(false);
    expect(
      isNewerPlaybackSnapshot({ sessionId: 'a', sequence: 3 }, { sessionId: 'a', sequence: 2 }),
    ).toBe(false);
    expect(
      isNewerPlaybackSnapshot({ sessionId: 'a', sequence: 3 }, { sessionId: 'b', sequence: 1 }),
    ).toBe(true);
    expect(
      isNewerPlaybackSnapshot(
        { sessionId: 'b', sequence: 1 },
        { sessionId: 'a', sequence: 4 },
        new Set(['a']),
      ),
    ).toBe(false);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({
      sessionId: 'native-1',
      sequence: 4,
      bookId: 'edition-a',
      state: 'paused',
      chapterIndex: 2,
      chapterPositionMs: 12_000,
      chapterDurationMs: 60_000,
      playbackRate: 1.25,
      isBookmarked: false,
    });
    mocks.addPluginListener.mockResolvedValue({ unregister: vi.fn() });
  });

  it('uses the native backend on a Tauri mobile platform', () => {
    expect(createAudiobookPlaybackBackend()).toMatchObject({ kind: 'native' });
  });

  it('sends typed commands to the native player and returns its authoritative snapshot', async () => {
    const backend = createAudiobookPlaybackBackend();
    const snapshot = await backend.control({
      action: 'seekRelative',
      offsetMs: 30_000,
    });

    expect(mocks.invoke).toHaveBeenCalledWith('plugin:native-tts|control_audiobook_playback', {
      payload: { action: 'seekRelative', offsetMs: 30_000 },
    });
    expect(snapshot).toMatchObject({ sequence: 4, chapterPositionMs: 12_000 });
  });

  it('subscribes to the direct native plugin snapshot payload', async () => {
    let nativeHandler: ((snapshot: AudiobookPlaybackSnapshot) => void) | undefined;
    mocks.addPluginListener.mockImplementation(
      async (_plugin: string, event: string, handler: typeof nativeHandler) => {
        expect(event).toBe('audiobook-playback-state');
        nativeHandler = handler;
        return { unregister: vi.fn() };
      },
    );
    const listener = vi.fn();
    await createAudiobookPlaybackBackend().subscribe(listener);

    const snapshot = (await mocks.invoke()) as AudiobookPlaybackSnapshot;
    nativeHandler?.(snapshot);
    expect(listener).toHaveBeenCalledWith(snapshot);
  });

  it('queries the current native snapshot when the reader attaches', async () => {
    const snapshot = await createAudiobookPlaybackBackend().getSnapshot();
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:native-tts|get_audiobook_playback_snapshot');
    expect(snapshot).toMatchObject({ bookId: 'edition-a', state: 'paused' });
  });
});

describe('web audiobook playback backend', () => {
  it('adopts an external player pause and resumes instead of restarting', async () => {
    const engine = createEngine();
    const backend = createWebAudiobookPlaybackBackend({ bookId: 'edition-a', engine });
    const listener = vi.fn();
    await backend.subscribe(listener);

    await backend.control({ action: 'play', bookId: 'edition-a' });
    engine.dispatchEvent(new CustomEvent('pause'));
    await vi.waitFor(async () => expect((await backend.getSnapshot())?.state).toBe('paused'));
    await backend.control({ action: 'play', bookId: 'edition-a' });

    expect(engine.resume).toHaveBeenCalledOnce();
    expect(engine.start).toHaveBeenCalledOnce();
  });

  it('navigates chapters using the manifest rather than nonexistent engine methods', async () => {
    const engine = createEngine();
    const backend = createWebAudiobookPlaybackBackend({ bookId: 'edition-a', engine });
    await backend.control({ action: 'play', bookId: 'edition-a' });
    engine.start.mockClear();

    await backend.control({ action: 'nextChapter' });
    await backend.control({ action: 'previousChapter' });

    expect(engine.start).toHaveBeenNthCalledWith(1, 1);
    expect(engine.start).toHaveBeenNthCalledWith(2, 0);
  });

  it('marks only the exact SMIL cue that was bookmarked', async () => {
    const engine = createEngine();
    const backend = createWebAudiobookPlaybackBackend({ bookId: 'edition-a', engine });
    await backend.subscribe(() => {});
    await backend.control({ action: 'play', bookId: 'edition-a' });
    expect((await backend.control({ action: 'addBookmark' }))?.isBookmarked).toBe(true);

    engine.sectionOffset = 11;
    engine.dispatchEvent(
      new CustomEvent('highlight', { detail: { text: 'text/chapter.xhtml#p2' } }),
    );

    await vi.waitFor(async () => expect((await backend.getSnapshot())?.isBookmarked).toBe(false));
  });
});
