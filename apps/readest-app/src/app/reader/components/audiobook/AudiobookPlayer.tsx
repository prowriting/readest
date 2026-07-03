import clsx from 'clsx';
import React, { useState } from 'react';
import {
  MdOutlineClose,
  MdOutlinePause,
  MdOutlineSettings,
  MdPlayArrow,
  MdReplay,
  MdSkipNext,
  MdSkipPrevious,
} from 'react-icons/md';
import { RiForward30Line, RiListUnordered, RiReplay15Line } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { formatPlaybackTime } from '@/services/audiobook/bookTimeline';
import type { AudiobookPlaybackState } from '@/services/audiobook/playbackMachine';
import type { AudiobookChapter } from '../../hooks/useAudiobookControl';

const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2];
const SKIP_INTERVAL_OPTIONS = [10, 15, 30, 60];

interface AudiobookPlayerProps {
  state: AudiobookPlaybackState;
  title: string;
  elapsed: number;
  total: number | null;
  sectionIndex: number;
  chapters: AudiobookChapter[];
  rate: number;
  skipForwardSec: number;
  skipBackSec: number;
  bottomInset: number;
  onTogglePlay: () => void;
  onSkipForward: () => void;
  onSkipBack: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onGoToChapter: (sectionIndex: number) => void;
  onSeekToBookTime: (seconds: number) => void;
  onSetRate: (rate: number) => void;
  onSetSkipForwardSec: (sec: number) => void;
  onSetSkipBackSec: (sec: number) => void;
  onClose: () => void;
}

const AudiobookPlayer: React.FC<AudiobookPlayerProps> = ({
  state,
  title,
  elapsed,
  total,
  sectionIndex,
  chapters,
  rate,
  skipForwardSec,
  skipBackSec,
  bottomInset,
  onTogglePlay,
  onSkipForward,
  onSkipBack,
  onPrevChapter,
  onNextChapter,
  onGoToChapter,
  onSeekToBookTime,
  onSetRate,
  onSetSkipForwardSec,
  onSetSkipBackSec,
  onClose,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(22);
  const playIconSize = useResponsiveSize(32);
  const [showChapters, setShowChapters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const isPlaying = state === 'playing' || state === 'loading';
  const remaining = total != null ? Math.max(0, total - elapsed) : null;

  return (
    <div
      role='dialog'
      aria-label={_('Audiobook Player')}
      className={clsx(
        'bg-base-100 eink-bordered absolute inset-x-0 bottom-0 z-50',
        'mx-auto flex w-full max-w-lg flex-col gap-3 rounded-t-2xl p-4 shadow-2xl',
      )}
      style={{ paddingBottom: bottomInset ? `${bottomInset + 16}px` : undefined }}
    >
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate text-base font-semibold'>{title}</span>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            className='btn btn-ghost btn-circle btn-sm eink-bordered'
            aria-label={_('Chapters')}
            title={_('Chapters')}
            onClick={() => {
              setShowChapters((v) => !v);
              setShowSettings(false);
            }}
          >
            <RiListUnordered size={iconSize} />
          </button>
          <button
            type='button'
            className='btn btn-ghost btn-circle btn-sm eink-bordered'
            aria-label={_('Player Settings')}
            title={_('Player Settings')}
            onClick={() => {
              setShowSettings((v) => !v);
              setShowChapters(false);
            }}
          >
            <MdOutlineSettings size={iconSize} />
          </button>
          <button
            type='button'
            className='btn btn-ghost btn-circle btn-sm'
            aria-label={_('Close Player')}
            title={_('Close Player')}
            onClick={onClose}
          >
            <MdOutlineClose size={iconSize} />
          </button>
        </div>
      </div>

      {state === 'ended' && (
        <div className='text-base-content/70 text-center text-sm'>{_('Finished')}</div>
      )}

      {showChapters && (
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

      {showSettings && (
        <div className='bg-base-200 eink-bordered rounded-box flex flex-col gap-2 p-3'>
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
        </div>
      )}

      {total != null && (
        <div className='flex items-center gap-2' dir='ltr'>
          <span aria-label={_('Elapsed Time')} className='w-12 text-end text-xs tabular-nums'>
            {formatPlaybackTime(elapsed)}
          </span>
          <input
            type='range'
            className='range range-primary range-xs flex-1'
            aria-label={_('Book Position')}
            min={0}
            max={Math.ceil(total)}
            step={1}
            value={Math.min(Math.floor(elapsed), Math.ceil(total))}
            onChange={(e) => onSeekToBookTime(Number(e.target.value))}
          />
          <span aria-label={_('Time Remaining')} className='w-12 text-xs tabular-nums'>
            -{formatPlaybackTime(remaining ?? 0)}
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

      <div className='flex items-center gap-2' dir='ltr'>
        <span className='text-xs'>{_('Speed')}</span>
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
      <div className='flex items-center justify-center gap-1'>
        {SPEED_PRESETS.map((preset) => (
          <button
            key={preset}
            type='button'
            className={clsx(
              'btn btn-xs eink-bordered',
              Math.abs(rate - preset) < 0.05 ? 'btn-primary' : 'btn-ghost',
            )}
            aria-label={_('Speed {{rate}}×', { rate: preset })}
            onClick={() => onSetRate(preset)}
          >
            {preset}×
          </button>
        ))}
      </div>
    </div>
  );
};

export default AudiobookPlayer;
