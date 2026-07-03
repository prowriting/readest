import clsx from 'clsx';
import React from 'react';
import { MdOutlinePause, MdPlayArrow } from 'react-icons/md';
import { RiExpandDiagonalLine } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { formatPlaybackTime } from '@/services/audiobook/bookTimeline';
import type { AudiobookPlaybackState } from '@/services/audiobook/playbackMachine';

interface AudiobookMiniBarProps {
  state: AudiobookPlaybackState;
  title: string;
  elapsed: number;
  total: number | null;
  bottomInset: number;
  onTogglePlay: () => void;
  onExpand: () => void;
}

const AudiobookMiniBar: React.FC<AudiobookMiniBarProps> = ({
  state,
  title,
  elapsed,
  total,
  bottomInset,
  onTogglePlay,
  onExpand,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(24);
  const isPlaying = state === 'playing' || state === 'loading';

  return (
    <div
      aria-label={_('Audiobook Mini Player')}
      className={clsx(
        'bg-base-100 eink-bordered absolute z-40 shadow-md',
        'inset-x-0 bottom-2 mx-auto flex w-fit max-w-[90%] items-center gap-1',
        'rounded-full px-2 py-1',
      )}
      style={{ marginBottom: bottomInset ? `${bottomInset}px` : undefined }}
    >
      <button
        type='button'
        className='btn btn-ghost btn-circle btn-sm btn-primary'
        aria-label={isPlaying ? _('Pause') : _('Play')}
        title={isPlaying ? _('Pause') : _('Play')}
        onClick={onTogglePlay}
      >
        {isPlaying ? <MdOutlinePause size={iconSize} /> : <MdPlayArrow size={iconSize} />}
      </button>
      <div className='flex min-w-0 flex-col px-1 text-start'>
        <span className='truncate text-sm font-medium'>{title}</span>
        <span className='text-base-content/70 text-xs' dir='ltr'>
          {formatPlaybackTime(elapsed)}
          {total != null ? ` / ${formatPlaybackTime(total)}` : ''}
        </span>
      </div>
      <button
        type='button'
        className='btn btn-ghost btn-circle btn-sm'
        aria-label={_('Open Player')}
        title={_('Open Player')}
        onClick={onExpand}
      >
        <RiExpandDiagonalLine size={iconSize} />
      </button>
    </div>
  );
};

export default AudiobookMiniBar;
