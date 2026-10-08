import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useAudiobookStore } from '@/store/audiobookStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { buildBookTimeline } from '@/services/audiobook/bookTimeline';
import { DEFAULT_MEDIA_OVERLAY_CONFIG } from '@/services/constants';
import {
  CLEARED_TIMER,
  extendTimer,
  fadeVolume,
  isExpired,
  remainingSeconds,
  startTimer,
  type SleepTimerMode,
  type SleepTimerState,
} from '@/services/audiobook/sleepTimer';
import type { TTSHighlightOptions } from '@/services/tts';
import { findTapFragment, fragmentFromCfi } from '@/utils/audiobook';
import { getMediaSession, TauriMediaSession } from '@/libs/mediaSession';
import {
  buildBridgeChapters,
  consumePendingCarPlayIntent,
  getPlaybackLocationFromCar,
  listenCarControlIntents,
  prepareAndPushCarPlayback,
  pushChaptersToCar,
  pushPlaybackLocationToCar,
  takePendingBookmarksFromCar,
  type CarPlayIntent,
} from '@/services/audiobook/carBridge';
import {
  createMediaOverlayLocation,
  parseMediaOverlayLocation,
  resolveMediaOverlayLocation,
} from '@/services/audiobook/mediaOverlayLocation';
import { fetchImageAsBase64 } from '@/utils/image';
import { uniqueId } from '@/utils/misc';
import { getStyles } from '@/utils/style';
import {
  isActive,
  transition,
  type AudiobookPlaybackEvent,
  type AudiobookPlaybackState,
} from '@/services/audiobook/playbackMachine';
import type { BookNote, MediaOverlayConfig, MediaOverlayLocation } from '@/types/book';
import type { MediaOverlayPlaybackManifest } from '@/types/mediaOverlay';
import {
  createAudiobookPlaybackBackend,
  isNewerPlaybackSnapshot,
  type AudiobookPlaybackSnapshot,
  type AudiobookCommand,
} from '@/services/audiobook/playbackBackend';
import type { TOCItem } from '@/libs/document';
import { eventDispatcher } from '@/utils/event';

const POSITION_POLL_MS = 500;
const POSITION_SAVE_MS = 10_000;
/** Below this offset, "previous chapter" jumps back; above it, it restarts. */

interface PendingExternalLocation {
  sectionIndex: number;
  sectionOffset: number;
  updatedAt: number;
}

export interface AudiobookChapter {
  label: string;
  sectionIndex: number;
}

export interface AudiobookBookmark {
  id: string;
  sectionIndex: number;
  fragment: string | null;
  /** Whole-book time of the bookmarked clip, when resolvable. */
  bookTime: number | null;
  snippet: string;
}

/**
 * Owns the audiobook playback lifecycle for one reader instance: drives the
 * foliate-js MediaOverlay engine, mirrors it into the pure playback state
 * machine, persists/restores the listening position, and exposes transport
 * actions to the player UI.
 */
