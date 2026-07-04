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

  return (
    <button
      type='button'
      className='btn btn-ghost h-8 min-h-8 w-8 p-0'
      title={_('Audiobook')}
      aria-label={_('Audiobook')}
      aria-pressed={!trayCollapsed}
      data-playing={isPlaying ? 'true' : 'false'}
      onClick={() => {
        toggleTray(bookKey);
        onAfterToggle?.();
      }}
    >
      <MdOutlineHeadphones className={clsx((isPlaying || !trayCollapsed) && 'text-blue-500')} />
    </button>
  );
};

export default AudiobookToolbarButton;
