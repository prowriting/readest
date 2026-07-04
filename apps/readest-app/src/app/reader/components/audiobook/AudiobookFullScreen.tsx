import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Insets } from '@/types/misc';

interface AudiobookFullScreenProps {
  gridInsets: Insets;
  /** The embedded {@link AudiobookPlayer}. */
  children: React.ReactNode;
}

/**
 * Fullscreen player surface shell (v2 PRD §5.1): paints the screen and safe
 * areas; the player inside owns the layout (top bar, cover, transport).
 * Default view for audio-only books; the expanded state of the combined view
 * for text+audio books. The foliate view stays mounted underneath and keeps
 * driving playback.
 */
const AudiobookFullScreen: React.FC<AudiobookFullScreenProps> = ({ gridInsets, children }) => {
  const _ = useTranslation();

  return (
    <div
      aria-label={_('Audiobook Screen')}
      className='bg-base-100 absolute inset-0 z-50 flex flex-col overflow-y-auto px-6'
      style={{
        paddingTop: `${gridInsets.top + 12}px`,
        paddingBottom: `${gridInsets.bottom + 12}px`,
      }}
    >
      {children}
    </div>
  );
};

export default AudiobookFullScreen;
