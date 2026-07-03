import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { Insets } from '@/types/misc';
import { useAudiobookControl } from '../../hooks/useAudiobookControl';
import AudiobookMiniBar from './AudiobookMiniBar';
import AudiobookPlayer from './AudiobookPlayer';

interface AudiobookControlProps {
  bookKey: string;
  gridInsets: Insets;
  /**
   * 'overlay' (default) floats a mini bar + expandable bottom sheet over the
   * reader; 'fullscreen' embeds the always-open player into a parent screen.
   */
  variant?: 'overlay' | 'fullscreen';
}

/**
 * Mounts the audiobook player surfaces for books with EPUB3 Media Overlays:
 * a persistent mini bar and an expandable full player.
 */
const AudiobookControl: React.FC<AudiobookControlProps> = ({
  bookKey,
  gridInsets,
  variant = 'overlay',
}) => {
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const audiobook = useAudiobookControl(bookKey);
  const [expanded, setExpanded] = useState(false);
  const fullscreen = variant === 'fullscreen';

  if (!audiobook.isAvailable) return null;
  // Audio-only books get their dedicated screen; the floating overlay would
  // duplicate the same controls on top of it.
  if (!fullscreen && getBookData(bookKey)?.book?.isAudioOnly) return null;

  const bottomInset = appService?.hasSafeAreaInset ? Math.round(gridInsets.bottom * 0.33) : 0;

  return (
    <>
      {!fullscreen && !expanded && (
        <AudiobookMiniBar
          state={audiobook.state}
          title={audiobook.title}
          elapsed={audiobook.elapsed}
          total={audiobook.total}
          bottomInset={bottomInset}
          followSuspended={audiobook.followSuspended}
          onTogglePlay={audiobook.togglePlay}
          onReturnToPlaying={audiobook.returnToPlaying}
          onExpand={() => setExpanded(true)}
        />
      )}
      {(fullscreen || expanded) && (
        <AudiobookPlayer
          fullscreen={fullscreen}
          state={audiobook.state}
          title={audiobook.title}
          elapsed={audiobook.elapsed}
          total={audiobook.total}
          sectionIndex={audiobook.sectionIndex}
          chapters={audiobook.chapters}
          rate={audiobook.rate}
          skipForwardSec={audiobook.skipForwardSec}
          skipBackSec={audiobook.skipBackSec}
          readAlongEnabled={audiobook.readAlongEnabled}
          highlightOptions={audiobook.highlightOptions}
          sleepTimerMode={audiobook.sleepTimerMode}
          sleepRemainingSec={audiobook.sleepRemainingSec}
          bookmarks={audiobook.bookmarks}
          isCurrentBookmarked={audiobook.isCurrentBookmarked}
          bottomInset={bottomInset}
          onTogglePlay={audiobook.togglePlay}
          onSkipForward={audiobook.skipForward}
          onSkipBack={audiobook.skipBack}
          onPrevChapter={audiobook.prevChapter}
          onNextChapter={audiobook.nextChapter}
          onGoToChapter={audiobook.goToChapter}
          onSeekToBookTime={audiobook.seekToBookTime}
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
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
};

export default AudiobookControl;
