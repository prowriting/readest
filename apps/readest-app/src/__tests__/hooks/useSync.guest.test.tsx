import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigateToLogin: vi.fn(),
  pullChanges: vi.fn(),
  settings: { version: 'test', keepLogin: true },
  setSettings: vi.fn(),
  saveSettings: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utils/nav', () => ({ navigateToLogin: mocks.navigateToLogin }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/context/SyncContext', () => ({
  useSyncContext: () => ({ syncClient: { pullChanges: mocks.pullChanges } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    () => ({
      settings: mocks.settings,
      setSettings: mocks.setSettings,
      saveSettings: mocks.saveSettings,
    }),
    { getState: () => ({ settings: mocks.settings }) },
  ),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: vi.fn(), setConfig: vi.fn() }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setIsSyncing: vi.fn() }),
}));
vi.mock('@/utils/transform', () => ({
  transformBookFromDB: vi.fn(),
  transformBookConfigFromDB: vi.fn(),
  transformBookNoteFromDB: vi.fn(),
}));

import { useSync } from '@/hooks/useSync';

describe('optional cloud sign-in during local reading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.keepLogin = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the reader open when a remembered cloud session is no longer authenticated', async () => {
    mocks.pullChanges.mockRejectedValue(new Error('Not authenticated'));
    const { result } = renderHook(() => useSync());
    await act(async () => {
      await result.current.pullChanges('books', 0, vi.fn(), vi.fn());
    });
    expect(result.current.syncError).toBe('Not authenticated');
    expect(mocks.settings.keepLogin).toBe(false);
    expect(mocks.saveSettings).toHaveBeenCalled();
    expect(mocks.navigateToLogin).not.toHaveBeenCalled();
  });

  it('retains the remembered session for an ordinary network failure', async () => {
    mocks.pullChanges.mockRejectedValue(new Error('Network unavailable'));
    const { result } = renderHook(() => useSync());
    await act(async () => {
      await result.current.pullChanges('books', 0, vi.fn(), vi.fn());
    });
    expect(result.current.syncError).toBe('Network unavailable');
    expect(mocks.settings.keepLogin).toBe(true);
    expect(mocks.navigateToLogin).not.toHaveBeenCalled();
  });
});
