import { beforeEach, describe, expect, it } from 'vitest';
import { useAudiobookStore } from '@/store/audiobookStore';

// v2 PRD §5.2/5.3: footer-bar buttons and the player surfaces share per-book
// UI state — tray visibility, fullscreen expansion, and a playback mirror the
// toolbar audio button renders from.
describe('audiobookStore', () => {
  const KEY = 'book-1-abcdef';

  beforeEach(() => {
    useAudiobookStore.setState({
      available: {},
      playbackStates: {},
      trayCollapsed: {},
      playerExpanded: {},
    });
  });

  it('defaults to combined view: tray visible, player not expanded', () => {
    const s = useAudiobookStore.getState();
    expect(s.trayCollapsed[KEY] ?? false).toBe(false);
    expect(s.playerExpanded[KEY] ?? false).toBe(false);
    expect(s.available[KEY] ?? false).toBe(false);
  });

  it('toggleTray flips tray visibility', () => {
    useAudiobookStore.getState().toggleTray(KEY);
    expect(useAudiobookStore.getState().trayCollapsed[KEY]).toBe(true);
    useAudiobookStore.getState().toggleTray(KEY);
    expect(useAudiobookStore.getState().trayCollapsed[KEY]).toBe(false);
  });

  it('mirrors availability and playback state per book', () => {
    useAudiobookStore.getState().setAvailable(KEY, true);
    useAudiobookStore.getState().setPlaybackState(KEY, 'playing');
    const s = useAudiobookStore.getState();
    expect(s.available[KEY]).toBe(true);
    expect(s.playbackStates[KEY]).toBe('playing');
    expect(s.available['other'] ?? false).toBe(false);
  });

  it('leaves playerExpanded unset until a surface writes it (default comes from isAudioOnly)', () => {
    expect(useAudiobookStore.getState().playerExpanded[KEY]).toBeUndefined();
    useAudiobookStore.getState().setPlayerExpanded(KEY, false);
    expect(useAudiobookStore.getState().playerExpanded[KEY]).toBe(false);
  });

  it('expanding the player and minimizing back preserves tray visibility state', () => {
    useAudiobookStore.getState().setPlayerExpanded(KEY, true);
    expect(useAudiobookStore.getState().playerExpanded[KEY]).toBe(true);
    useAudiobookStore.getState().setPlayerExpanded(KEY, false);
    const s = useAudiobookStore.getState();
    expect(s.playerExpanded[KEY]).toBe(false);
    expect(s.trayCollapsed[KEY] ?? false).toBe(false);
  });
});
