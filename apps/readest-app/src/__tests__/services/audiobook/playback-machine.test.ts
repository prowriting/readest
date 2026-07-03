import { describe, expect, it } from 'vitest';
import {
  transition,
  type AudiobookPlaybackEvent,
  type AudiobookPlaybackState,
} from '@/services/audiobook/playbackMachine';

const STATES: AudiobookPlaybackState[] = [
  'stopped',
  'loading',
  'playing',
  'paused',
  'ended',
  'error',
];

describe('audiobook playback state machine', () => {
  const expectTransition = (
    from: AudiobookPlaybackState,
    event: AudiobookPlaybackEvent['type'],
    to: AudiobookPlaybackState,
  ) => {
    expect(transition(from, { type: event }), `${from} --${event}--> ${to}`).toBe(to);
  };

  it('PLAY starts loading from cold states and resumes synchronously from paused', () => {
    expectTransition('stopped', 'PLAY', 'loading');
    expectTransition('ended', 'PLAY', 'loading');
    expectTransition('error', 'PLAY', 'loading');
    expectTransition('paused', 'PLAY', 'playing');
    // Redundant PLAY while active must not regress the state.
    expectTransition('loading', 'PLAY', 'loading');
    expectTransition('playing', 'PLAY', 'playing');
  });

  it('STARTED only confirms an in-flight load', () => {
    expectTransition('loading', 'STARTED', 'playing');
    // A stale STARTED (audio came up after the user stopped) must not revive playback.
    for (const from of STATES.filter((s) => s !== 'loading')) {
      expectTransition(from, 'STARTED', from);
    }
  });

  it('PAUSE holds playing and in-flight loads, and is a no-op elsewhere', () => {
    expectTransition('playing', 'PAUSE', 'paused');
    expectTransition('loading', 'PAUSE', 'paused');
    for (const from of ['stopped', 'paused', 'ended', 'error'] as const) {
      expectTransition(from, 'PAUSE', from);
    }
  });

  it('STOP always returns to stopped', () => {
    for (const from of STATES) {
      expectTransition(from, 'STOP', 'stopped');
    }
  });

  it('ENDED finishes any active playback but does not revive a stopped player', () => {
    expectTransition('playing', 'ENDED', 'ended');
    expectTransition('loading', 'ENDED', 'ended');
    expectTransition('paused', 'ENDED', 'ended');
    expectTransition('stopped', 'ENDED', 'stopped');
    expectTransition('ended', 'ENDED', 'ended');
    expectTransition('error', 'ENDED', 'error');
  });

  it('ERROR captures failures of any active state and is ignored when stopped', () => {
    for (const from of ['loading', 'playing', 'paused', 'ended'] as const) {
      expectTransition(from, 'ERROR', 'error');
    }
    expectTransition('stopped', 'ERROR', 'stopped');
    expectTransition('error', 'ERROR', 'error');
  });

  it('is total: every state/event pair produces a valid state', () => {
    const events: AudiobookPlaybackEvent['type'][] = [
      'PLAY',
      'STARTED',
      'PAUSE',
      'STOP',
      'ENDED',
      'ERROR',
    ];
    for (const from of STATES) {
      for (const event of events) {
        expect(STATES).toContain(transition(from, { type: event }));
      }
    }
  });
});
