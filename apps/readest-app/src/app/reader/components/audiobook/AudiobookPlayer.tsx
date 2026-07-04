import clsx from 'clsx';
import React, { useState } from 'react';
import {
  MdAirplay,
  MdBedtime,
  MdBookmark,
  MdDeleteOutline,
  MdKeyboardArrowDown,
  MdMoreHoriz,
  MdOutlineBookmarkAdd,
  MdOutlinePause,
  MdPlayArrow,
  MdReplay,
  MdSkipNext,
  MdSkipPrevious,
} from 'react-icons/md';
import { RiForward30Line, RiListUnordered, RiReplay15Line } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { formatPlaybackTime, formatTimeLeft } from '@/services/audiobook/bookTimeline';
import type { AudiobookPlaybackState } from '@/services/audiobook/playbackMachine';
import type { TTSHighlightOptions } from '@/services/tts';
import { DEFAULT_HIGHLIGHT_COLORS, type DefaultHighlightColor } from '@/types/book';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import type { SleepTimerMode } from '@/services/audiobook/sleepTimer';
import { audioRoutePickerAvailable, showAudioRoutePicker } from '@/services/audiobook/audioRoute';
import type { AudiobookBookmark, AudiobookChapter } from '../../hooks/useAudiobookControl';

const COLOR_NAMES: Record<DefaultHighlightColor, string> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  violet: 'Violet',
};

export const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2];
const SKIP_INTERVAL_OPTIONS = [10, 15, 30, 60];
const SLEEP_MINUTE_OPTIONS = [5, 15, 30, 60];
const SLEEP_EXTEND_MINUTES = 15;

type PlayerPanel = 'none' | 'chapters' | 'sleep' | 'settings';

interface AudiobookPlayerProps {
  state: AudiobookPlaybackState;
  /** Current chapter label (falls back to the book title). */
  title: string;
  elapsed: number;
  total: number | null;
  chapterElapsed: number;
  chapterDuration: number;
  sectionIndex: number;
  chapters: AudiobookChapter[];
  rate: number;
  skipForwardSec: number;
  skipBackSec: number;
  readAlongEnabled: boolean;
  highlightOptions: TTSHighlightOptions;
  sleepTimerMode: SleepTimerMode | null;
  sleepRemainingSec: number | null;
  bookmarks: AudiobookBookmark[];
  isCurrentBookmarked: boolean;
  onTogglePlay: () => void;
  onSkipForward: () => void;
  onSkipBack: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onGoToChapter: (sectionIndex: number) => void;
  onSeekToChapterTime: (seconds: number) => void;
  onCycleRate: () => void;
  onSetRate: (rate: number) => void;
  onSetSkipForwardSec: (sec: number) => void;
  onSetSkipBackSec: (sec: number) => void;
  onSetReadAlong: (enabled: boolean) => void;
  onSetHighlightOptions: (patch: Partial<TTSHighlightOptions>) => void;
  onSetSleepTimer: (mode: SleepTimerMode | null) => void;
  onExtendSleepTimer: (minutes: number) => void;
  onToggleBookmark: () => void;
  onDeleteBookmark: (id: string) => void;
  onJumpToBookmark: (bookmark: AudiobookBookmark) => void;
  onClose: () => void;
}

/**
 * Fullscreen player controls (PRD §5.1): top bar with chapter list, speed,
 * sleep timer, bookmark, overflow and minimize; chapter title; whole-book
 * time-left; a CHAPTER-scoped scrubber (elapsed / -remaining); transport.
 */
