import clsx from 'clsx';
import React, { useRef } from 'react';
import { MdClose, MdMyLocation, MdOutlinePause, MdPlayArrow } from 'react-icons/md';
import { RiArrowUpSLine } from 'react-icons/ri';
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
  skipForwardSec: number;
  bottomInset: number;
  /** The reader wandered away from the playing position. */
  followSuspended: boolean;
  /** Footer toolbar is showing: lift clear of it so they don't overlap. */
  footerVisible: boolean;
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
  skipForwardSec,
  bottomInset,
  followSuspended,
  footerVisible,
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
  const skipForwardLabel = _('Skip Forward {{sec}} s', { sec: skipForwardSec });
  const hidePlayerLabel = _('Hide Player, audio keeps playing');

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
      role='region'
      aria-label={_('Audiobook Mini Player')}
      className={clsx(
        'bg-base-100 eink-bordered absolute z-40 shadow-md',
        'inset-x-2 bottom-2 mx-auto flex w-auto max-w-md flex-col sm:inset-x-0 sm:w-fit',
        'rounded-2xl px-1.5 pb-1 pt-0.5',
      )}
      // Sit above the footer toolbar's height (~72px) when it's revealed;
      // instant (no transition) so the bar stays clickable and stable.
      style={{ marginBottom: `${bottomInset + (footerVisible ? 72 : 0)}px` }}
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
      <div className='flex min-w-0 items-center gap-0.5'>
        <button
          type='button'
          className='btn btn-primary btn-circle h-11 min-h-11 w-11 min-w-11 p-0'
          aria-label={isPlaying ? _('Pause') : _('Play')}
          title={isPlaying ? _('Pause') : _('Play')}
          onClick={onTogglePlay}
        >
          {isPlaying ? <MdOutlinePause size={iconSize} /> : <MdPlayArrow size={iconSize} />}
        </button>
        <div className='flex min-w-0 flex-1 flex-col px-1 text-start'>
          <span className='truncate text-sm font-medium'>{title}</span>
          <span className='text-base-content/70 truncate text-sm leading-tight' dir='ltr'>
            {remaining != null
              ? _('{{time}} left', { time: formatTimeLeft(remaining) })
              : formatPlaybackTime(elapsed)}
          </span>
        </div>
        <button
          type='button'
          className={clsx(
            'btn btn-ghost eink-bordered hidden h-11 min-h-11 min-w-11 rounded-full px-2',
            'tabular-nums min-[430px]:inline-flex',
          )}
          aria-label={_('Playback Speed')}
          title={_('Playback Speed')}
          onClick={onCycleRate}
        >
          {Number(rate.toFixed(2))}×
        </button>
        {followSuspended ? (
          <button
            type='button'
            className='btn btn-ghost btn-circle eink-bordered h-11 min-h-11 w-11 min-w-11 p-0'
            aria-label={_('Go to Playing Position')}
            title={_('Go to Playing Position')}
            onClick={onReturnToPlaying}
          >
            <MdMyLocation size={iconSize} />
          </button>
        ) : (
          <button
            type='button'
            className='btn btn-ghost btn-circle eink-bordered h-11 min-h-11 w-11 min-w-11 p-0'
            aria-label={skipForwardLabel}
            title={skipForwardLabel}
            onClick={onSkipForward}
          >
            <span aria-hidden='true' className='text-sm font-semibold tabular-nums'>
              +{skipForwardSec}
            </span>
          </button>
        )}
        <button
          type='button'
          className='btn btn-ghost btn-circle h-11 min-h-11 w-11 min-w-11 p-0'
          aria-label={_('Open Player')}
          title={_('Open Player')}
          onClick={onExpand}
        >
          <RiArrowUpSLine size={iconSize} />
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-circle h-11 min-h-11 w-11 min-w-11 p-0'
          aria-label={hidePlayerLabel}
          title={hidePlayerLabel}
          onClick={onDismiss}
        >
          <MdClose size={iconSize} />
        </button>
      </div>
    </div>
  );
};

export default AudiobookMiniBar;
