import { describe, expect, it } from 'vitest';
import { loadSettings, type Context } from '@/services/settingsService';
import { SETTINGS_FILENAME } from '@/services/constants';
import type { FileSystem } from '@/types/system';

const makeCtx = (stored?: Record<string, unknown>): Context => {
  const fs = {
    readFile: async (path: string) => {
      if (stored && path === SETTINGS_FILENAME) return JSON.stringify(stored);
      throw new Error('not found');
    },
    writeFile: async () => {},
    getPrefix: async () => '/books',
  } as unknown as FileSystem;
  return { fs, isMobile: false, isEink: false, isAppDataSandbox: false };
};

const storedBase = {
  screenWakeLock: false,
  kosync: { deviceId: 'device' },
  replicaDeviceId: 'replica',
};

describe('screenWakeLock default-on migration', () => {
  it('turns screenWakeLock on for installs upgrading from settings version 1', async () => {
    const settings = await loadSettings(makeCtx({ ...storedBase, version: 1 }));
    expect(settings.screenWakeLock).toBe(true);
  });

  it('does not re-force screenWakeLock once already migrated (version 2)', async () => {
    const settings = await loadSettings(makeCtx({ ...storedBase, version: 2 }));
    expect(settings.screenWakeLock).toBe(false);
  });

  it('defaults screenWakeLock on for fresh installs', async () => {
    const settings = await loadSettings(makeCtx());
    expect(settings.screenWakeLock).toBe(true);
  });
});
