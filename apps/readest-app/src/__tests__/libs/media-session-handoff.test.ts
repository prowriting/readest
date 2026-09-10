import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    invoke: vi.fn(async () => ({})),
    listeners,
    addPluginListener: vi.fn(
      async (_plugin: string, event: string, handler: (e: unknown) => void) => {
        const handlers = listeners.get(event) ?? new Set();
        handlers.add(handler);
        listeners.set(event, handlers);
        return {
          unregister: vi.fn(async () => {
            handlers.delete(handler);
          }),
        };
      },
    ),
    emit(event: string, payload: unknown = {}) {
      for (const handler of listeners.get(event) ?? []) handler({ payload });
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: mocks.addPluginListener,
  invoke: mocks.invoke,
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => 'android' }));

import { getMediaSession, TauriMediaSession } from '@/libs/mediaSession';

describe('native/web media-session handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
  });

  it('reuses one native media-session wrapper for the whole app', () => {
    expect(getMediaSession()).toBe(getMediaSession());
  });

  it('does not accumulate native event listeners across repeated car reconnects', async () => {
    const session = new TauriMediaSession();
    const pause = vi.fn();
    session.setActionHandler('pause', pause);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await session.setActive({ active: true });
      expect(mocks.listeners.get('media-session-pause')?.size).toBe(1);
      mocks.emit('media-session-pause');
      await session.setActive({ active: false });
      expect(mocks.listeners.get('media-session-pause')?.size ?? 0).toBe(0);
    }

    expect(pause).toHaveBeenCalledTimes(3);
  });

  it('maps a native stop during disconnect to a paused web player', async () => {
    const session = new TauriMediaSession();
    const pause = vi.fn();
    session.setActionHandler('pause', pause);
    await session.setActive({ active: true });

    mocks.emit('media-session-stop');

    expect(pause).toHaveBeenCalledOnce();
  });

  it('delivers only the first explicit play after focus returns', async () => {
    const session = new TauriMediaSession();
    const play = vi.fn();
    const pause = vi.fn();
    session.setActionHandler('play', play);
    session.setActionHandler('pause', pause);
    await session.setActive({ active: true });

    mocks.emit('media-session-pause');
    expect(pause).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();

    mocks.emit('media-session-play');
    expect(play).toHaveBeenCalledOnce();
  });
});
