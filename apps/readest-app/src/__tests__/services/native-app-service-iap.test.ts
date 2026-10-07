import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const osTypeMock = vi.fn().mockReturnValue('ios');

vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => osTypeMock(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue(''),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  BaseDirectory: {},
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
  ask: vi.fn().mockResolvedValue(true),
}));
vi.mock('@tauri-apps/api/path', () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join('/')),
  basename: (p: string) => Promise.resolve(p.split('/').pop() ?? p),
  appDataDir: () => Promise.resolve('/tmp/app-data'),
  appConfigDir: () => Promise.resolve('/tmp/app-config'),
  appCacheDir: () => Promise.resolve('/tmp/app-cache'),
  appLogDir: () => Promise.resolve('/tmp/app-log'),
  tempDir: () => Promise.resolve('/tmp'),
}));
vi.mock('@choochmeque/tauri-plugin-sharekit-api', () => ({
  shareFile: vi.fn().mockResolvedValue(undefined),
}));

async function loadService(os: string, channel: string) {
  vi.resetModules();
  osTypeMock.mockReturnValue(os);
  vi.stubEnv('NEXT_PUBLIC_DIST_CHANNEL', channel);
  const { NativeAppService } = await import('@/services/nativeAppService');
  return new NativeAppService('/tmp/app');
}

describe('NativeAppService in-app purchases', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  // The App Store listing promises no in-app purchases; the iOS build must not expose
  // StoreKit-backed plans, restore buttons or product lookups.
  it('is disabled on iOS regardless of distribution channel', async () => {
    expect((await loadService('ios', 'appstore')).hasIAP).toBe(false);
    expect((await loadService('ios', 'readest')).hasIAP).toBe(false);
  });

  it('stays enabled for the Google Play channel on Android', async () => {
    expect((await loadService('android', 'playstore')).hasIAP).toBe(true);
    expect((await loadService('android', 'amazon')).hasIAP).toBe(false);
  });
});
