import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBridgeChapters,
  buildBridgeLibrary,
  getPlaybackLocationFromCar,
  pushPlaybackLocationToCar,
  takePendingBookmarksFromCar,
} from '@/services/audiobook/carBridge';
import type { Book, MediaOverlayLocation } from '@/types/book';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  addPluginListener: vi.fn(),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/misc', () => ({
  getOSPlatform: () => 'android',
  stubTranslation: (value: string) => value,
}));

const book = (over: Partial<Book>): Book =>
  ({
    hash: 'h',
    format: 'EPUB',
    title: 'T',
    author: 'A',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as Book;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildBridgeLibrary', () => {
  it('exposes only audiobooks, most recently used first', () => {
    const books = [
      book({ hash: 'text', title: 'Text Book', updatedAt: 900 }),
      book({ hash: 'old', title: 'Old Audio', hasAudio: true, audioDuration: 60, updatedAt: 100 }),
      book({ hash: 'new', title: 'New Audio', hasAudio: true, audioDuration: 30, updatedAt: 500 }),
      book({ hash: 'gone', title: 'Deleted', hasAudio: true, deletedAt: 50, updatedAt: 999 }),
    ];
    const bridge = buildBridgeLibrary(books);
    expect(bridge.map((b) => b.id)).toEqual(['new', 'old']);
    expect(bridge[0]).toEqual({ id: 'new', title: 'New Audio', author: 'A', durationSec: 30 });
  });

  it('defaults unknown durations to zero', () => {
    const bridge = buildBridgeLibrary([book({ hash: 'x', hasAudio: true })]);
    expect(bridge[0]?.durationSec).toBe(0);
  });

  it('is empty for a library without audiobooks', () => {
    expect(buildBridgeLibrary([book({ hash: 'a' })])).toEqual([]);
  });
});

describe('buildBridgeChapters', () => {
  it('maps chapter labels with their spine indexes and flags the playing one', () => {
    const payload = buildBridgeChapters(
      'book1',
      [
        { label: 'Chapter 1', sectionIndex: 0 },
        { label: 'Chapter 2', sectionIndex: 1 },
      ],
      1,
    );
    expect(payload).toEqual({
      bookId: 'book1',
      currentIndex: 1,
      chapters: [
        { index: 0, label: 'Chapter 1' },
        { index: 1, label: 'Chapter 2' },
      ],
    });
  });

  it('omits currentIndex when nothing is playing', () => {
    const payload = buildBridgeChapters('book1', [], -1);
    expect(payload.currentIndex).toBeUndefined();
    expect(payload.chapters).toEqual([]);
  });
});

describe('car playback location bridge failures', () => {
  const location: MediaOverlayLocation = {
    schemaVersion: 2,
    editionId: 'book1',
    locator: {
      href: 'audio/chapter.mp3',
      type: 'audio/mpeg',
      locations: { fragments: ['t=12'] },
    },
    updatedAt: 1000,
  };

  it('contains a rejected native location write', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('native unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(pushPlaybackLocationToCar(location)).resolves.toBeUndefined();
  });

  it('treats a rejected native location read as no cached location', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('native unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(getPlaybackLocationFromCar('book1')).resolves.toBeUndefined();
  });

  it('takes queued native bookmarks using the shared Readium locator shape', async () => {
    mocks.invoke.mockResolvedValueOnce({ locations: [location] });

    await expect(takePendingBookmarksFromCar('book1')).resolves.toEqual([location]);
    expect(mocks.invoke).toHaveBeenCalledWith(
      'plugin:native-tts|take_audiobook_pending_bookmarks',
      { payload: { bookId: 'book1' } },
    );
  });
});
