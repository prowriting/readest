import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { buildBookTimeline } from '@/services/audiobook/bookTimeline';
import { DEFAULT_MEDIA_OVERLAY_CONFIG } from '@/services/constants';
import type { TTSHighlightOptions } from '@/services/tts';
import { findTapFragment } from '@/utils/audiobook';
import { getStyles } from '@/utils/style';
import {
  isActive,
  transition,
  type AudiobookPlaybackEvent,
  type AudiobookPlaybackState,
} from '@/services/audiobook/playbackMachine';
import type { MediaOverlayConfig, MediaOverlayLocation } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

const POSITION_POLL_MS = 500;
const POSITION_SAVE_MS = 10_000;
/** Below this offset, "previous chapter" jumps back; above it, it restarts. */
const CHAPTER_RESTART_THRESHOLD_SEC = 3;

export interface AudiobookChapter {
  label: string;
  sectionIndex: number;
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
  const { getConfig, setConfig, saveConfig, getBookData } = useBookDataStore();
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
  const [followSuspended, setFollowSuspended] = useState(false);
  const lastHighlightTextRef = useRef<string | null>(null);
  const tapWiredDocsRef = useRef(new WeakSet<Document>());
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
  }, [engine, timeline]);

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
  }, [engine, bookKey, getConfig, setConfig, saveConfig, envConfig, settings]);

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

  const goToChapter = useCallback(
    (index: number) => {
      setFollowSuspended(false);
      withActiveEngine((e) => void e.start(index));
    },
    [withActiveEngine],
  );

  const seekToBookTime = useCallback(
    (seconds: number) => {
      setFollowSuspended(false);
      withActiveEngine((e) => {
        const target = timeline.locate(seconds);
        setElapsed(timeline.elapsed(target.sectionIndex, target.offset));
        void e.startAtOffset(target.sectionIndex, target.offset);
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
    total: timeline.isComplete ? timeline.total : null,
    chapters,
    rate: viewSettings?.moPlaybackRate ?? 1,
    skipForwardSec: viewSettings?.moSkipForwardSec ?? 30,
    skipBackSec: viewSettings?.moSkipBackSec ?? 15,
    togglePlay,
    skipForward,
    skipBack,
    prevChapter,
    nextChapter,
    goToChapter,
    seekToBookTime,
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
  };
};
