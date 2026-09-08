import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import type { Book } from '@/types/book';
import { getOSPlatform } from '@/utils/misc';
import type { AudiobookChapter } from '@/app/reader/hooks/useAudiobookControl';
import type { AppService } from '@/types/system';
import type { MediaOverlayEngine } from '@/types/mediaOverlay';
import { getCoverFilename } from '@/utils/book';
import {
  prepareCarPlaybackManifest,
  type CarPlaybackManifest,
} from '@/services/audiobook/carPlaybackManifest';

/**
 * Car bridge protocol (CarPlay / Android Auto). The web layer PUSHES the
 * browsable data down to native — the head unit then serves its lists from
 * a native cache instantly and offline — and native sends back only action
 * events (`audiobook-play`). Playback state itself already flows through
 * the Phase 7 media session.
 *
 * The payload shapes here are the TS half of the plugin contract; the Rust
 * models (tauri-plugin-native-tts/src/models.rs) deserialize exactly these
 * JSON shapes and are covered by serde tests on their side.
 */
export interface BridgeAudiobook {
  id: string;
  title: string;
  author: string;
  durationSec: number;
}

export interface BridgeChapter {
  index: number;
  label: string;
}

export interface BridgeChaptersPayload {
  bookId: string;
  chapters: BridgeChapter[];
  currentIndex?: number;
}

export interface CarPlayIntent {
  bookId: string;
  chapterIndex?: number;
}

/** Audiobooks in most-recently-used order — what a driver wants on top. */
export const buildBridgeLibrary = (books: Book[]): BridgeAudiobook[] =>
  books
    .filter((book) => book.hasAudio && !book.deletedAt)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .map((book) => ({
      id: book.hash,
      title: book.title,
      author: book.author,
      durationSec: book.audioDuration ?? 0,
    }));

export const buildBridgeChapters = (
  bookId: string,
  chapters: AudiobookChapter[],
  currentSectionIndex: number,
): BridgeChaptersPayload => ({
  bookId,
  chapters: chapters.map((chapter) => ({ index: chapter.sectionIndex, label: chapter.label })),
  ...(currentSectionIndex >= 0 ? { currentIndex: currentSectionIndex } : {}),
});

const carBridgeAvailable = () =>
  isTauriAppPlatform() && ['ios', 'android'].includes(getOSPlatform());

export const pushLibraryToCar = async (books: Book[]): Promise<void> => {
  if (!carBridgeAvailable()) return;
  try {
    await invoke('plugin:native-tts|update_audiobook_library', {
      payload: { books: buildBridgeLibrary(books) },
    });
  } catch (error) {
    console.warn('car bridge library push failed', error);
  }
};

export const pushChaptersToCar = async (payload: BridgeChaptersPayload): Promise<void> => {
  if (!carBridgeAvailable()) return;
  try {
    await invoke('plugin:native-tts|update_audiobook_chapters', { payload });
  } catch (error) {
    console.warn('car bridge chapters push failed', error);
  }
};

export const pushPlaybackManifestToCar = async (manifest: CarPlaybackManifest): Promise<void> => {
  if (!carBridgeAvailable()) return;
  await invoke('plugin:native-tts|update_audiobook_playback_manifest', { payload: manifest });
};

export const prepareAndPushCarPlayback = async (
  appService: AppService,
  book: Book,
  engine: MediaOverlayEngine,
  chapters: BridgeChapter[],
  currentSectionIndex: number,
): Promise<void> => {
  if (!carBridgeAvailable()) return;
  try {
    const coverFilename = getCoverFilename(book);
    const coverPath = (await appService.exists(coverFilename, 'Books'))
      ? await appService.resolveFilePath(coverFilename, 'Books')
      : undefined;
    const manifest = await prepareCarPlaybackManifest(
      appService,
      book,
      engine,
      chapters,
      currentSectionIndex,
      coverPath,
    );
    await pushPlaybackManifestToCar(manifest);
  } catch (error) {
    console.warn('car bridge playback preparation failed', error);
  }
};

/** Subscribe to play requests coming from the head unit. */
export const listenCarPlayIntents = async (
  onPlay: (intent: CarPlayIntent) => void,
): Promise<PluginListener | null> => {
  if (!carBridgeAvailable()) return null;
  return addPluginListener(
    'native-tts',
    'audiobook-play',
    (event: { payload?: CarPlayIntent } & CarPlayIntent) => {
      const intent = event.payload ?? event;
      if (intent?.bookId) onPlay({ bookId: intent.bookId, chapterIndex: intent.chapterIndex });
    },
  );
};

// A play intent can arrive before the reader (and its playback hook) exists;
// park it here and let the hook consume it once the target book is open.
let pendingIntent: CarPlayIntent | null = null;

export const setPendingCarPlayIntent = (intent: CarPlayIntent): void => {
  pendingIntent = intent;
};

export const consumePendingCarPlayIntent = (bookId: string): CarPlayIntent | null => {
  if (pendingIntent?.bookId !== bookId) return null;
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
};
