import { describe, expect, it } from 'vitest';
import {
  FADE_SECONDS,
  extendTimer,
  fadeVolume,
  isExpired,
  remainingSeconds,
  startTimer,
  type SleepTimerState,
} from '@/services/audiobook/sleepTimer';

const T0 = 1_751_500_000_000;
const MIN = 60_000;

describe('audiobook sleep timer', () => {
  it('a duration timer expires after its minutes elapse', () => {
    const state = startTimer({ type: 'duration', minutes: 15 }, T0);
    expect(remainingSeconds(state, T0)).toBe(15 * 60);
    expect(isExpired(state, T0 + 14 * MIN)).toBe(false);
    expect(remainingSeconds(state, T0 + 14 * MIN)).toBe(60);
    expect(isExpired(state, T0 + 15 * MIN)).toBe(true);
    expect(remainingSeconds(state, T0 + 16 * MIN)).toBe(0);
  });

  it('the end-of-chapter mode never expires by clock', () => {
    const state = startTimer({ type: 'end-of-chapter' }, T0);
    expect(state.expiresAt).toBe(null);
    expect(remainingSeconds(state, T0 + 120 * MIN)).toBe(null);
    expect(isExpired(state, T0 + 120 * MIN)).toBe(false);
  });

  it('extend adds minutes to a running duration timer', () => {
    const state = startTimer({ type: 'duration', minutes: 5 }, T0);
    const extended = extendTimer(state, 15, T0 + MIN);
    expect(remainingSeconds(extended, T0 + MIN)).toBe(19 * 60);
  });

  it('extending an end-of-chapter timer converts it to a duration timer', () => {
    const state = startTimer({ type: 'end-of-chapter' }, T0);
    const extended = extendTimer(state, 15, T0);
    expect(remainingSeconds(extended, T0)).toBe(15 * 60);
    expect(isExpired(extended, T0 + 16 * MIN)).toBe(true);
  });

  it('volume fades to zero across the final fade window and is full before it', () => {
    const state = startTimer({ type: 'duration', minutes: 1 }, T0);
    expect(fadeVolume(state, T0)).toBe(1);
    expect(fadeVolume(state, T0 + MIN - FADE_SECONDS * 1000)).toBe(1);
    const midFade = fadeVolume(state, T0 + MIN - (FADE_SECONDS / 2) * 1000);
    expect(midFade).toBeGreaterThan(0.3);
    expect(midFade).toBeLessThan(0.7);
    expect(fadeVolume(state, T0 + MIN)).toBe(0);
    expect(fadeVolume(state, T0 + 2 * MIN)).toBe(0);
  });

  it('end-of-chapter timers do not fade', () => {
    const state = startTimer({ type: 'end-of-chapter' }, T0);
    expect(fadeVolume(state, T0 + 120 * MIN)).toBe(1);
  });

  it('a cleared timer neither expires nor fades', () => {
    const state: SleepTimerState = { mode: null, expiresAt: null };
    expect(isExpired(state, T0)).toBe(false);
    expect(remainingSeconds(state, T0)).toBe(null);
    expect(fadeVolume(state, T0)).toBe(1);
  });
});