export const useAudiobookControl = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, setConfig, saveConfig, getBookData, updateBooknotes } = useBookDataStore();
  const { updateBook } = useLibraryStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();

  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const engine = view?.mediaOverlay ?? null;
  const playbackBookId = bookData?.book?.hash;
  const playbackBackend = useMemo(
    () =>
      createAudiobookPlaybackBackend(
        engine && playbackBookId ? { engine, bookId: playbackBookId } : undefined,
      ),
    [engine, playbackBookId],
  );
  const isNativePlayback = playbackBackend.kind === 'native';
  const isAvailable = Boolean(bookData?.book?.hasAudio) && Boolean(engine);
  const readAlongEnabled = viewSettings?.moReadAlongEnabled ?? true;
  const highlightOptions =
    viewSettings?.moHighlightOptions ?? DEFAULT_MEDIA_OVERLAY_CONFIG.moHighlightOptions;

  const trayCollapsed = useAudiobookStore((store) => store.trayCollapsed[bookKey] ?? false);

  const [state, setState] = useState<AudiobookPlaybackState>('stopped');
  const [sectionIndex, setSectionIndex] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [chapterElapsed, setChapterElapsed] = useState(0);
  const [nativePlaybackRate, setNativePlaybackRate] = useState<number | null>(null);
  const [followSuspended, setFollowSuspended] = useState(false);
  const [sleepTimer, setSleepTimerState] = useState<SleepTimerState>(CLEARED_TIMER);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [bookmarkEntries, setBookmarkEntries] = useState<AudiobookBookmark[]>([]);
  const sleepTimerRef = useRef(sleepTimer);
  const prevSectionRef = useRef(-1);
  // Epoch ms of the last user-driven navigation (chapter jump, seek, tap).
  // Section changes landing shortly after are manual, not a chapter rollover.
  const manualNavAtRef = useRef(0);
  const lastHighlightTextRef = useRef<string | null>(null);
  const playbackManifestRef = useRef<Promise<MediaOverlayPlaybackManifest> | null>(null);
  const initialLocationHydratedRef = useRef(false);
  const observedLocationUpdatedAtRef = useRef(0);
  const locallySavedLocationUpdatedAtRef = useRef(0);
  const pendingExternalLocationRef = useRef<PendingExternalLocation | null>(null);
  const lastNativeSnapshotRef = useRef<AudiobookPlaybackSnapshot | null>(null);
  const retiredNativeSessionIdsRef = useRef(new Set<string>());
  const lastNativeTextTargetRef = useRef<string | null>(null);
  const nativeLifetimeRef = useRef(0);
  const nativePlayRequestRef = useRef(0);
  const nativeHighlightQueueRef = useRef(Promise.resolve());
  const nativeReadAlongRef = useRef({ readAlongEnabled, followSuspended, trayCollapsed });
  nativeReadAlongRef.current = { readAlongEnabled, followSuspended, trayCollapsed };
  const lastNativePersistAtRef = useRef(0);
  const addBookmarkAtTextTargetRef = useRef<(text: string) => Promise<boolean>>(async () => false);
  const lastAdoptedNativeBookmarkRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    sleepTimerRef.current = sleepTimer;
  }, [sleepTimer]);

  const dispatch = useCallback((type: AudiobookPlaybackEvent['type']) => {
    setState((prev) => transition(prev, { type }));
  }, []);

  const timeline = useMemo(() => {
    const sections = view?.book?.sections ?? [];
    return buildBookTimeline(
      sections.map((s) => (s.mediaOverlay ? (s.mediaOverlayDuration ?? null) : 0)),
    );
  }, [view]);

  const getPlaybackManifest = useCallback(() => {
    if (!engine) return Promise.resolve<MediaOverlayPlaybackManifest>({ sections: [] });
    playbackManifestRef.current ??= engine.exportPlaybackManifest();
    return playbackManifestRef.current;
  }, [engine]);

  useEffect(() => {
    playbackManifestRef.current = null;
    initialLocationHydratedRef.current = false;
    observedLocationUpdatedAtRef.current = 0;
    locallySavedLocationUpdatedAtRef.current = 0;
    pendingExternalLocationRef.current = null;
  }, [engine]);

  useEffect(() => {
    if (isNativePlayback) engine?.stop();
  }, [engine, isNativePlayback]);

  const configuredMediaOverlayLocation = getConfig(bookKey)?.mediaOverlayLocation;

  const getLatestPlaybackLocation = useCallback(async () => {
    const book = getBookData(bookKey)?.book;
    if (!book) return undefined;
    const native = parseMediaOverlayLocation(await getPlaybackLocationFromCar(book.hash));
    // A pause/event can persist a newer position while the native read awaits.
    const configured = parseMediaOverlayLocation(getConfig(bookKey)?.mediaOverlayLocation);
    if (
      !native ||
      native.editionId !== book.hash ||
      (configured?.editionId === book.hash && configured.updatedAt >= native.updatedAt)
    ) {
      return configured?.editionId === book.hash ? configured : undefined;
    }

    // Claim the fresh native marker before updating the reactive config. This
    // prevents the external-location effect from treating the same handoff as
    // a late update and pausing the Play request that is about to consume it.
    observedLocationUpdatedAtRef.current = native.updatedAt;
    locallySavedLocationUpdatedAtRef.current = 0;
    pendingExternalLocationRef.current = null;
    setConfig(bookKey, { mediaOverlayLocation: native, updatedAt: native.updatedAt });
    const updated = getConfig(bookKey);
    if (updated) void saveConfig(envConfig, bookKey, updated, settings);
    return native;
  }, [bookKey, envConfig, getBookData, getConfig, saveConfig, setConfig, settings]);

  const chapters = useMemo<AudiobookChapter[]>(() => {
    if (!view?.book?.toc) return [];
    const seen = new Set<number>();
    const items: AudiobookChapter[] = [];
    const visit = (tocItems: TOCItem[]) => {
      for (const tocItem of tocItems) {
        if (tocItem.href) {
          const index: number = view.resolveNavigation(tocItem.href)?.index ?? -1;
          if (index >= 0 && view.book?.sections?.[index]?.mediaOverlay && !seen.has(index)) {
            seen.add(index);
            items.push({ label: tocItem.label, sectionIndex: index });
          }
        }
        if (tocItem.subitems?.length) visit(tocItem.subitems);
      }
    };
    visit(view.book.toc);
    for (let index = 0; index < (view.book.sections?.length ?? 0); index++) {
      if (view.book.sections[index]?.mediaOverlay && !seen.has(index)) {
        seen.add(index);
        items.push({ label: `Chapter ${index + 1}`, sectionIndex: index });
      }
    }
    items.sort((left, right) => left.sectionIndex - right.sectionIndex);
    return items;
  }, [view]);

  const prepareNativePlayback = useCallback(async () => {
    const book = getBookData(bookKey)?.book;
    if (!isNativePlayback || !appService || !book || !engine || chapters.length === 0) return;
    const bridgeChapters = buildBridgeChapters(book.hash, chapters, sectionIndex).chapters;
    await prepareAndPushCarPlayback(appService, book, engine, bridgeChapters);
  }, [appService, bookKey, chapters, engine, getBookData, isNativePlayback, sectionIndex]);

  const adoptNativeSnapshot = useCallback(
    async (snapshot: AudiobookPlaybackSnapshot, refreshReadAlong = false) => {
      const book = getBookData(bookKey)?.book;
      if (!book) return;
      const previous = lastNativeSnapshotRef.current;
      const sameSnapshot =
        previous?.sessionId === snapshot.sessionId && previous.sequence === snapshot.sequence;
      if (
        !isNewerPlaybackSnapshot(previous, snapshot, retiredNativeSessionIdsRef.current) &&
        !(refreshReadAlong && sameSnapshot)
      )
        return;
      if (previous && previous.sessionId !== snapshot.sessionId) {
        retiredNativeSessionIdsRef.current.add(previous.sessionId);
      }
      lastNativeSnapshotRef.current = snapshot;
      if (snapshot.bookId !== book.hash) {
        stateRef.current = 'stopped';
        setState('stopped');
        lastNativeTextTargetRef.current = null;
        return;
      }
      stateRef.current = snapshot.state;
      setState(snapshot.state);
      setSectionIndex(snapshot.chapterIndex);
      setNativePlaybackRate(snapshot.playbackRate);
      const currentViewSettings = getViewSettings(bookKey);
      if (currentViewSettings && currentViewSettings.moPlaybackRate !== snapshot.playbackRate) {
        setViewSettings(bookKey, {
          ...currentViewSettings,
          moPlaybackRate: snapshot.playbackRate,
        });
      }
      const chapterSeconds = snapshot.chapterPositionMs / 1000;
      setChapterElapsed(chapterSeconds);
      setElapsed(timeline.elapsed(snapshot.chapterIndex, chapterSeconds));

      const location = parseMediaOverlayLocation(snapshot.location);
      if (!location || location.editionId !== book.hash) return;
      const fragment = location.textLocator?.locations.fragments[0];
      const textTarget =
        location.textLocator && fragment ? `${location.textLocator.href}#${fragment}` : null;
      if (textTarget) lastHighlightTextRef.current = textTarget;
      if (
        snapshot.isBookmarked &&
        textTarget &&
        lastAdoptedNativeBookmarkRef.current !== textTarget
      ) {
        lastAdoptedNativeBookmarkRef.current = textTarget;
        void addBookmarkAtTextTargetRef.current(textTarget);
      } else if (!snapshot.isBookmarked) {
        lastAdoptedNativeBookmarkRef.current = null;
      }
      // Serialize SMIL work: two async chapter loads must never mutate the
      // same engine concurrently. Coalesce old positions onto the latest cue.
      const lifetime = nativeLifetimeRef.current;
      const isCurrentCue = () => {
        const latest = lastNativeSnapshotRef.current;
        return (
          nativeLifetimeRef.current === lifetime &&
          latest?.sessionId === snapshot.sessionId &&
          latest.bookId === book.hash &&
          latest.location?.textLocator?.href === location.textLocator?.href &&
          latest.location?.textLocator?.locations.fragments[0] === fragment &&
          document.visibilityState !== 'hidden' &&
          !nativeReadAlongRef.current.trayCollapsed &&
          nativeReadAlongRef.current.readAlongEnabled
        );
      };
      if (refreshReadAlong) lastNativeTextTargetRef.current = null;
      if (textTarget && isCurrentCue()) {
        nativeHighlightQueueRef.current = nativeHighlightQueueRef.current
          .then(async () => {
            if (!isCurrentCue() || textTarget === lastNativeTextTargetRef.current) return;
            const resolved = resolveMediaOverlayLocation(
              await getPlaybackManifest(),
              location,
              book.hash,
            );
            if (!resolved || !isCurrentCue()) return;
            const synchronized = await engine?.synchronizeAtOffset(
              resolved.sectionIndex,
              resolved.sectionOffset,
            );
            if (!synchronized || !isCurrentCue()) return;
            lastNativeTextTargetRef.current = textTarget;
            if (!nativeReadAlongRef.current.followSuspended) await view?.goTo(textTarget);
          })
          .catch((error: unknown) => {
            console.warn('native audiobook read-along synchronization failed', error);
          });
      }

      const shouldPersist =
        snapshot.state !== 'playing' || Date.now() - lastNativePersistAtRef.current >= 5_000;
      if (!shouldPersist) return;
      const configured = parseMediaOverlayLocation(getConfig(bookKey)?.mediaOverlayLocation);
      if (configured?.editionId === book.hash && configured.updatedAt >= location.updatedAt) return;
      lastNativePersistAtRef.current = Date.now();
      locallySavedLocationUpdatedAtRef.current = location.updatedAt;
      setConfig(bookKey, { mediaOverlayLocation: location, updatedAt: location.updatedAt });
      const updated = getConfig(bookKey);
      if (updated) void saveConfig(envConfig, bookKey, updated, settings);
      void updateBook(envConfig, {
        ...book,
        audioPosition: timeline.elapsed(snapshot.chapterIndex, chapterSeconds),
        updatedAt: location.updatedAt,
      });
    },
    [
      bookKey,
      engine,
      envConfig,
      followSuspended,
      getBookData,
      getConfig,
      getPlaybackManifest,
      getViewSettings,
      readAlongEnabled,
      saveConfig,
      setConfig,
      setViewSettings,
      settings,
      timeline,
      updateBook,
      view,
    ],
  );

  // Keep one subscription per reader/engine lifetime, independent of position,
  // settings and config renders. Callbacks always use the latest reader context.
  const adoptNativeSnapshotRef = useRef(adoptNativeSnapshot);
  adoptNativeSnapshotRef.current = adoptNativeSnapshot;
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  useEffect(() => {
    let disposed = false;
    let listener: Awaited<ReturnType<typeof playbackBackend.subscribe>> = null;
    let attaching = false;
    nativeLifetimeRef.current += 1;
    lastNativeSnapshotRef.current = null;
    retiredNativeSessionIdsRef.current.clear();
    lastNativeTextTargetRef.current = null;
    const adopt = async (snapshot: AudiobookPlaybackSnapshot, refreshReadAlong = false) => {
      if (disposed) return;
      if (isNativePlayback) await adoptNativeSnapshotRef.current(snapshot, refreshReadAlong);
      else {
        setState(snapshot.state);
        if (snapshot.chapterIndex >= 0 && !pendingExternalLocationRef.current) {
          const chapterSeconds = snapshot.chapterPositionMs / 1_000;
          setSectionIndex(snapshot.chapterIndex);
          setChapterElapsed(chapterSeconds);
          setElapsed(timelineRef.current.elapsed(snapshot.chapterIndex, chapterSeconds));
        }
      }
    };
    const refresh = async () => {
      if (disposed || document.visibilityState === 'hidden') return;
      try {
        const beforeRefresh = lastNativeSnapshotRef.current;
        const snapshot = await playbackBackend.getSnapshot();
        const current = lastNativeSnapshotRef.current;
        // Session IDs are opaque. If a live event changed session during IPC,
        // an older reply from an as-yet-unseen session cannot be ordered safely.
        if (
          isNativePlayback &&
          current !== beforeRefresh &&
          current &&
          snapshot?.sessionId !== current.sessionId
        )
          return;
        if (snapshot && !disposed) {
          if (isNativePlayback) await adopt(snapshot, true);
          else setState(snapshot.state);
        }
      } catch (error) {
        if (!disposed) console.warn('audiobook playback snapshot refresh failed', error);
      }
    };
    const attach = async () => {
      if (disposed || attaching) return;
      attaching = true;
      try {
        const registered = await playbackBackend.subscribe((snapshot) => {
          void adopt(snapshot).catch((error: unknown) => {
            console.warn('audiobook playback snapshot adoption failed', error);
          });
        });
        if (disposed) {
          await registered?.unregister();
          return;
        }
        listener = registered;
        // Subscribe first, then read: state changes during registration are
        // recovered by the snapshot, and newer events win via sequence checks.
        await refresh();
      } catch (error) {
        if (!disposed) console.warn('audiobook playback subscription failed', error);
      } finally {
        attaching = false;
      }
    };
    const onForeground = () => {
      if (!isNativePlayback || document.visibilityState === 'hidden') return;
      if (listener) void refresh();
      else void attach();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    void attach();
    return () => {
      disposed = true;
      nativeLifetimeRef.current += 1;
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
      if (listener) void listener.unregister();
    };
  }, [bookKey, engine, isNativePlayback, playbackBackend]);

  useEffect(() => {
    const snapshot = lastNativeSnapshotRef.current;
    if (isNativePlayback && snapshot && readAlongEnabled && !trayCollapsed) {
      void adoptNativeSnapshotRef.current(snapshot, true);
    }
  }, [isNativePlayback, readAlongEnabled, trayCollapsed, followSuspended]);

  const controlPlayback = useCallback(
    async (command: AudiobookCommand) => {
      const lifetime = nativeLifetimeRef.current;
      const confirmedBeforeCommand = lastNativeSnapshotRef.current;
      if (
        isNativePlayback &&
        [
          'pause',
          'stop',
          'startChapter',
          'nextChapter',
          'previousChapter',
          'seekRelative',
          'seekToLocator',
        ].includes(command.action)
      ) {
        nativePlayRequestRef.current += 1;
      }
      try {
        const snapshot = await playbackBackend.control(command);
        const current = lastNativeSnapshotRef.current;
        if (
          isNativePlayback &&
          current !== confirmedBeforeCommand &&
          current &&
          snapshot?.sessionId !== current.sessionId
        )
          return undefined;
        if (isNativePlayback && snapshot && nativeLifetimeRef.current === lifetime) {
          await adoptNativeSnapshotRef.current(snapshot);
        }
        return snapshot;
      } catch (error) {
        if (!isNativePlayback) throw error;
        if (nativeLifetimeRef.current !== lifetime) return undefined;
        if (
          lastNativeSnapshotRef.current === confirmedBeforeCommand &&
          (command.action === 'play' || command.action === 'startChapter')
        )
          dispatch('ERROR');
        console.warn('audiobook playback command failed', error);
        eventDispatcher.dispatch('toast', {
          message: _('Could not update audiobook playback.'),
          type: 'error',
          timeout: 5000,
        });
        return undefined;
      }
    },
    [isNativePlayback, playbackBackend, dispatch, _],
  );

  const syncPosition = useCallback(() => {
    if (!engine || isNativePlayback) return;
    const index = engine.activeSectionIndex;
    if (index < 0) return;
    setSectionIndex(index);
    setElapsed(timeline.elapsed(index, engine.sectionOffset));
    setChapterElapsed(engine.sectionOffset);
    // End-of-chapter sleep timer: a section change that the user did NOT
    // drive (no manual navigation flagged) is the chapter rolling over.
    if (prevSectionRef.current >= 0 && index !== prevSectionRef.current) {
      const isManual = Date.now() - manualNavAtRef.current < 1200;
      if (
        sleepTimerRef.current.mode?.type === 'end-of-chapter' &&
        !isManual &&
        isActive(stateRef.current)
      ) {
        void controlPlayback({ action: 'pause' });
        dispatch('PAUSE');
        setSleepTimerState(CLEARED_TIMER);
        setSleepRemainingSec(null);
      }
    }
    prevSectionRef.current = index;
  }, [engine, timeline, dispatch, isNativePlayback, controlPlayback]);

  const saveLocation = useCallback(async () => {
    if (!engine || isNativePlayback || engine.activeSectionIndex < 0) return;
    const book = getBookData(bookKey)?.book;
    if (!book || !getConfig(bookKey)) return;
    const manifest = await getPlaybackManifest();
    const chapter = chapters.find(
      (candidate) => candidate.sectionIndex === engine.activeSectionIndex,
    );
    const location: MediaOverlayLocation | undefined = createMediaOverlayLocation({
      editionId: book.hash,
      manifest,
      sectionIndex: engine.activeSectionIndex,
      sectionOffset: engine.sectionOffset,
      title: chapter?.label,
    });
    if (!location) return;
    locallySavedLocationUpdatedAtRef.current = location.updatedAt;
    setConfig(bookKey, { mediaOverlayLocation: location });
    const updated = getConfig(bookKey);
    if (updated) saveConfig(envConfig, bookKey, updated, settings);
    void pushPlaybackLocationToCar(location);
    // Denormalize onto the library record so the Continue Listening strip
    // can show time-left without loading per-book configs.
    void updateBook(envConfig, {
      ...book,
      audioPosition: timeline.elapsed(engine.activeSectionIndex, engine.sectionOffset),
      updatedAt: Date.now(),
    });
  }, [
    engine,
    bookKey,
    getConfig,
    setConfig,
    saveConfig,
    envConfig,
    settings,
    getBookData,
    updateBook,
    timeline,
    getPlaybackManifest,
    chapters,
    isNativePlayback,
  ]);

  // Engine events → machine. `highlight` doubles as the "audio is live"
  // confirmation; the machine ignores it outside of `loading`.
  useEffect(() => {
    if (!engine || isNativePlayback) return;
    const onHighlight = (e: Event) => {
      const previousSection = prevSectionRef.current;
      lastHighlightTextRef.current =
        ((e as CustomEvent).detail as { text?: string } | undefined)?.text ?? null;
      dispatch('STARTED');
      syncPosition();
      if (previousSection >= 0 && previousSection !== engine.activeSectionIndex) {
        void saveLocation();
      }
    };
    const onEnded = () => {
      dispatch('ENDED');
      setFollowSuspended(false);
      void saveLocation();
    };
    const onPause = () => {
      if (!isActive(stateRef.current)) return;
      dispatch('PAUSE');
      void saveLocation();
    };
    const onError = (e: Event) => {
      dispatch('ERROR');
      console.error('audiobook engine error', (e as CustomEvent).detail);
      eventDispatcher.dispatch('toast', {
        message: _('Could not play this chapter’s audio.'),
        type: 'error',
        timeout: 5000,
      });
    };
    engine.addEventListener('highlight', onHighlight);
    engine.addEventListener('pause', onPause);
    engine.addEventListener('ended', onEnded);
    engine.addEventListener('error', onError);
    return () => {
      engine.removeEventListener('highlight', onHighlight);
      engine.removeEventListener('pause', onPause);
      engine.removeEventListener('ended', onEnded);
      engine.removeEventListener('error', onError);
    };
  }, [engine, dispatch, saveLocation, syncPosition, _, isNativePlayback]);

  // Live position + periodic save while playing.
  useEffect(() => {
    if (state !== 'playing' || isNativePlayback) return;
    syncPosition();
    let sinceSave = 0;
    const timer = setInterval(() => {
      syncPosition();
      sinceSave += POSITION_POLL_MS;
      if (sinceSave >= POSITION_SAVE_MS) {
        sinceSave = 0;
        void saveLocation();
      }
    }, POSITION_POLL_MS);
    return () => clearInterval(timer);
  }, [state, syncPosition, saveLocation, isNativePlayback]);

  // Never lose the position: save when the page hides or the reader unmounts.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (
        !isNativePlayback &&
        document.visibilityState === 'hidden' &&
        isActive(stateRef.current)
      ) {
        void saveLocation();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (!isNativePlayback && isActive(stateRef.current)) void saveLocation();
    };
  }, [saveLocation, isNativePlayback]);

  // PRD §5.5: chapter navigation reuses the ebook TOC. While a listening
  // session is active, a TOC chapter jump (a 'navigate' event carrying an
  // href — annotations navigate by CFI) moves the audio to that chapter.
  useEffect(() => {
    if (!engine || !view) return;
    const onNavigate = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; href?: string } | undefined;
      if (detail?.bookKey !== bookKey || !detail.href) return;
      if (!isActive(stateRef.current)) return;
      const index = view.resolveNavigation(detail.href)?.index ?? -1;
      if (index < 0 || !view.book?.sections?.[index]?.mediaOverlay) return;
      manualNavAtRef.current = Date.now();
      setFollowSuspended(false);
      const bookId = getBookData(bookKey)?.book?.hash;
      if (bookId) void controlPlayback({ action: 'startChapter', bookId, chapterIndex: index });
    };
    eventDispatcher.on('navigate', onNavigate);
    return () => eventDispatcher.off('navigate', onNavigate);
  }, [engine, view, bookKey, getBookData, isNativePlayback, controlPlayback]);

  // Before any playback, surface the saved (or first) audio chapter so the
  // chapter-scoped scrubber and clocks have a timeline to show (PRD §5.1).
  useEffect(() => {
    if (!engine || !view || sectionIndex >= 0) return;
    const sections = view.book?.sections ?? [];
    const firstOverlay = sections.findIndex((section) => section.mediaOverlay);
    let cancelled = false;
    void getPlaybackManifest().then((manifest) => {
      if (cancelled) return;
      const book = getBookData(bookKey)?.book;
      const location = parseMediaOverlayLocation(getConfig(bookKey)?.mediaOverlayLocation);
      const resolved = book ? resolveMediaOverlayLocation(manifest, location, book.hash) : null;
      if (location && location.editionId === book?.hash) {
        observedLocationUpdatedAtRef.current = Math.max(
          observedLocationUpdatedAtRef.current,
          location.updatedAt,
        );
      }
      const index = resolved?.sectionIndex ?? firstOverlay;
      if (index < 0) return;
      const offset = resolved?.sectionOffset ?? 0;
      setSectionIndex(index);
      setChapterElapsed(offset);
      setElapsed(timeline.elapsed(index, offset));
      initialLocationHydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [engine, view, sectionIndex, bookKey, getConfig, getBookData, getPlaybackManifest, timeline]);

  // A native car player can advance while this reader and its HTML audio
  // element remain mounted in the background. When foreground reconciliation
  // writes a newer locator into the shared config, invalidate that stale
  // engine state, update the visible timeline, and make the next Play perform
  // an exact start rather than blindly resuming the old element.
  useEffect(() => {
    if (!engine || !view || !initialLocationHydratedRef.current) return;
    if (isNativePlayback && isActive(stateRef.current)) return;
    const book = getBookData(bookKey)?.book;
    const location = parseMediaOverlayLocation(configuredMediaOverlayLocation);
    if (!book || !location || location.editionId !== book.hash) return;
    if (location.updatedAt <= observedLocationUpdatedAtRef.current) return;
    if (location.updatedAt === locallySavedLocationUpdatedAtRef.current) {
      observedLocationUpdatedAtRef.current = location.updatedAt;
      locallySavedLocationUpdatedAtRef.current = 0;
      return;
    }

    let cancelled = false;
    void getPlaybackManifest().then((manifest) => {
      if (cancelled) return;
      const latest = parseMediaOverlayLocation(getConfig(bookKey)?.mediaOverlayLocation);
      if (!latest || latest.editionId !== book.hash || latest.updatedAt !== location.updatedAt) {
        return;
      }
      const resolved = resolveMediaOverlayLocation(manifest, location, book.hash);
      if (!resolved) return;
      // The Play handler may already have consumed this locator while the
      // manifest promise was resolving. Do not subsequently pause that fresh
      // playback and turn the same locator back into a pending handoff.
      if (location.updatedAt <= observedLocationUpdatedAtRef.current) return;

      observedLocationUpdatedAtRef.current = location.updatedAt;
      if (isNativePlayback) {
        // A clean device can receive cloud progress after its initial empty
        // timeline. Show that position while idle; Play consumes the locator.
        setSectionIndex(resolved.sectionIndex);
        setChapterElapsed(resolved.sectionOffset);
        setElapsed(timeline.elapsed(resolved.sectionIndex, resolved.sectionOffset));
        return;
      }
      pendingExternalLocationRef.current = {
        sectionIndex: resolved.sectionIndex,
        sectionOffset: resolved.sectionOffset,
        updatedAt: location.updatedAt,
      };
      if (isActive(stateRef.current)) {
        void controlPlayback({ action: 'pause' });
        dispatch('PAUSE');
      }
      setSectionIndex(resolved.sectionIndex);
      setChapterElapsed(resolved.sectionOffset);
      setElapsed(timeline.elapsed(resolved.sectionIndex, resolved.sectionOffset));
      setFollowSuspended(false);
      manualNavAtRef.current = Date.now();

      const fragment = location.textLocator?.locations.fragments[0];
      if (location.textLocator && fragment) {
        view.goTo(`${location.textLocator.href}#${fragment}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    configuredMediaOverlayLocation,
    engine,
    view,
    bookKey,
    getBookData,
    getConfig,
    getPlaybackManifest,
    timeline,
    dispatch,
    isNativePlayback,
  ]);

  // Read-along control: the view applies the highlight class and follows the
  // audio only while read-along is on and the user hasn't wandered off.
  useEffect(() => {
    if (!view) return;
    view.mediaOverlayHighlightEnabled = readAlongEnabled && !trayCollapsed;
    view.mediaOverlayFollowEnabled = readAlongEnabled && !trayCollapsed && !followSuspended;
  }, [view, readAlongEnabled, followSuspended, trayCollapsed]);

  // A relocate into a section other than the one playing is the reader
  // wandering off (media-overlay navigation always lands on the playing
  // section) — stop dragging them back until they ask to return.
  useEffect(() => {
    if (!view || !engine) return;
    const onRelocate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { section?: { current?: number } } | undefined;
      const current = detail?.section?.current;
      if (typeof current !== 'number') return;
      const activeSection = isNativePlayback
        ? (lastNativeSnapshotRef.current?.chapterIndex ?? -1)
        : engine.activeSectionIndex;
      if (!isActive(stateRef.current) || activeSection < 0) return;
      // A deliberate jump (TOC, transport) is in flight: the audio is moving
      // to this section, so landing here is not the reader wandering off.
      if (Date.now() - manualNavAtRef.current < 1200) return;
      if (current !== activeSection) {
        // Flip the view flag synchronously: waiting for the React effect
        // loses the race against the next highlight's navigation.
        view.mediaOverlayFollowEnabled = false;
        setFollowSuspended(true);
      }
    };
    view.addEventListener('relocate', onRelocate);
    return () => view.removeEventListener('relocate', onRelocate);
  }, [view, engine, isNativePlayback, sectionIndex]);

  // Tap-to-seek: a tap on (or inside) a SMIL text target jumps the audio
  // there. Section documents live in iframes, so retain each handler and
  // explicitly remove it whenever this reader instance unmounts or rewires.
  useEffect(() => {
    if (!view || !engine) return;
    const wiredDocs = new Map<Document, EventListener>();
    const wireDoc = (doc: Document | undefined, index: number) => {
      if (!doc?.addEventListener || index < 0 || wiredDocs.has(doc)) return;
      const onClick: EventListener = (ev) => {
        if (!isActive(stateRef.current)) return;
        // Dismissing the audiobook tray returns the page to normal reading.
        // Playback may remain active (especially after leaving Android Auto),
        // but page taps must no longer seek or highlight narration text.
        if (useAudiobookStore.getState().trayCollapsed[bookKey] ?? false) return;
        const fragment = findTapFragment(ev.target);
        if (!fragment) return;
        void (async () => {
          if (isNativePlayback) {
            const book = getBookData(bookKey)?.book;
            const offset = await engine.textOffset(index, fragment);
            if (!book || offset == null) return;
            const location = createMediaOverlayLocation({
              editionId: book.hash,
              manifest: await getPlaybackManifest(),
              sectionIndex: index,
              sectionOffset: offset,
              title: chapters.find((chapter) => chapter.sectionIndex === index)?.label,
            });
            if (!location) return;
            await controlPlayback({ action: 'seekToLocator', location });
            setFollowSuspended(false);
            return;
          }
          const matched = await engine.playFromText(index, fragment);
          if (matched) {
            setFollowSuspended(false);
            syncPosition();
          }
        })();
      };
      wiredDocs.set(doc, onClick);
      doc.addEventListener('click', onClick);
    };
    const onLoad = (e: Event) => {
      const detail = (e as CustomEvent).detail as { doc?: Document; index?: number } | undefined;
      if (detail?.doc && typeof detail.index === 'number') wireDoc(detail.doc, detail.index);
    };
    view.addEventListener('load', onLoad);
    // Sections rendered before this hook mounted (the opening page) are
    // already loaded and will never re-emit 'load'.
    for (const content of view.renderer?.getContents?.() ?? []) {
      wireDoc(content.doc, content.index ?? -1);
    }
    return () => {
      view.removeEventListener('load', onLoad);
      for (const [doc, onClick] of wiredDocs) doc.removeEventListener('click', onClick);
      wiredDocs.clear();
    };
  }, [
    view,
    engine,
    syncPosition,
    bookKey,
    isNativePlayback,
    getBookData,
    getPlaybackManifest,
    chapters,
    controlPlayback,
  ]);

  // Duration sleep timer: tick the countdown, fade the last seconds, pause
  // at expiry, and always leave the volume restored for the next session.
  useEffect(() => {
    if (!sleepTimer.mode) {
      setSleepRemainingSec(null);
      return;
    }
    const tick = () => {
      const now = Date.now();
      setSleepRemainingSec(remainingSeconds(sleepTimerRef.current, now));
      if (isNativePlayback || sleepTimerRef.current.mode?.type !== 'duration' || !engine) return;
      if (isExpired(sleepTimerRef.current, now)) {
        if (isActive(stateRef.current)) {
          void controlPlayback({ action: 'pause' });
          dispatch('PAUSE');
          void saveLocation();
        }
        void controlPlayback({ action: 'setVolume', volume: 1 });
        setSleepTimerState(CLEARED_TIMER);
        setSleepRemainingSec(null);
      } else {
        void controlPlayback({
          action: 'setVolume',
          volume: fadeVolume(sleepTimerRef.current, now),
        });
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [sleepTimer.mode, engine, dispatch, saveLocation, isNativePlayback, controlPlayback]);

  const setSleepTimer = useCallback(
    (mode: SleepTimerMode | null) => {
      if (!mode) {
        void controlPlayback({ action: 'cancelSleepTimer' });
        setSleepTimerState(CLEARED_TIMER);
        setSleepRemainingSec(null);
        return;
      }
      const timer = startTimer(mode, Date.now());
      setSleepTimerState(timer);
      void controlPlayback(
        mode.type === 'duration'
          ? { action: 'setSleepTimer', mode: 'duration', endsAt: timer.expiresAt ?? undefined }
          : { action: 'setSleepTimer', mode: 'endOfChapter' },
      );
    },
    [controlPlayback],
  );

  const extendSleepTimer = useCallback(
    (minutes: number) => {
      setSleepTimerState((prev) => {
        if (!prev.mode) return prev;
        const next = extendTimer(prev, minutes, Date.now());
        if (next.mode?.type === 'duration') {
          void controlPlayback({
            action: 'setSleepTimer',
            mode: 'duration',
            endsAt: next.expiresAt ?? undefined,
          });
        }
        return next;
      });
    },
    [controlPlayback],
  );

  const play = useCallback(async () => {
    if (!engine || !view) return;
    const current = stateRef.current;
    if (current === 'playing' || current === 'loading') return;
    if (isNativePlayback) {
      const book = getBookData(bookKey)?.book;
      if (!book) return;
      const lifetime = nativeLifetimeRef.current;
      const request = ++nativePlayRequestRef.current;
      const isCurrentRequest = () =>
        nativeLifetimeRef.current === lifetime && nativePlayRequestRef.current === request;
      await eventDispatcher.dispatch('tts-stop', { bookKey });
      if (!isCurrentRequest()) return;
      dispatch('PLAY');
      try {
        await prepareNativePlayback();
        if (!isCurrentRequest()) return;
        const location = current === 'ended' ? undefined : await getLatestPlaybackLocation();
        if (!isCurrentRequest()) return;
        const snapshot = await controlPlayback({
          action: 'play',
          bookId: book.hash,
          location,
          rate: viewSettings?.moPlaybackRate ?? 1,
        });
        if (snapshot?.error === 'manifest_unavailable') {
          await prepareNativePlayback();
          if (!isCurrentRequest()) return;
          await controlPlayback({
            action: 'play',
            bookId: book.hash,
            location,
            rate: viewSettings?.moPlaybackRate ?? 1,
          });
        }
      } catch (error) {
        if (!isCurrentRequest()) return;
        console.error('native audiobook playback failed to start', error);
        dispatch('ERROR');
      }
      return;
    }
    if (current === 'paused') {
      const observedBeforeRefresh = observedLocationUpdatedAtRef.current;
      let pending = pendingExternalLocationRef.current;
      if (!pending) {
        const book = getBookData(bookKey)?.book;
        const location = await getLatestPlaybackLocation();
        // The external-location effect may resolve while the native read is
        // awaiting. Re-read the ref instead of resuming from the stale local
        // snapshot captured before that await.
        pending = pendingExternalLocationRef.current;
        if (
          !pending &&
          book &&
          location?.editionId === book.hash &&
          location.updatedAt > observedBeforeRefresh &&
          location.updatedAt !== locallySavedLocationUpdatedAtRef.current
        ) {
          const resolved = resolveMediaOverlayLocation(
            await getPlaybackManifest(),
            location,
            book.hash,
          );
          if (resolved) {
            pending = {
              sectionIndex: resolved.sectionIndex,
              sectionOffset: resolved.sectionOffset,
              updatedAt: location.updatedAt,
            };
            observedLocationUpdatedAtRef.current = location.updatedAt;
            setSectionIndex(resolved.sectionIndex);
            setChapterElapsed(resolved.sectionOffset);
            setElapsed(timeline.elapsed(resolved.sectionIndex, resolved.sectionOffset));
            setFollowSuspended(false);
            manualNavAtRef.current = Date.now();
            const fragment = location.textLocator?.locations.fragments[0];
            if (location.textLocator && fragment) {
              view.goTo(`${location.textLocator.href}#${fragment}`);
            }
          }
        }
      }
      const book = getBookData(bookKey)?.book;
      if (!book) return;
      if (!pending) {
        await controlPlayback({
          action: 'play',
          bookId: book.hash,
          rate: viewSettings?.moPlaybackRate ?? 1,
        });
        dispatch('PLAY');
        return;
      }
      pendingExternalLocationRef.current = null;
      setSectionIndex(pending.sectionIndex);
      setChapterElapsed(pending.sectionOffset);
      setElapsed(timeline.elapsed(pending.sectionIndex, pending.sectionOffset));
      setFollowSuspended(false);
      manualNavAtRef.current = Date.now();
      dispatch('PLAY');
      try {
        const location = createMediaOverlayLocation({
          editionId: book.hash,
          manifest: await getPlaybackManifest(),
          sectionIndex: pending.sectionIndex,
          sectionOffset: pending.sectionOffset,
        });
        if (!location) throw new Error('Could not resolve audiobook handoff location');
        await controlPlayback({
          action: 'play',
          bookId: book.hash,
          location,
          rate: viewSettings?.moPlaybackRate ?? 1,
        });
      } catch (error) {
        console.error('audiobook playback failed to resume after car handoff', error);
        dispatch('ERROR');
      }
      return;
    }
    const restarting = current === 'ended';
    dispatch('PLAY');
    try {
      const book = getBookData(bookKey)?.book;
      if (!book) return;
      const latestLocation = restarting ? undefined : await getLatestPlaybackLocation();
      const saved = restarting
        ? null
        : resolveMediaOverlayLocation(await getPlaybackManifest(), latestLocation, book.hash);
      if (saved) {
        setSectionIndex(saved.sectionIndex);
        setChapterElapsed(saved.sectionOffset);
        setElapsed(timeline.elapsed(saved.sectionIndex, saved.sectionOffset));
        setFollowSuspended(false);
        manualNavAtRef.current = Date.now();
        const fragment = latestLocation?.textLocator?.locations.fragments[0];
        if (latestLocation?.textLocator && fragment) {
          view.goTo(`${latestLocation.textLocator.href}#${fragment}`);
        }
      }
      await controlPlayback({
        action: 'play',
        bookId: book.hash,
        location: saved ? latestLocation : undefined,
        rate: viewSettings?.moPlaybackRate ?? 1,
      });
    } catch (error) {
      console.error('audiobook playback failed to start', error);
      dispatch('ERROR');
    }
  }, [
    engine,
    view,
    bookKey,
    getConfig,
    getBookData,
    getPlaybackManifest,
    getLatestPlaybackLocation,
    viewSettings,
    dispatch,
    timeline,
    isNativePlayback,
    prepareNativePlayback,
    controlPlayback,
    adoptNativeSnapshot,
  ]);

  const pause = useCallback(() => {
    if (!engine) return;
    void controlPlayback({ action: 'pause' });
    if (isNativePlayback) return;
    dispatch('PAUSE');
    void saveLocation();
  }, [engine, dispatch, saveLocation, isNativePlayback, controlPlayback]);

  const dismiss = useCallback(async () => {
    if (!engine || !view) return;
    const lifetime = nativeLifetimeRef.current;
    try {
      // An idle/finished web engine has no audio to resume. Keep its state so
      // the next Play starts normally instead of resuming a missing element.
      const snapshot =
        isNativePlayback || isActive(stateRef.current)
          ? await controlPlayback({ action: 'pause' })
          : undefined;
      if (nativeLifetimeRef.current !== lifetime) return;
      // Keep the controls available if pausing failed or a newer car command
      // has already resumed playback while the pause reply was in flight.
      if (
        isNativePlayback &&
        (!snapshot || !['paused', 'stopped', 'ended'].includes(stateRef.current))
      )
        return;
      if (!isNativePlayback) {
        dispatch('PAUSE');
        await saveLocation();
        if (nativeLifetimeRef.current !== lifetime) return;
      }
      // Disable rendering before clearing the cue: an in-flight SMIL load
      // must not repaint it after the tray closes. Retain the audio for resume.
      nativeReadAlongRef.current.trayCollapsed = true;
      view.mediaOverlayHighlightEnabled = false;
      view.mediaOverlayFollowEnabled = false;
      engine.dispatchEvent(new CustomEvent('unhighlight'));
      lastNativeTextTargetRef.current = null;
      useAudiobookStore.getState().setTrayCollapsed(bookKey, true);
    } catch (error) {
      console.warn('audiobook player could not be closed', error);
    }
  }, [bookKey, engine, view, controlPlayback, isNativePlayback, dispatch, saveLocation]);

  useEffect(() => {
    const onTTSOwnershipRequest = () => {
      if (isActive(stateRef.current)) pause();
    };
    eventDispatcher.on('audiobook-pause', onTTSOwnershipRequest);
    return () => eventDispatcher.off('audiobook-pause', onTTSOwnershipRequest);
  }, [pause]);

  const togglePlay = useCallback(() => {
    if (stateRef.current === 'playing' || stateRef.current === 'loading') pause();
    else void play();
  }, [pause, play]);

  const withActiveEngine = useCallback(
    (action: (activeEngine: NonNullable<typeof engine>) => void) => {
      if (!engine || engine.activeSectionIndex < 0) return;
      manualNavAtRef.current = Date.now();
      action(engine);
      syncPosition();
    },
    [engine, syncPosition],
  );

  const skipForward = useCallback(() => {
    if (!isNativePlayback && (!engine || engine.activeSectionIndex < 0)) return;
    manualNavAtRef.current = Date.now();
    void controlPlayback({
      action: 'seekRelative',
      offsetMs: (viewSettings?.moSkipForwardSec ?? 30) * 1000,
    }).then(() => {
      if (!isNativePlayback) syncPosition();
    });
  }, [engine, viewSettings, isNativePlayback, controlPlayback, syncPosition]);

  const skipBack = useCallback(() => {
    if (!isNativePlayback && (!engine || engine.activeSectionIndex < 0)) return;
    manualNavAtRef.current = Date.now();
    void controlPlayback({
      action: 'seekRelative',
      offsetMs: -(viewSettings?.moSkipBackSec ?? 15) * 1000,
    }).then(() => {
      if (!isNativePlayback) syncPosition();
    });
  }, [engine, viewSettings, isNativePlayback, controlPlayback, syncPosition]);

  const nextChapter = useCallback(() => {
    setFollowSuspended(false);
    void controlPlayback({ action: 'nextChapter' });
  }, [controlPlayback]);

  const prevChapter = useCallback(() => {
    setFollowSuspended(false);
    void controlPlayback({ action: 'previousChapter' });
  }, [controlPlayback]);

  // PRD §5.1: the scrubber is chapter-scoped — seeks land within the
  // playing chapter.
  const seekToChapterTime = useCallback(
    (seconds: number) => {
      setFollowSuspended(false);
      if (isNativePlayback) {
        const book = getBookData(bookKey)?.book;
        if (!book || sectionIndex < 0) return;
        void (async () => {
          const duration = timeline.sectionDuration(sectionIndex);
          const offset =
            duration > 0 ? Math.max(0, Math.min(seconds, duration - 0.05)) : Math.max(0, seconds);
          const location = createMediaOverlayLocation({
            editionId: book.hash,
            manifest: await getPlaybackManifest(),
            sectionIndex,
            sectionOffset: offset,
            title: chapters.find((chapter) => chapter.sectionIndex === sectionIndex)?.label,
          });
          if (location) await controlPlayback({ action: 'seekToLocator', location });
        })();
        return;
      }
      withActiveEngine((e) => {
        const index = e.activeSectionIndex;
        const duration = timeline.sectionDuration(index);
        const offset =
          duration > 0 ? Math.max(0, Math.min(seconds, duration - 0.05)) : Math.max(0, seconds);
        setElapsed(timeline.elapsed(index, offset));
        setChapterElapsed(offset);
        void e.startAtOffset(index, offset);
      });
    },
    [
      withActiveEngine,
      timeline,
      isNativePlayback,
      getBookData,
      bookKey,
      sectionIndex,
      getPlaybackManifest,
      chapters,
      controlPlayback,
    ],
  );

  const persistViewSettings = useCallback(
    (patch: Partial<MediaOverlayConfig>, reapplyStyles = false) => {
      if (!viewSettings) return;
      const next = { ...viewSettings, ...patch };
      setViewSettings(bookKey, next);
      if (reapplyStyles) view?.renderer?.setStyles?.(getStyles(next));
      const config = getConfig(bookKey);
      if (config) saveConfig(envConfig, bookKey, config, settings);
    },
    [viewSettings, setViewSettings, bookKey, getConfig, saveConfig, envConfig, settings, view],
  );

  const setRate = useCallback(
    (rate: number) => {
      void controlPlayback({ action: 'setRate', rate });
      persistViewSettings({ moPlaybackRate: rate });
    },
    [persistViewSettings, controlPlayback],
  );

  const cycleRate = useCallback(() => {
    const rates = [0.75, 1, 1.25, 1.5, 1.75, 2];
    const current = viewSettings?.moPlaybackRate ?? 1;
    setRate(rates.find((candidate) => candidate > current + 0.01) ?? rates[0]!);
  }, [setRate, viewSettings?.moPlaybackRate]);

  // ── Bookmarks: ordinary BookNote bookmarks whose CFI id-assertion is the
  // SMIL text target, so audio position is recoverable with no new schema.
  const booknotes = getConfig(bookKey)?.booknotes;
  useEffect(() => {
    if (!view || !engine) return;
    const bookmarks = (booknotes ?? []).filter((n) => n.type === 'bookmark' && !n.deletedAt);
    let cancelled = false;
    void (async () => {
      const entries: AudiobookBookmark[] = [];
      for (const bookmark of bookmarks) {
        const fragment = fragmentFromCfi(bookmark.cfi);
        let index = -1;
        try {
          index = view.resolveCFI(bookmark.cfi)?.index ?? -1;
        } catch {
          // Foreign or stale CFIs must not break the list.
        }
        const offset =
          fragment != null && index >= 0 ? await engine.textOffset(index, fragment) : null;
        entries.push({
          id: bookmark.id,
          sectionIndex: index,
          fragment,
          bookTime: offset != null ? timeline.elapsed(index, offset) : null,
          snippet: bookmark.text ?? '',
        });
      }
      entries.sort((a, b) => (a.bookTime ?? Infinity) - (b.bookTime ?? Infinity));
      if (!cancelled) setBookmarkEntries(entries);
    })();
    return () => {
      cancelled = true;
    };
  }, [booknotes, view, engine, timeline, bookKey, getConfig]);

  const activeFragment = (() => {
    const text = lastHighlightTextRef.current;
    return text ? (text.split('#')[1] ?? null) : null;
  })();
  const isCurrentBookmarked =
    activeFragment != null &&
    bookmarkEntries.some((b) => b.fragment === activeFragment && b.sectionIndex === sectionIndex);

  const persistBooknotes = useCallback(
    (notes: BookNote[]) => {
      const updatedConfig = updateBooknotes(bookKey, notes);
      if (updatedConfig) saveConfig(envConfig, bookKey, updatedConfig, settings);
    },
    [bookKey, updateBooknotes, saveConfig, envConfig, settings],
  );

  const addBookmarkAtTextTarget = useCallback(
    async (text: string): Promise<boolean> => {
      if (!view) return false;
      const fragment = text.split('#')[1] ?? null;
      if (!fragment) return false;
      const notes = getConfig(bookKey)?.booknotes ?? [];
      if (
        notes.some(
          (note) =>
            note.type === 'bookmark' && !note.deletedAt && fragmentFromCfi(note.cfi) === fragment,
        )
      ) {
        return true;
      }
      const resolved = view.resolveNavigation(text);
      if (!resolved || resolved.index < 0) return false;
      const rendered = view.renderer
        .getContents()
        .find((content) => content.index === resolved.index)?.doc;
      const section = view.book?.sections?.[resolved.index] as
        | { createDocument?: () => Promise<Document> }
        | undefined;
      const doc = rendered ?? (await section?.createDocument?.());
      if (!doc) return false;
      const anchored = resolved.anchor?.(doc) as unknown;
      let range: Range | null = null;
      let el: Element | null = null;
      if (anchored && typeof (anchored as Node).nodeType === 'number') {
        const node = anchored as Node;
        el = node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null);
        if (el) {
          range = doc.createRange();
          range.selectNodeContents(el);
        }
      } else if (anchored && (anchored as Range).commonAncestorContainer) {
        range = anchored as Range;
        const node = range.commonAncestorContainer;
        el = node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null);
      }
      if (!range || !el) return false;
      const now = Date.now();
      persistBooknotes([
        ...notes,
        {
          id: uniqueId(),
          type: 'bookmark',
          cfi: view.getCFI(resolved.index, range),
          text: (el.textContent ?? '').slice(0, 128),
          note: '',
          createdAt: now,
          updatedAt: now,
        },
      ]);
      return true;
    },
    [view, getConfig, bookKey, persistBooknotes],
  );
  addBookmarkAtTextTargetRef.current = addBookmarkAtTextTarget;

  const toggleBookmark = useCallback(() => {
    const activeSection = isNativePlayback ? sectionIndex : (engine?.activeSectionIndex ?? -1);
    if (!view || !engine || activeSection < 0) return;
    const text = lastHighlightTextRef.current;
    if (!text) return;
    const fragment = text.split('#')[1] ?? null;
    const notes = getConfig(bookKey)?.booknotes ?? [];
    const existing = notes.find(
      (n) => n.type === 'bookmark' && !n.deletedAt && fragmentFromCfi(n.cfi) === fragment,
    );
    if (existing) {
      existing.deletedAt = Date.now();
      existing.updatedAt = Date.now();
      persistBooknotes(notes);
      return;
    }
    if (isNativePlayback) void controlPlayback({ action: 'addBookmark' });
    void addBookmarkAtTextTarget(text);
  }, [
    view,
    engine,
    bookKey,
    getConfig,
    persistBooknotes,
    addBookmarkAtTextTarget,
    isNativePlayback,
    sectionIndex,
    controlPlayback,
  ]);

  const addCurrentBookmark = useCallback(() => {
    if (isNativePlayback) void controlPlayback({ action: 'addBookmark' });
    const text = lastHighlightTextRef.current;
    if (text) void addBookmarkAtTextTarget(text);
  }, [addBookmarkAtTextTarget, isNativePlayback, controlPlayback]);

  const deleteBookmark = useCallback(
    (id: string) => {
      const notes = getConfig(bookKey)?.booknotes ?? [];
      const target = notes.find((n) => n.id === id);
      if (!target) return;
      target.deletedAt = Date.now();
      target.updatedAt = Date.now();
      persistBooknotes(notes);
    },
    [bookKey, getConfig, persistBooknotes],
  );

  const jumpToBookmark = useCallback(
    (bookmark: AudiobookBookmark) => {
      if (!engine || bookmark.fragment == null || bookmark.sectionIndex < 0) return;
      if (!isActive(stateRef.current)) dispatch('PLAY');
      setFollowSuspended(false);
      manualNavAtRef.current = Date.now();
      if (isNativePlayback) {
        const book = getBookData(bookKey)?.book;
        if (!book) return;
        void (async () => {
          const offset = await engine.textOffset(bookmark.sectionIndex, bookmark.fragment!);
          if (offset == null) return;
          const location = createMediaOverlayLocation({
            editionId: book.hash,
            manifest: await getPlaybackManifest(),
            sectionIndex: bookmark.sectionIndex,
            sectionOffset: offset,
            title: chapters.find((chapter) => chapter.sectionIndex === bookmark.sectionIndex)
              ?.label,
          });
          if (location) await controlPlayback({ action: 'seekToLocator', location });
        })();
        return;
      }
      void engine.playFromText(bookmark.sectionIndex, bookmark.fragment).then((matched) => {
        if (matched) syncPosition();
      });
    },
    [
      engine,
      dispatch,
      syncPosition,
      isNativePlayback,
      getBookData,
      bookKey,
      getPlaybackManifest,
      chapters,
      controlPlayback,
    ],
  );

  // ── Media session: lock-screen / notification / headphone transport. The
  // handlers live behind a ref so the OS-facing registration happens once
  // per active playback period while always driving the freshest callbacks.
  const sessionActionsRef = useRef({
    play: () => {},
    pause: () => {},
    nextChapter: () => {},
    prevChapter: () => {},
    seekBy: (_seconds: number) => {},
    seekToChapterTime: (_seconds: number) => {},
    setRate: (_rate: number) => {},
    cycleRate: () => {},
    bookmark: () => {},
    skipForwardSec: 30,
    skipBackSec: 15,
  });
  sessionActionsRef.current = {
    play: () => void play(),
    pause,
    nextChapter,
    prevChapter,
    seekBy: (seconds: number) => withActiveEngine((e) => void e.seekRelative(seconds)),
    seekToChapterTime,
    setRate,
    cycleRate,
    bookmark: addCurrentBookmark,
    skipForwardSec: viewSettings?.moSkipForwardSec ?? 30,
    skipBackSec: viewSettings?.moSkipBackSec ?? 15,
  };

  const sessionActive = isActive(state);
  const total = timeline.isComplete ? timeline.total : null;
  const chapterDuration = timeline.sectionDuration(sectionIndex);
  const chapterLabel = chapters.find((c) => c.sectionIndex === sectionIndex)?.label ?? '';
  const author = bookData?.book?.author ?? '';
  const coverImageUrl = bookData?.book?.coverImageUrl ?? null;

  useEffect(() => {
    if (!sessionActive || isNativePlayback) return;
    const session = getMediaSession();
    if (!session) return;
    const actions = sessionActionsRef;

    if (session instanceof TauriMediaSession) {
      void session.setActive({
        active: true,
        keepAppInForeground: settings.alwaysInForeground,
        notificationTitle: bookData?.book?.title ?? '',
        notificationText: chapterLabel,
      });
      session.setActionHandler('play', () => actions.current.play());
      session.setActionHandler('pause', () => actions.current.pause());
      session.setActionHandler('nexttrack', () => actions.current.nextChapter());
      session.setActionHandler('previoustrack', () => actions.current.prevChapter());
      session.setActionHandler('seekto', (positionMs: number) =>
        actions.current.seekToChapterTime(positionMs / 1000),
      );
      session.setActionHandler('seekrelative', (seconds: number) =>
        actions.current.seekBy(seconds),
      );
      session.setActionHandler('setrate', (rate: number) => actions.current.setRate(rate));
      session.setActionHandler('bookmark', () => actions.current.bookmark());
      return () => {
        for (const action of [
          'play',
          'pause',
          'nexttrack',
          'previoustrack',
          'seekto',
          'seekrelative',
          'setrate',
          'bookmark',
        ]) {
          session.setActionHandler(action, null);
        }
        void session.setActive({ active: false, keepAppInForeground: settings.alwaysInForeground });
      };
    }

    const ms = session as MediaSession;
    ms.setActionHandler('play', () => actions.current.play());
    ms.setActionHandler('pause', () => actions.current.pause());
    ms.setActionHandler('nexttrack', () => actions.current.nextChapter());
    ms.setActionHandler('previoustrack', () => actions.current.prevChapter());
    ms.setActionHandler('seekforward', (details) =>
      actions.current.seekBy(details?.seekOffset ?? actions.current.skipForwardSec),
    );
    ms.setActionHandler('seekbackward', (details) =>
      actions.current.seekBy(-(details?.seekOffset ?? actions.current.skipBackSec)),
    );
    ms.setActionHandler('seekto', (details) => {
      if (typeof details?.seekTime === 'number')
        actions.current.seekToChapterTime(details.seekTime);
    });
    return () => {
      const sessionActions: MediaSessionAction[] = [
        'play',
        'pause',
        'nexttrack',
        'previoustrack',
        'seekforward',
        'seekbackward',
        'seekto',
      ];
      for (const action of sessionActions) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // Some engines reject actions they never supported; ignore.
        }
      }
      ms.metadata = null;
      ms.playbackState = 'none';
      try {
        ms.setPositionState?.();
      } catch {
        // Clearing position state is best-effort.
      }
    };
    // The registration is intentionally scoped to the active period only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionActive, settings.alwaysInForeground, isNativePlayback]);

  // Advertised metadata follows the book and playing chapter.
  useEffect(() => {
    if (!sessionActive || isNativePlayback) return;
    const session = getMediaSession();
    if (!session) return;
    const title = bookData?.book?.title ?? '';
    if (session instanceof TauriMediaSession) {
      let cancelled = false;
      void (async () => {
        let artwork: string | undefined;
        try {
          artwork = await fetchImageAsBase64(coverImageUrl || '/icon.png');
        } catch {
          artwork = undefined;
        }
        if (cancelled) return;
        void session.updateMetadata({ title, artist: author, album: chapterLabel, artwork });
      })();
      return () => {
        cancelled = true;
      };
    }
    const ms = session as MediaSession;
    ms.metadata = new MediaMetadata({
      title,
      artist: author,
      album: chapterLabel,
      artwork: [{ src: coverImageUrl || '/icon.png' }],
    });
    return undefined;
  }, [sessionActive, bookData, author, chapterLabel, coverImageUrl, isNativePlayback]);

  // Playback + chapter-scoped position state (matching the in-app player,
  // PRD §5.1), refreshed with the position poll.
  useEffect(() => {
    if (!sessionActive || isNativePlayback) return;
    const session = getMediaSession();
    if (!session) return;
    if (session instanceof TauriMediaSession) {
      void session.updatePlaybackState({
        playing: state === 'playing' || state === 'loading',
        position: Math.round(chapterElapsed * 1000),
        duration: chapterDuration > 0 ? Math.round(chapterDuration * 1000) : undefined,
        playbackRate: viewSettings?.moPlaybackRate ?? 1,
      });
      return;
    }
    const ms = session as MediaSession;
    ms.playbackState = state === 'playing' || state === 'loading' ? 'playing' : 'paused';
    if (Number.isFinite(chapterDuration) && chapterDuration > 0) {
      try {
        ms.setPositionState?.({
          duration: chapterDuration,
          position: Math.min(Math.max(0, chapterElapsed), chapterDuration),
          playbackRate: viewSettings?.moPlaybackRate ?? 1,
        });
      } catch {
        // Invalid transient values must never break playback.
      }
    }
  }, [
    sessionActive,
    state,
    chapterElapsed,
    chapterDuration,
    viewSettings?.moPlaybackRate,
    isNativePlayback,
  ]);

  useEffect(() => {
    if (!isAvailable || isNativePlayback) return;
    let listeners: Awaited<ReturnType<typeof listenCarControlIntents>> = [];
    void listenCarControlIntents({ cycleRate, bookmark: addCurrentBookmark }).then((registered) => {
      listeners = registered;
    });
    return () => {
      for (const listener of listeners) void listener.unregister();
    };
  }, [isAvailable, cycleRate, addCurrentBookmark, isNativePlayback]);

  useEffect(() => {
    if (!isAvailable || !view) return;
    const bookHash = bookKey.split('-')[0]!;
    void takePendingBookmarksFromCar(bookHash).then(async (locations) => {
      for (const location of locations) {
        if (location.editionId !== bookHash || !location.textLocator) continue;
        const fragment = location.textLocator.locations.fragments[0];
        if (!fragment) continue;
        await addBookmarkAtTextTarget(`${location.textLocator.href}#${fragment}`);
      }
    });
  }, [isAvailable, view, bookKey, addBookmarkAtTextTarget]);

  // ── Car bridge (CarPlay / Android Auto): serve the chapter list for the
  // open book and honor head-unit play requests.
  const playFromCarIntent = useCallback(
    (intent: CarPlayIntent) => {
      if (!engine || isNativePlayback) return;
      dispatch('PLAY');
      void controlPlayback({
        action: 'setRate',
        rate: viewSettings?.moPlaybackRate ?? 1,
      });
      manualNavAtRef.current = Date.now();
      if (typeof intent.chapterIndex === 'number') {
        const bookId = getBookData(bookKey)?.book?.hash;
        if (bookId) {
          void controlPlayback({
            action: 'startChapter',
            bookId,
            chapterIndex: intent.chapterIndex,
          }).catch(() => dispatch('ERROR'));
        }
      } else {
        void play();
      }
    },
    [engine, viewSettings, dispatch, play, isNativePlayback, controlPlayback, getBookData, bookKey],
  );

  useEffect(() => {
    if (!isAvailable || isNativePlayback) return;
    const bookHash = bookKey.split('-')[0]!;
    const pending = consumePendingCarPlayIntent(bookHash);
    if (pending) playFromCarIntent(pending);
    const onCarPlay = (event: CustomEvent<CarPlayIntent>) => {
      if (event.detail?.bookId === bookHash) {
        consumePendingCarPlayIntent(bookHash);
        playFromCarIntent(event.detail);
      }
    };
    eventDispatcher.on('car-audiobook-play', onCarPlay);
    return () => {
      eventDispatcher.off('car-audiobook-play', onCarPlay);
    };
  }, [isAvailable, bookKey, playFromCarIntent, isNativePlayback]);

  useEffect(() => {
    if (!isAvailable || chapters.length === 0) return;
    const bookHash = bookKey.split('-')[0]!;
    void pushChaptersToCar(buildBridgeChapters(bookHash, chapters, sectionIndex));
  }, [isAvailable, bookKey, chapters, sectionIndex]);

  useEffect(() => {
    const book = bookData?.book;
    if (!isAvailable || !appService || !book || !engine || chapters.length === 0) return;
    const bridgeChapters = buildBridgeChapters(book.hash, chapters, sectionIndex).chapters;
    void prepareAndPushCarPlayback(appService, book, engine, bridgeChapters);
  }, [isAvailable, appService, bookData?.book, engine, chapters, sectionIndex]);

  const returnToPlaying = useCallback(() => {
    const activeSection = isNativePlayback ? sectionIndex : (engine?.activeSectionIndex ?? -1);
    if (!view || !engine || activeSection < 0) return;
    setFollowSuspended(false);
    const target = lastHighlightTextRef.current;
    if (target) view.goTo(target);
  }, [view, engine, isNativePlayback, sectionIndex]);

  return {
    isAvailable,
    state,
    title: bookData?.book?.title ?? '',
    sectionIndex,
    elapsed,
    total,
    chapterElapsed,
    chapterDuration,
    chapterLabel,
    chapters,
    rate: isNativePlayback
      ? (nativePlaybackRate ?? viewSettings?.moPlaybackRate ?? 1)
      : (viewSettings?.moPlaybackRate ?? 1),
    skipForwardSec: viewSettings?.moSkipForwardSec ?? 30,
    skipBackSec: viewSettings?.moSkipBackSec ?? 15,
    togglePlay,
    dismiss,
    skipForward,
    skipBack,
    prevChapter,
    nextChapter,
    seekToChapterTime,
    setRate,
    setSkipForwardSec: (sec: number) => persistViewSettings({ moSkipForwardSec: sec }),
    setSkipBackSec: (sec: number) => persistViewSettings({ moSkipBackSec: sec }),
    readAlongEnabled,
    highlightOptions,
    followSuspended,
    returnToPlaying,
    setReadAlongEnabled: (enabled: boolean) => {
      setFollowSuspended(false);
      persistViewSettings({ moReadAlongEnabled: enabled });
    },
    setHighlightOptions: (patch: Partial<TTSHighlightOptions>) =>
      persistViewSettings({ moHighlightOptions: { ...highlightOptions, ...patch } }, true),
    sleepTimerMode: sleepTimer.mode,
    sleepRemainingSec,
    setSleepTimer,
    extendSleepTimer,
    bookmarks: bookmarkEntries,
    isCurrentBookmarked,
    toggleBookmark,
    deleteBookmark,
    jumpToBookmark,
  };
};
