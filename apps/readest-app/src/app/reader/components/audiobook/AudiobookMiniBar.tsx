import clsx from 'clsx';
import React, { useRef } from 'react';
import { MdMyLocation, MdOutlinePause, MdPlayArrow } from 'react-icons/md';
import { RiArrowUpSLine, RiForward30Line } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { formatPlaybackTime, formatTimeLeft } from '@/services/audiobook/bookTimeline';
import { resolveTrayDragIntent } from '@/services/audiobook/trayGesture';
import type { AudiobookPlaybackState } from '@/services/audiobook/playbackMachine';

interface AudiobookMiniBarProps {
  state: AudiobookPlaybackState;
  title: string;
  elapsed: number;
  total: number | null;
  rate: number;
  bottomInset: number;
  /** The reader wandered away from the playing position. */
  followSuspended: boolean;
  onTogglePlay: () => void;
  onSkipForward: () => void;
  onCycleRate: () => void;
  onReturnToPlaying: () => void;
  onExpand: () => void;
  onDismiss: () => void;
}

/**
 * Docked audio tray of the combined view (v2 PRD §5.2): drag the handle up
 * (or tap the chevron) to expand the fullscreen player, drag it down to
 * dismiss the tray — audio keeps playing either way.
 */
const AudiobookMiniBar: React.FC<AudiobookMiniBarProps> = ({
  state,
  title,
  elapsed,
  total,
  rate,
  bottomInset,
  followSuspended,
  onTogglePlay,
  onSkipForward,
  onCycleRate,
  onReturnToPlaying,
  onExpand,
  onDismiss,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(24);
  const isPlaying = state === 'playing' || state === 'loading';
  const remaining = total != null ? Math.max(0, total - elapsed) : null;
  const dragStartY = useRef<number | null>(null);

  const handlePointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    dragStartY.current = ev.clientY;
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };

  const handlePointerUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current == null) return;
    const intent = resolveTrayDragIntent(ev.clientY - dragStartY.current);
    dragStartY.current = null;
    if (intent === 'expand') onExpand();
    else if (intent === 'dismiss') onDismiss();
  };

  return (
    <div
      aria-label={_('Audiobook Mini Player')}
      className={clsx(
        'bg-base-100 eink-bordered absolute z-40 shadow-md',
        'inset-x-0 bottom-2 mx-auto flex w-fit max-w-[92%] flex-col',
        'rounded-2xl px-2 pb-1 pt-0.5',
      )}
      style={{ marginBottom: bottomInset ? `${bottomInset}px` : undefined }}
    >
      <div
        data-testid='audiobook-tray-handle'
        aria-hidden='true'
        className='flex h-4 w-full cursor-grab touch-none items-center justify-center'
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragStartY.current = null;
        }}
      >
        <div className='bg-base-content/30 h-1 w-10 rounded-full' />
      </div>
      <div className='flex items-center gap-1'>
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
          <span className='max-w-40 truncate text-sm font-medium'>{title}</span>
          <span className='text-base-content/70 text-xs' dir='ltr'>
            {remaining != null
              ? _('{{time}} left', { time: formatTimeLeft(remaining) })
              : formatPlaybackTime(elapsed)}
          </span>
        </div>
        <button
          type='button'
          className='btn btn-ghost btn-xs eink-bordered rounded-full px-1.5 tabular-nums'
          aria-label={_('Playback Speed')}
          title={_('Playback Speed')}
          onClick={onCycleRate}
        >
          {Number(rate.toFixed(2))}×
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-circle btn-sm eink-bordered'
          aria-label={_('Skip Forward')}
          title={_('Skip Forward')}
          onClick={onSkipForward}
        >
          <RiForward30Line size={iconSize} />
        </button>
        {followSuspended && (
          <button
            type='button'
            className='btn btn-ghost btn-circle btn-sm eink-bordered'
            aria-label={_('Go to Playing Position')}
            title={_('Go to Playing Position')}
            onClick={onReturnToPlaying}
          >
            <MdMyLocation size={iconSize} />
          </button>
        )}
        <button
          type='button'
          className='btn btn-ghost btn-circle btn-sm'
          aria-label={_('Open Player')}
          title={_('Open Player')}
          onClick={onExpand}
        >
          <RiArrowUpSLine size={iconSize} />
        </button>
      </div>
    </div>
  );
};

export default AudiobookMiniBar;
