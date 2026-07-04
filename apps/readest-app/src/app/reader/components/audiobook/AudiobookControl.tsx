import React, { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useAudiobookStore } from '@/store/audiobookStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { Insets } from '@/types/misc';
import { useAudiobookControl } from '../../hooks/useAudiobookControl';
import AudiobookFullScreen from './AudiobookFullScreen';
import AudiobookMiniBar from './AudiobookMiniBar';
import AudiobookPlayer, { SPEED_PRESETS } from './AudiobookPlayer';

interface AudiobookControlProps {
  bookKey: string;
  gridInsets: Insets;
  onGoToLibrary: () => void;
}

/**
 * Mounts the audiobook surfaces for books with an audio track (v2 PRD §5):
 * the docked tray of the combined view, the fullscreen player it expands
 * into (default for audio-only books), or nothing while the tray is
 * dismissed — playback state lives in the hook, so switching surfaces never
 * interrupts audio.
 */
const AudiobookControl: React.FC<AudiobookControlProps> = ({
  bookKey,
  gridInsets,
  onGoToLibrary,
}) => {
  const { appService } = useEnv();
  const { getBookData, getConfig, setConfig } = useBookDataStore();
  const { setSideBarVisible } = useSidebarStore();
  const audiobook = useAudiobookControl(bookKey);
  const book = getBookData(bookKey)?.book;
  const isAudioOnly = !!book?.isAudioOnly;

  const trayCollapsed = useAudiobookStore((state) => state.trayCollapsed[bookKey] ?? false);
  const expanded = useAudiobookStore((state) => state.playerExpanded[bookKey] ?? isAudioOnly);
  const setAvailable = useAudiobookStore((state) => state.setAvailable);
  const setPlaybackState = useAudiobookStore((state) => state.setPlaybackState);
  const setPlayerExpanded = useAudiobookStore((state) => state.setPlayerExpanded);
  const setTrayCollapsed = useAudiobookStore((state) => state.setTrayCollapsed);

  // Mirror availability/playback into the store for the footer-bar toggle.
  const { isAvailable, state: playbackState } = audiobook;
  useEffect(() => {
    setAvailable(bookKey, isAvailable);
    return () => setAvailable(bookKey, false);
  }, [bookKey, isAvailable, setAvailable]);
  useEffect(() => {
    setPlaybackState(bookKey, playbackState);
  }, [bookKey, playbackState, setPlaybackState]);

  if (!audiobook.isAvailable || !book) return null;

  const cycleRate = () => {
    const next = SPEED_PRESETS.find((preset) => preset > audiobook.rate + 0.001) ?? 0.75;
    audiobook.setRate(next);
  };

  // PRD §5.5: one chapter navigation — drop to the tray and open the
  // ebook TOC sidebar (TOC jumps move the audio while a session is active).
  const showChapters = () => {
    setPlayerExpanded(bookKey, false);
    const config = getConfig(bookKey);
    if (config?.viewSettings) {
      setConfig(bookKey, { viewSettings: { ...config.viewSettings, sideBarTab: 'toc' } });
    }
    setSideBarVisible(true);
  };

  if (expanded) {
    return (
      <AudiobookFullScreen
        book={book}
        gridInsets={gridInsets}
        onGoToLibrary={isAudioOnly ? onGoToLibrary : undefined}
      >
        <AudiobookPlayer
          state={audiobook.state}
          title={audiobook.chapterLabel || audiobook.title}
          elapsed={audiobook.elapsed}
          total={audiobook.total}
          chapterElapsed={audiobook.chapterElapsed}
          chapterDuration={audiobook.chapterDuration}
          rate={audiobook.rate}
          skipForwardSec={audiobook.skipForwardSec}
          skipBackSec={audiobook.skipBackSec}
          readAlongEnabled={audiobook.readAlongEnabled}
          highlightOptions={audiobook.highlightOptions}
          sleepTimerMode={audiobook.sleepTimerMode}
          sleepRemainingSec={audiobook.sleepRemainingSec}
          bookmarks={audiobook.bookmarks}
          isCurrentBookmarked={audiobook.isCurrentBookmarked}
          onTogglePlay={audiobook.togglePlay}
          onSkipForward={audiobook.skipForward}
          onSkipBack={audiobook.skipBack}
          onPrevChapter={audiobook.prevChapter}
          onNextChapter={audiobook.nextChapter}
          onShowChapters={showChapters}
          onSeekToChapterTime={audiobook.seekToChapterTime}
          onCycleRate={cycleRate}
          onSetRate={audiobook.setRate}
          onSetSkipForwardSec={audiobook.setSkipForwardSec}
          onSetSkipBackSec={audiobook.setSkipBackSec}
          onSetReadAlong={audiobook.setReadAlongEnabled}
          onSetHighlightOptions={audiobook.setHighlightOptions}
          onSetSleepTimer={audiobook.setSleepTimer}
          onExtendSleepTimer={audiobook.extendSleepTimer}
          onToggleBookmark={audiobook.toggleBookmark}
          onDeleteBookmark={audiobook.deleteBookmark}
          onJumpToBookmark={audiobook.jumpToBookmark}
          onClose={() => setPlayerExpanded(bookKey, false)}
        />
      </AudiobookFullScreen>
    );
  }

  if (trayCollapsed) return null;

  const bottomInset = appService?.hasSafeAreaInset ? Math.round(gridInsets.bottom * 0.33) : 0;

  return (
    <AudiobookMiniBar
      state={audiobook.state}
      title={audiobook.title}
      elapsed={audiobook.elapsed}
      total={audiobook.total}
      rate={audiobook.rate}
      bottomInset={bottomInset}
      followSuspended={audiobook.followSuspended}
      onTogglePlay={audiobook.togglePlay}
      onSkipForward={audiobook.skipForward}
      onCycleRate={cycleRate}
      onReturnToPlaying={audiobook.returnToPlaying}
      onExpand={() => setPlayerExpanded(bookKey, true)}
      onDismiss={() => setTrayCollapsed(bookKey, true)}
    />
  );
};

export default AudiobookControl;