const AudiobookPlayer: React.FC<AudiobookPlayerProps> = ({
  state,
  title,
  elapsed,
  total,
  chapterElapsed,
  chapterDuration,
  sectionIndex,
  chapters,
  rate,
  skipForwardSec,
  skipBackSec,
  readAlongEnabled,
  highlightOptions,
  sleepTimerMode,
  sleepRemainingSec,
  bookmarks,
  isCurrentBookmarked,
  onTogglePlay,
  onSkipForward,
  onSkipBack,
  onPrevChapter,
  onNextChapter,
  onGoToChapter,
  onSeekToChapterTime,
  onCycleRate,
  onSetRate,
  onSetSkipForwardSec,
  onSetSkipBackSec,
  onSetReadAlong,
  onSetHighlightOptions,
  onSetSleepTimer,
  onExtendSleepTimer,
  onToggleBookmark,
  onDeleteBookmark,
  onJumpToBookmark,
  onClose,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(22);
  const playIconSize = useResponsiveSize(32);
  const [panel, setPanel] = useState<PlayerPanel>('none');
  const togglePanel = (next: Exclude<PlayerPanel, 'none'>) =>
    setPanel((current) => (current === next ? 'none' : next));
  const sleepValue =
    sleepTimerMode == null
      ? 'off'
      : sleepTimerMode.type === 'end-of-chapter'
        ? 'end-of-chapter'
        : String(sleepTimerMode.minutes);
  const isPlaying = state === 'playing' || state === 'loading';
  const bookRemaining = total != null ? Math.max(0, total - elapsed) : null;
  const chapterRemaining = Math.max(0, chapterDuration - chapterElapsed);

  return (
    <div
      role='dialog'
      aria-label={_('Audiobook Player')}
      className='bg-base-100 relative mx-auto flex w-full max-w-lg flex-col gap-3 p-4'
    >
      <div className='flex items-center justify-end gap-1'>
        <button
          type='button'
          className='btn btn-ghost btn-circle btn-sm eink-bordered'
          aria-label={_('Chapters')}
          title={_('Chapters')}
          onClick={() => togglePanel('chapters')}
        >
          <RiListUnordered size={iconSize} />
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-sm eink-bordered rounded-full px-2 tabular-nums'
          aria-label={_('Playback Speed')}
          title={_('Playback Speed')}
          onClick={onCycleRate}
        >
          {Number(rate.toFixed(2))}×
        </button>
        <button
          type='button'
          className={clsx(
            'btn btn-ghost btn-circle btn-sm eink-bordered',
            sleepTimerMode != null && 'text-primary',
          )}
          aria-label={_('Sleep Timer')}
          title={_('Sleep Timer')}
          onClick={() => togglePanel('sleep')}
        >
          <MdBedtime size={iconSize} />
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-circle btn-sm eink-bordered'
          aria-label={isCurrentBookmarked ? _('Remove Bookmark') : _('Add Bookmark')}
          title={isCurrentBookmarked ? _('Remove Bookmark') : _('Add Bookmark')}
          onClick={onToggleBookmark}
        >
          {isCurrentBookmarked ? (
            <MdBookmark size={iconSize} />
          ) : (
            <MdOutlineBookmarkAdd size={iconSize} />
          )}
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-circle btn-sm eink-bordered'
          aria-label={_('Player Settings')}
          title={_('Player Settings')}
          onClick={() => togglePanel('settings')}
        >
          <MdMoreHoriz size={iconSize} />
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-circle btn-sm'
          aria-label={_('Minimize Player')}
          title={_('Minimize Player')}
          onClick={onClose}
        >
          <MdKeyboardArrowDown size={iconSize} />
        </button>
      </div>

      {state === 'ended' && (
        <div className='text-base-content/70 text-center text-sm'>{_('Finished')}</div>
      )}

      {panel === 'chapters' && (
        <ul className='menu bg-base-200 eink-bordered max-h-48 flex-nowrap overflow-y-auto rounded-box'>
          {chapters.map((chapter) => (
            <li key={chapter.sectionIndex}>
              <button
                type='button'
                className={clsx(chapter.sectionIndex === sectionIndex && 'active')}
                onClick={() => onGoToChapter(chapter.sectionIndex)}
              >
                {chapter.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {panel === 'sleep' && (
        <div className='bg-base-200 eink-bordered rounded-box flex flex-col gap-2 p-3'>
          <label className='flex items-center justify-between gap-2 text-sm'>
            <span>{_('Sleep Timer')}</span>
            <select
              className='select select-sm eink-bordered'
              aria-label={_('Sleep Timer')}
              value={sleepValue}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'off') onSetSleepTimer(null);
                else if (value === 'end-of-chapter') onSetSleepTimer({ type: 'end-of-chapter' });
                else onSetSleepTimer({ type: 'duration', minutes: Number(value) });
              }}
            >
              <option value='off'>{_('Off')}</option>
              {SLEEP_MINUTE_OPTIONS.map((min) => (
                <option key={min} value={min}>
                  {_('{{min}} min', { min })}
                </option>
              ))}
              <option value='end-of-chapter'>{_('End of Chapter')}</option>
            </select>
          </label>
        </div>
      )}

      {panel === 'settings' && (
        <div className='bg-base-200 eink-bordered rounded-box flex flex-col gap-2 p-3'>
          {bookmarks.length > 0 && (
            <>
              <span className='text-base-content/70 text-xs font-semibold uppercase'>
                {_('Bookmarks')}
              </span>
              <ul className='menu bg-base-100 eink-bordered rounded-box max-h-40 flex-nowrap overflow-y-auto'>
                {bookmarks.map((bookmark) => (
                  <li key={bookmark.id} data-bookmark-item className='flex-row items-center'>
                    <button
                      type='button'
                      className='min-w-0 flex-1 justify-start gap-2 text-start'
                      onClick={() => onJumpToBookmark(bookmark)}
                    >
                      {bookmark.bookTime != null && (
                        <span className='text-base-content/70 text-xs tabular-nums' dir='ltr'>
                          {formatPlaybackTime(bookmark.bookTime)}
                        </span>
                      )}
                      <span className='truncate text-sm'>{bookmark.snippet}</span>
                    </button>
                    <button
                      type='button'
                      className='btn btn-ghost btn-circle btn-xs shrink-0'
                      aria-label={_('Delete Bookmark')}
                      title={_('Delete Bookmark')}
                      onClick={() => onDeleteBookmark(bookmark.id)}
                    >
                      <MdDeleteOutline size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className='flex items-center gap-2 text-sm' dir='ltr'>
            <span>{_('Speed')}</span>
            <input
              type='range'
              className='range range-xs flex-1'
              aria-label={_('Playback Speed')}
              min={0.5}
              max={3}
              step={0.1}
              value={rate}
              onChange={(e) => onSetRate(Number(e.target.value))}
            />
            <span className='w-10 text-end text-xs tabular-nums'>{rate.toFixed(1)}×</span>
          </div>
          <label className='flex items-center justify-between gap-2 text-sm'>
            <span>{_('Skip Forward Interval')}</span>
            <select
              className='select select-sm eink-bordered'
              aria-label={_('Skip Forward Interval')}
              value={skipForwardSec}
              onChange={(e) => onSetSkipForwardSec(Number(e.target.value))}
            >
              {SKIP_INTERVAL_OPTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  {_('{{sec}} s', { sec })}
                </option>
              ))}
            </select>
          </label>
          <label className='flex items-center justify-between gap-2 text-sm'>
            <span>{_('Skip Back Interval')}</span>
            <select
              className='select select-sm eink-bordered'
              aria-label={_('Skip Back Interval')}
              value={skipBackSec}
              onChange={(e) => onSetSkipBackSec(Number(e.target.value))}
            >
              {SKIP_INTERVAL_OPTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  {_('{{sec}} s', { sec })}
                </option>
              ))}
            </select>
          </label>
          <label className='flex items-center justify-between gap-2 text-sm'>
            <span>{_('Read Along')}</span>
            <input
              type='checkbox'
              className='toggle toggle-sm'
              aria-label={_('Read Along')}
              checked={readAlongEnabled}
              onChange={(e) => onSetReadAlong(e.target.checked)}
            />
          </label>
          <label className='flex items-center justify-between gap-2 text-sm'>
            <span>{_('Highlight Style')}</span>
            <select
              className='select select-sm eink-bordered'
              aria-label={_('Highlight Style')}
              value={highlightOptions.style === 'underline' ? 'underline' : 'highlight'}
              onChange={(e) =>
                onSetHighlightOptions({ style: e.target.value as TTSHighlightOptions['style'] })
              }
            >
              <option value='highlight'>{_('Highlight')}</option>
              <option value='underline'>{_('Underline')}</option>
            </select>
          </label>
          <div className='flex items-center justify-between gap-2 text-sm'>
            <span>{_('Highlight Color')}</span>
            <div className='flex items-center gap-1.5' dir='ltr'>
              {DEFAULT_HIGHLIGHT_COLORS.map((name) => (
                <button
                  key={name}
                  type='button'
                  className={clsx(
                    'eink-bordered size-5 rounded-full border border-black/10',
                    highlightOptions.color === HIGHLIGHT_COLOR_HEX[name] &&
                      'ring-primary ring-2 ring-offset-1',
                  )}
                  style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[name] }}
                  aria-label={`${_('Highlight Color')} ${_(COLOR_NAMES[name])}`}
                  title={_(COLOR_NAMES[name])}
                  onClick={() => onSetHighlightOptions({ color: HIGHLIGHT_COLOR_HEX[name] })}
                />
              ))}
            </div>
          </div>
          {audioRoutePickerAvailable() && (
            <button
              type='button'
              className='btn btn-ghost btn-sm eink-bordered justify-start gap-2'
              aria-label={_('Audio Output')}
              title={_('Audio Output')}
              onClick={() => void showAudioRoutePicker()}
            >
              <MdAirplay size={iconSize} />
              {_('Audio Output')}
            </button>
          )}
        </div>
      )}

      {sleepTimerMode != null && sleepRemainingSec != null && (
        <div className='flex items-center justify-center gap-2 text-sm'>
          <span aria-label={_('Sleep Timer Remaining')} className='tabular-nums' dir='ltr'>
            {formatPlaybackTime(sleepRemainingSec)}
          </span>
          <button
            type='button'
            className='btn btn-ghost btn-xs eink-bordered'
            aria-label={_('Extend Sleep Timer')}
            title={_('Extend Sleep Timer')}
            onClick={() => onExtendSleepTimer(SLEEP_EXTEND_MINUTES)}
          >
            +{SLEEP_EXTEND_MINUTES} {_('min')}
          </button>
        </div>
      )}

      <div className='truncate text-center text-base font-semibold'>{title}</div>
      {bookRemaining != null && (
        <div
          aria-label={_('Time Left in Book')}
          className='text-base-content/70 text-center text-sm'
          dir='ltr'
        >
          {_('{{time}} left', { time: formatTimeLeft(bookRemaining) })}
        </div>
      )}

      {chapterDuration > 0 && (
        <div className='flex items-center gap-2' dir='ltr'>
          <span aria-label={_('Elapsed Time')} className='w-12 text-end text-xs tabular-nums'>
            {formatPlaybackTime(chapterElapsed)}
          </span>
          <input
            type='range'
            className='range range-primary range-xs flex-1'
            aria-label={_('Chapter Position')}
            min={0}
            max={Math.ceil(chapterDuration)}
            step={1}
            value={Math.min(Math.floor(chapterElapsed), Math.ceil(chapterDuration))}
            onChange={(e) => onSeekToChapterTime(Number(e.target.value))}
          />
          <span aria-label={_('Time Remaining')} className='w-12 text-xs tabular-nums'>
            -{formatPlaybackTime(chapterRemaining)}
          </span>
        </div>
      )}

      <div className='flex items-center justify-center gap-2'>
        <button
          type='button'
          className='btn btn-ghost btn-circle eink-bordered'
          aria-label={_('Previous Chapter')}
          title={_('Previous Chapter')}
          onClick={onPrevChapter}
        >
          <MdSkipPrevious size={iconSize} />
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-circle eink-bordered'
          aria-label={_('Skip Back')}
          title={_('Skip Back {{sec}} s', { sec: skipBackSec })}
          onClick={onSkipBack}
        >
          <RiReplay15Line size={iconSize} />
        </button>
        <button
          type='button'
          className='btn btn-circle btn-primary'
          aria-label={isPlaying ? _('Pause') : _('Play')}
          title={isPlaying ? _('Pause') : _('Play')}
          onClick={onTogglePlay}
        >
          {isPlaying ? (
            <MdOutlinePause size={playIconSize} />
          ) : state === 'ended' ? (
            <MdReplay size={playIconSize} />
          ) : (
            <MdPlayArrow size={playIconSize} />
          )}
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-circle eink-bordered'
          aria-label={_('Skip Forward')}
          title={_('Skip Forward {{sec}} s', { sec: skipForwardSec })}
          onClick={onSkipForward}
        >
          <RiForward30Line size={iconSize} />
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-circle eink-bordered'
          aria-label={_('Next Chapter')}
          title={_('Next Chapter')}
          onClick={onNextChapter}
        >
          <MdSkipNext size={iconSize} />
        </button>
      </div>
    </div>
  );
};

export default AudiobookPlayer;
