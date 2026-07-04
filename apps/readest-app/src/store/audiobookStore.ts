import { create } from 'zustand';
import type { AudiobookPlaybackState } from '@/services/audiobook/playbackMachine';

/**
 * Per-book audiobook UI state shared across surfaces (v2 PRD §5.2/5.3): the
 * footer-bar audio toggle, the docked tray, and the fullscreen player all
 * read and write here so collapsing/expanding never restarts playback.
 * `available`/`playbackStates` mirror the control hook for components that
 * must not instantiate it (the footer bars).
 */
interface AudiobookState {
  available: Record<string, boolean>;
  playbackStates: Record<string, AudiobookPlaybackState>;
  /** Tray hidden for distraction-free reading; audio keeps playing. */
  trayCollapsed: Record<string, boolean>;
  /** Fullscreen player shown; unset falls back to `isAudioOnly` at render. */
  playerExpanded: Record<string, boolean>;
  setAvailable: (bookKey: string, available: boolean) => void;
  setPlaybackState: (bookKey: string, state: AudiobookPlaybackState) => void;
  setTrayCollapsed: (bookKey: string, collapsed: boolean) => void;
  toggleTray: (bookKey: string) => void;
  setPlayerExpanded: (bookKey: string, expanded: boolean) => void;
}

export const useAudiobookStore = create<AudiobookState>((set) => ({
  available: {},
  playbackStates: {},
  trayCollapsed: {},
  playerExpanded: {},
  setAvailable: (bookKey, available) =>
    set((state) => ({ available: { ...state.available, [bookKey]: available } })),
  setPlaybackState: (bookKey, playbackState) =>
    set((state) => ({ playbackStates: { ...state.playbackStates, [bookKey]: playbackState } })),
  setTrayCollapsed: (bookKey, collapsed) =>
    set((state) => ({ trayCollapsed: { ...state.trayCollapsed, [bookKey]: collapsed } })),
  toggleTray: (bookKey) =>
    set((state) => ({
      trayCollapsed: {
        ...state.trayCollapsed,
        [bookKey]: !(state.trayCollapsed[bookKey] ?? false),
      },
    })),
  setPlayerExpanded: (bookKey, expanded) =>
    set((state) => ({ playerExpanded: { ...state.playerExpanded, [bookKey]: expanded } })),
}));
