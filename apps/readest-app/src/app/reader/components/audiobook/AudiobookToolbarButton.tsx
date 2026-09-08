import clsx from 'clsx';
import React from 'react';
import { MdOutlineHeadphones } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useAudiobookStore } from '@/store/audiobookStore';

interface AudiobookToolbarButtonProps {
  bookKey: string;
  /** Called after toggling — the mobile bar closes itself, desktop stays. */
  onAfterToggle?: () => void;
}

/**
 * Footer-bar audio toggle (v2 PRD §5.3): replaces the TTS button when the
 * open book has an audio track. Expands/collapses the audio tray without
 * touching playback; highlighted while the tray is open and while playing.
 */
const AudiobookToolbarButton: React.FC<AudiobookToolbarButtonProps> = ({
  bookKey,
  onAfterToggle,
}) => {
  const _ = useTranslation();
  const trayCollapsed = useAudiobookStore((state) => state.trayCollapsed[bookKey] ?? false);
  const playbackState = useAudiobookStore((state) => state.playbackStates[bookKey]);
  const toggleTray = useAudiobookStore((state) => state.toggleTray);
  const isPlaying = playbackState === 'playing' || playbackState === 'loading';
  const label = isPlaying
    ? trayCollapsed
      ? _('Audiobook playing, show controls')
      : _('Audiobook playing, hide controls')
    : trayCollapsed
      ? _('Show Audiobook Player')
      : _('Hide Audiobook Player');

  return (
    <button
      type='button'
      className='touch-target btn btn-ghost relative h-8 min-h-8 w-8 p-0'
      title={label}
      aria-label={label}
      aria-pressed={!trayCollapsed}
      data-playing={isPlaying ? 'true' : 'false'}
      onClick={() => {
        toggleTray(bookKey);
        onAfterToggle?.();
      }}
    >
      <MdOutlineHeadphones className={clsx((isPlaying || !trayCollapsed) && 'text-primary')} />
      {isPlaying && (
        <span
          data-testid='audiobook-playing-indicator'
          aria-hidden='true'
          className='bg-primary absolute end-0.5 top-0.5 size-1.5 rounded-full'
        />
      )}
    </button>
  );
};

export default AudiobookToolbarButton;
