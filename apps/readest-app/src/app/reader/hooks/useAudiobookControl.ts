import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
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
  pushChaptersToCar,
  type CarPlayIntent,
} from '@/services/audiobook/carBridge';
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
import { eventDispatcher } from '@/utils/event';

const POSITION_POLL_MS = 500;
const POSITION_SAVE_MS = 10_000;
/** Below this offset, "previous chapter" jumps back; above it, it restarts. */
const CHAPTER_RESTART_THRESHOLD_SEC = 3;

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
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, setConfig, saveConfig, getBookData, updateBooknotes } = useBookDataStore();
  const { updateBook } = useLibraryStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();

  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const engine = view?.mediaOverlay ?? null;
  const isAvailable = Boolean(bookData?.book?.hasAudio) && Boolean(engine);
  const readAlongEnabled = viewSettings?.moReadAlongEnabled ?? true;
  const highlightOptions =
    viewSettings?.moHighlightOptions ?? DEFAULT_MEDIA_OVERLAY_CONFIG.moHighlightOptions;

  const [state, setState] = useState<AudiobookPlaybackState>('stopped');
  const [sectionIndex, setSectionIndex] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [chapterElapsed, setChapterElapsed] = useState(0);
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
  const tapWiredDocsRef = useRef(new WeakSet<Document>());
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

  const chapters = useMemo<AudiobookChapter[]>(() => {
    if (!view?.book?.toc) return [];
    const seen = new Set<number>();
    const items: AudiobookChapter[] = [];
    for (const tocItem of view.book.toc) {
      if (!tocItem.href) continue;
      const resolved = view.resolveNavigation(tocItem.href);
      const index = resolved?.index ?? -1;
      if (index >= 0 && !seen.has(index)) {
        seen.add(index);
        items.push({ label: tocItem.label, sectionIndex: index });
      }
    }
    return items;
  }, [view]);

  const syncPosition = useCallback(() => {
    if (!engine) return;
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
        engine.pause();
        dispatch('PAUSE');
        setSleepTimerState(CLEARED_TIMER);
        setSleepRemainingSec(null);
      }
    }
    prevSectionRef.current = index;
  }, [engine, timeline, dispatch]);

  const saveLocation = useCallback(() => {
    if (!engine || engine.activeSectionIndex < 0) return;
    const config = getConfig(bookKey);
    if (!config) return;
    const location: MediaOverlayLocation = {
      sectionIndex: engine.activeSectionIndex,
      offset: engine.sectionOffset,
      updatedAt: Date.now(),
    };
    setConfig(bookKey, { mediaOverlayLocation: location });
    const updated = getConfig(bookKey);
    if (updated) saveConfig(envConfig, bookKey, updated, settings);
    // Denormalize onto the library record so the Continue Listening strip
    // can show time-left without loading per-book configs.
    const book = getBookData(bookKey)?.book;
    if (book) {
      void updateBook(envConfig, {
        ...book,
        audioPosition: timeline.elapsed(location.sectionIndex, location.offset),
        updatedAt: Date.now(),
      });
    }
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
  ]);

  // Engine events → machine. `highlight` doubles as the "audio is live"
  // confirmation; the machine ignores it outside of `loading`.
  useEffect(() => {
    if (!engine) return;
    const onHighlight = (e: Event) => {
      lastHighlightTextRef.current =
        ((e as CustomEvent).detail as { text?: string } | undefined)?.text ?? null;
      dispatch('STARTED');
      syncPosition();
    };
    const onEnded = () => {
      dispatch('ENDED');
      setFollowSuspended(false);
      saveLocation();
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
    engine.addEventListener('ended', onEnded);
    engine.addEventListener('error', onError);
    return () => {
      engine.removeEventListener('highlight', onHighlight);
      engine.removeEventListener('ended', onEnded);
      engine.removeEventListener('error', onError);
    };
  }, [engine, dispatch, saveLocation, syncPosition, _]);

  // Live position + periodic save while playing.
  useEffect(() => {
    if (state !== 'playing') return;
    syncPosition();
    let sinceSave = 0;
    const timer = setInterval(() => {
      syncPosition();
      sinceSave += POSITION_POLL_MS;
      if (sinceSave >= POSITION_SAVE_MS) {
        sinceSave = 0;
        saveLocation();
      }
    }, POSITION_POLL_MS);
    return () => clearInterval(timer);
  }, [state, syncPosition, saveLocation]);

  // Never lose the position: save when the page hides or the reader unmounts.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isActive(stateRef.current)) saveLocation();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (isActive(stateRef.current)) saveLocation();
    };
  }, [saveLocation]);

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
      void engine.start(index);
    };
    eventDispatcher.on('navigate', onNavigate);
    return () => eventDispatcher.off('navigate', onNavigate);
  }, [engine, view, bookKey]);

  // Before any playback, surface the saved (or first) audio chapter so the
  // chapter-scoped scrubber and clocks have a timeline to show (PRD §5.1).
  useEffect(() => {
    if (!engine || !view || sectionIndex >= 0) return;
    const saved = getConfig(bookKey)?.mediaOverlayLocation;
    const sections = view.book?.sections ?? [];
    const firstOverlay = sections.findIndex((section) => section.mediaOverlay);
    const index = saved?.sectionIndex ?? firstOverlay;
    if (index == null || index < 0) return;
    const offset = saved?.offset ?? 0;
    setSectionIndex(index);
    setChapterElapsed(offset);
    setElapsed(timeline.elapsed(index, offset));
  }, [engine, view, sectionIndex, bookKey, getConfig, timeline]);

  // Read-along control: the view applies the highlight class and follows the
  // audio only while read-along is on and the user hasn't wandered off.
  useEffect(() => {
    if (!view) return;
    view.mediaOverlayHighlightEnabled = readAlongEnabled;
    view.mediaOverlayFollowEnabled = readAlongEnabled && !followSuspended;
  }, [view, readAlongEnabled, followSuspended]);

  // A relocate into a section other than the one playing is the reader
  // wandering off (media-overlay navigation always lands on the playing
  // section) — stop dragging them back until they ask to return.
  useEffect(() => {
    if (!view || !engine) return;
    const onRelocate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { section?: { current?: number } } | undefined;
      const current = detail?.section?.current;
      if (typeof current !== 'number') return;
      if (!isActive(stateRef.current) || engine.activeSectionIndex < 0) return;
      // A deliberate jump (TOC, transport) is in flight: the audio is moving
      // to this section, so landing here is not the reader wandering off.
      if (Date.now() - manualNavAtRef.current < 1200) return;
      if (current !== engine.activeSectionIndex) {
        // Flip the view flag synchronously: waiting for the React effect
        // loses the race against the next highlight's navigation.
        view.mediaOverlayFollowEnabled = false;
        setFollowSuspended(true);
      }
    };
    view.addEventListener('relocate', onRelocate);
    return () => view.removeEventListener('relocate', onRelocate);
  }, [view, engine]);

  // Tap-to-seek: a tap on (or inside) a SMIL text target jumps the audio
  // there. Section documents live in iframes and can outlive this effect, so
  // each doc is wired at most once and stale listeners die with their doc.
  useEffect(() => {
    if (!view || !engine) return;
    const wireDoc = (doc: Document | undefined, index: number) => {
      if (!doc?.addEventListener || index < 0 || tapWiredDocsRef.current.has(doc)) return;
      tapWiredDocsRef.current.add(doc);
      doc.addEventListener('click', (ev) => {
        if (!isActive(stateRef.current)) return;
        const fragment = findTapFragment(ev.target);
        if (!fragment) return;
        void engine.playFromText(index, fragment).then((matched) => {
          if (matched) {
            setFollowSuspended(false);
            syncPosition();
          }
        });
      });
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
    return () => view.removeEventListener('load', onLoad);
  }, [view, engine, syncPosition]);

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
      if (sleepTimerRef.current.mode?.type !== 'duration' || !engine) return;
      if (isExpired(sleepTimerRef.current, now)) {
        if (isActive(stateRef.current)) {
          engine.pause();
          dispatch('PAUSE');
          saveLocation();
        }
        engine.setVolume(1);
        setSleepTimerState(CLEARED_TIMER);
        setSleepRemainingSec(null);
      } else {
        engine.setVolume(fadeVolume(sleepTimerRef.current, now));
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [sleepTimer.mode, engine, dispatch, saveLocation]);

  const setSleepTimer = useCallback(
    (mode: SleepTimerMode | null) => {
      if (!mode) {
        engine?.setVolume(1);
        setSleepTimerState(CLEARED_TIMER);
        setSleepRemainingSec(null);
        return;
      }
      setSleepTimerState(startTimer(mode, Date.now()));
    },
    [engine],
  );

  const extendSleepTimer = useCallback((minutes: number) => {
    setSleepTimerState((prev) => (prev.mode ? extendTimer(prev, minutes, Date.now()) : prev));
  }, []);

  const play = useCallback(async () => {
    if (!engine || !view) return;
    const current = stateRef.current;
    if (current === 'playing' || current === 'loading') return;
    if (current === 'paused') {
      engine.resume();
      dispatch('PLAY');
      return;
    }
    const restarting = current === 'ended';
    dispatch('PLAY');
    engine.setRate(viewSettings?.moPlaybackRate ?? 1);
    const saved = restarting ? undefined : getConfig(bookKey)?.mediaOverlayLocation;
    const sectionCount = view.book?.sections?.length ?? 0;
    try {
      if (saved && saved.sectionIndex >= 0 && saved.sectionIndex < sectionCount) {
        await engine.startAtOffset(saved.sectionIndex, saved.offset);
      } else if (restarting) {
        await engine.start(0);
      } else {
        await (view.startMediaOverlay ? view.startMediaOverlay() : engine.start(0));
      }
    } catch (error) {
      console.error('audiobook playback failed to start', error);
      dispatch('ERROR');
    }
  }, [engine, view, bookKey, getConfig, viewSettings, dispatch]);

  const pause = useCallback(() => {
    if (!engine) return;
    engine.pause();
    dispatch('PAUSE');
    saveLocation();
  }, [engine, dispatch, saveLocation]);

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
    withActiveEngine((e) => void e.seekRelative(viewSettings?.moSkipForwardSec ?? 30));
  }, [withActiveEngine, viewSettings]);

  const skipBack = useCallback(() => {
    withActiveEngine((e) => void e.seekRelative(-(viewSettings?.moSkipBackSec ?? 15)));
  }, [withActiveEngine, viewSettings]);

  const adjacentOverlaySection = useCallback(
    (from: number, step: 1 | -1): number | null => {
      const sections = view?.book?.sections ?? [];
      for (let i = from + step; i >= 0 && i < sections.length; i += step) {
        if (sections[i]?.mediaOverlay) return i;
      }
      return null;
    },
    [view],
  );

  const nextChapter = useCallback(() => {
    setFollowSuspended(false);
    withActiveEngine((e) => {
      const next = adjacentOverlaySection(e.activeSectionIndex, 1);
      // Past the last chapter counts as finishing the book.
      void e.start(next ?? view?.book?.sections?.length ?? 0);
    });
  }, [withActiveEngine, adjacentOverlaySection, view]);

  const prevChapter = useCallback(() => {
    setFollowSuspended(false);
    withActiveEngine((e) => {
      if (e.sectionOffset > CHAPTER_RESTART_THRESHOLD_SEC) {
        void e.startAtOffset(e.activeSectionIndex, 0);
      } else {
        const prev = adjacentOverlaySection(e.activeSectionIndex, -1);
        void (prev == null ? e.startAtOffset(e.activeSectionIndex, 0) : e.start(prev));
      }
    });
  }, [withActiveEngine, adjacentOverlaySection]);

  // PRD §5.1: the scrubber is chapter-scoped — seeks land within the
  // playing chapter.
  const seekToChapterTime = useCallback(
    (seconds: number) => {
      setFollowSuspended(false);
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
    [withActiveEngine, timeline],
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
      engine?.setRate(rate);
      persistViewSettings({ moPlaybackRate: rate });
    },
    [engine, persistViewSettings],
  );

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

  const toggleBookmark = useCallback(() => {
    if (!view || !engine || engine.activeSectionIndex < 0) return;
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
    const resolved = view.resolveNavigation(text);
    if (!resolved || resolved.index < 0) return;
    const doc = view.renderer.getContents().find((c) => c.index === resolved.index)?.doc;
    if (!doc) return;
    // The anchor yields either the target element or a Range, depending on
    // the navigation kind; normalize to both shapes.
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
    if (!range || !el) return;
    const snippet = (el.textContent ?? '').slice(0, 128);
    const bookmark: BookNote = {
      id: uniqueId(),
      type: 'bookmark',
      cfi: view.getCFI(resolved.index, range),
      text: snippet,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    persistBooknotes([...notes, bookmark]);
  }, [view, engine, bookKey, getConfig, persistBooknotes]);

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
      void engine.playFromText(bookmark.sectionIndex, bookmark.fragment).then((matched) => {
        if (matched) syncPosition();
      });
    },
    [engine, dispatch, syncPosition],
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
    if (!sessionActive) return;
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
      return () => {
        for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto']) {
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
  }, [sessionActive, settings.alwaysInForeground]);

  // Advertised metadata follows the book and playing chapter.
  useEffect(() => {
    if (!sessionActive) return;
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
  }, [sessionActive, bookData, author, chapterLabel, coverImageUrl]);

  // Playback + chapter-scoped position state (matching the in-app player,
  // PRD §5.1), refreshed with the position poll.
  useEffect(() => {
    if (!sessionActive) return;
    const session = getMediaSession();
    if (!session) return;
    if (session instanceof TauriMediaSession) {
      void session.updatePlaybackState({
        playing: state === 'playing' || state === 'loading',
        position: Math.round(chapterElapsed * 1000),
        duration: chapterDuration > 0 ? Math.round(chapterDuration * 1000) : undefined,
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
  }, [sessionActive, state, chapterElapsed, chapterDuration, viewSettings?.moPlaybackRate]);

  // ── Car bridge (CarPlay / Android Auto): serve the chapter list for the
  // open book and honor head-unit play requests.
  const playFromCarIntent = useCallback(
    (intent: CarPlayIntent) => {
      if (!engine) return;
      dispatch('PLAY');
      engine.setRate(viewSettings?.moPlaybackRate ?? 1);
      manualNavAtRef.current = Date.now();
      if (typeof intent.chapterIndex === 'number') {
        void engine.start(intent.chapterIndex).catch(() => dispatch('ERROR'));
      } else {
        void play();
      }
    },
    [engine, viewSettings, dispatch, play],
  );

  useEffect(() => {
    if (!isAvailable) return;
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
  }, [isAvailable, bookKey, playFromCarIntent]);

  useEffect(() => {
    if (!isAvailable || chapters.length === 0) return;
    const bookHash = bookKey.split('-')[0]!;
    void pushChaptersToCar(buildBridgeChapters(bookHash, chapters, sectionIndex));
  }, [isAvailable, bookKey, chapters, sectionIndex]);

  const returnToPlaying = useCallback(() => {
    if (!view || !engine || engine.activeSectionIndex < 0) return;
    setFollowSuspended(false);
    const target = lastHighlightTextRef.current;
    if (target) view.goTo(target);
  }, [view, engine]);

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
    rate: viewSettings?.moPlaybackRate ?? 1,
    skipForwardSec: viewSettings?.moSkipForwardSec ?? 30,
    skipBackSec: viewSettings?.moSkipBackSec ?? 15,
    togglePlay,
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
