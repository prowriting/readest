import type { Page } from '@playwright/test';

/**
 * Instruments `navigator.mediaSession` so specs can observe what the app
 * advertises to the OS and — since the OS can't press lock-screen buttons in
 * a test — invoke the registered action handlers directly.
 *
 * Install BEFORE the first navigation (init script semantics).
 */

interface RecordedPositionState {
  duration?: number;
  playbackRate?: number;
  position?: number;
}

interface InstrumentedMediaSessionWindow {
  __mediaSessionActions: string[];
  __mediaSessionPositions: (RecordedPositionState | null)[];
  __mediaSessionHandlers: Record<string, ((details: unknown) => void) | null>;
}

export async function installMediaSessionInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tracked = window as unknown as InstrumentedMediaSessionWindow;
    tracked.__mediaSessionActions = [];
    tracked.__mediaSessionPositions = [];
    tracked.__mediaSessionHandlers = {};
    const session = navigator.mediaSession;
    if (!session) return;

    const originalSetHandler = session.setActionHandler.bind(session);
    session.setActionHandler = (action, handler) => {
      tracked.__mediaSessionHandlers[action] = handler as ((details: unknown) => void) | null;
      tracked.__mediaSessionActions.push(`${action}:${handler ? 'set' : 'cleared'}`);
      originalSetHandler(action, handler);
    };

    const originalSetPosition = session.setPositionState?.bind(session);
    session.setPositionState = (state) => {
      tracked.__mediaSessionPositions.push(state ? { ...state } : null);
      originalSetPosition?.(state);
    };
  });
}

/** Title/artist/album currently advertised, or null when unset. */
export async function mediaSessionMetadata(
  page: Page,
): Promise<{ title: string; artist: string; album: string } | null> {
  return page.evaluate(() => {
    const metadata = navigator.mediaSession?.metadata;
    return metadata
      ? { title: metadata.title, artist: metadata.artist, album: metadata.album }
      : null;
  });
}

export async function mediaSessionPlaybackState(page: Page): Promise<string> {
  return page.evaluate(() => navigator.mediaSession?.playbackState ?? 'unsupported');
}

/** Invoke a registered action handler, as the OS would from the lock screen. */
export async function invokeMediaSessionAction(
  page: Page,
  action: string,
  details: Record<string, unknown> = {},
): Promise<boolean> {
  return page.evaluate(
    ({ action, details }) => {
      const tracked = window as unknown as InstrumentedMediaSessionWindow;
      const handler = tracked.__mediaSessionHandlers[action];
      if (!handler) return false;
      handler({ action, ...details });
      return true;
    },
    { action, details },
  );
}

/** Every setPositionState call, oldest first. */
export async function mediaSessionPositions(page: Page): Promise<(RecordedPositionState | null)[]> {
  return page.evaluate(
    () => (window as unknown as InstrumentedMediaSessionWindow).__mediaSessionPositions ?? [],
  );
}
