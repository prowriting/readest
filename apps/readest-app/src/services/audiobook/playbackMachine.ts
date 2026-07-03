/**
 * Pure state machine for audiobook (EPUB3 Media Overlay) playback.
 *
 * The React hook stays thin: it forwards user intents and engine events here
 * and acts on the returned state. Keeping transitions pure makes the whole
 * lifecycle unit-testable without audio elements.
 */
export type AudiobookPlaybackState =
  | 'stopped'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export type AudiobookPlaybackEvent =
  | { type: 'PLAY' } // user intent: start, resume, restart after end/error
  | { type: 'STARTED' } // engine confirmation: audio is audible
  | { type: 'PAUSE' }
  | { type: 'STOP' }
  | { type: 'ENDED' } // engine ran past the last section
  | { type: 'ERROR' };

export const transition = (
  state: AudiobookPlaybackState,
  event: AudiobookPlaybackEvent,
): AudiobookPlaybackState => {
  switch (event.type) {
    case 'PLAY':
      // Resuming from pause is synchronous (the audio element is retained);
      // everything else must (re)load a section first.
      if (state === 'paused') return 'playing';
      if (state === 'stopped' || state === 'ended' || state === 'error') return 'loading';
      return state;
    case 'STARTED':
      // Only confirm an in-flight load. A stale confirmation arriving after
      // the user stopped must not revive playback.
      return state === 'loading' ? 'playing' : state;
    case 'PAUSE':
      return state === 'playing' || state === 'loading' ? 'paused' : state;
    case 'STOP':
      return 'stopped';
    case 'ENDED':
      return state === 'playing' || state === 'loading' || state === 'paused' ? 'ended' : state;
    case 'ERROR':
      return state === 'stopped' ? state : 'error';
  }
};

export const isActive = (state: AudiobookPlaybackState): boolean =>
  state === 'playing' || state === 'loading' || state === 'paused';
