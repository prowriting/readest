import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudiobookMiniBar from '@/app/reader/components/audiobook/AudiobookMiniBar';
import AudiobookToolbarButton from '@/app/reader/components/audiobook/AudiobookToolbarButton';
import { useAudiobookStore } from '@/store/audiobookStore';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, variables?: Record<string, unknown>) => {
    if (!variables) return value;
    return Object.entries(variables).reduce(
      (result, [key, replacement]) => result.replace(`{{${key}}}`, String(replacement)),
      value,
    );
  },
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

const noop = vi.fn();

afterEach(() => cleanup());

const renderMiniBar = () =>
  render(
    <AudiobookMiniBar
      state='playing'
      title='A Christmas Carol'
      elapsed={30}
      total={300}
      rate={1}
      skipForwardSec={45}
      bottomInset={0}
      followSuspended={false}
      footerVisible={false}
      onTogglePlay={noop}
      onSkipForward={noop}
      onCycleRate={noop}
      onReturnToPlaying={noop}
      onExpand={noop}
      onDismiss={noop}
    />,
  );

describe('AudiobookMiniBar', () => {
  it('exposes a named region and explains that hiding controls keeps audio playing', () => {
    renderMiniBar();

    expect(screen.getByRole('region', { name: 'Audiobook Mini Player' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide Player, audio keeps playing' })).toBeTruthy();
  });

  it('uses real 44px targets and reports the configured skip interval', () => {
    renderMiniBar();

    expect(screen.getByRole('button', { name: 'Skip Forward 45 s' })).toBeTruthy();
    for (const button of screen.getAllByRole('button')) {
      expect(button.classList.contains('min-h-11')).toBe(true);
      expect(button.classList.contains('min-w-11')).toBe(true);
    }
  });
});

describe('AudiobookToolbarButton', () => {
  beforeEach(() => {
    useAudiobookStore.setState({
      available: {},
      playbackStates: { book: 'playing' },
      trayCollapsed: { book: true },
      playerExpanded: {},
    });
  });

  it('communicates hidden playback without relying on hard-coded color', () => {
    render(<AudiobookToolbarButton bookKey='book' />);

    const button = screen.getByRole('button', { name: 'Audiobook playing, show controls' });
    expect(button.classList.contains('touch-target')).toBe(true);
    expect(screen.getByTestId('audiobook-playing-indicator')).toBeTruthy();
    expect(button.innerHTML).not.toContain('text-blue-500');
  });
});
