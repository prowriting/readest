/**
 * Pure sleep-timer state for audiobook playback, driven by an injected clock
 * (epoch ms) so every transition is unit-testable and works under fake
 * timers. Duration timers expire by clock and fade the volume over the
 * final seconds; the end-of-chapter mode is expired externally by the
 * section-boundary event, never by the clock.
 */
export type SleepTimerMode = { type: 'duration'; minutes: number } | { type: 'end-of-chapter' };

export interface SleepTimerState {
  mode: SleepTimerMode | null;
  /** Epoch ms when a duration timer expires; null otherwise. */
  expiresAt: number | null;
}

export const FADE_SECONDS = 10;

export const CLEARED_TIMER: SleepTimerState = { mode: null, expiresAt: null };

export const startTimer = (mode: SleepTimerMode, now: number): SleepTimerState => ({
  mode,
  expiresAt: mode.type === 'duration' ? now + mode.minutes * 60_000 : null,
});

/** Add minutes to a running timer; end-of-chapter becomes a duration timer. */
export const extendTimer = (
  state: SleepTimerState,
  minutes: number,
  now: number,
): SleepTimerState => {
  if (!state.mode) return state;
  const base = state.expiresAt ?? now;
  return {
    mode: { type: 'duration', minutes },
    expiresAt: Math.max(base, now) + minutes * 60_000,
  };
};

export const remainingSeconds = (state: SleepTimerState, now: number): number | null =>
  state.expiresAt == null ? null : Math.max(0, Math.round((state.expiresAt - now) / 1000));

export const isExpired = (state: SleepTimerState, now: number): boolean =>
  state.expiresAt != null && now >= state.expiresAt;

/** 1 outside the fade window, linearly down to 0 at expiry. */
export const fadeVolume = (state: SleepTimerState, now: number): number => {
  if (state.expiresAt == null) return 1;
  const remainingMs = state.expiresAt - now;
  if (remainingMs <= 0) return 0;
  const fadeMs = FADE_SECONDS * 1000;
  return remainingMs >= fadeMs ? 1 : remainingMs / fadeMs;
};
