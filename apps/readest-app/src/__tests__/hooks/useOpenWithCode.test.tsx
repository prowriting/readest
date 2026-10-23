import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  fetchBookByCode: vi.fn(),
  dispatch: vi.fn(),
  handlers: new Map<string, (event: CustomEvent) => void>(),
}));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ getCurrent: mocks.getCurrent }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, token: null }) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (value: string) => value }));
vi.mock('@/services/bookCode', () => ({
  fetchBookByCode: mocks.fetchBookByCode,
  BookCodeError: class extends Error {},
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: mocks.dispatch,
    on: (name: string, handler: (event: CustomEvent) => void) => mocks.handlers.set(name, handler),
    off: (name: string) => mocks.handlers.delete(name),
  },
}));

describe('guest claim deep links', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    localStorage.clear();
    mocks.getCurrent.mockResolvedValue(null);
    mocks.fetchBookByCode.mockResolvedValue({ downloadRef: 'guest-ref' });
  });

  it('resolves a cold-start claim without waiting for a signed-in user', async () => {
    mocks.getCurrent.mockResolvedValue(['bookarc://open?code=abc1234']);
    const { useOpenWithCode } = await import('@/hooks/useOpenWithCode');
    renderHook(() => useOpenWithCode());
    await waitFor(() => expect(mocks.fetchBookByCode).toHaveBeenCalledWith('abc1234'));
    expect(mocks.dispatch).toHaveBeenCalledWith('book-code-found', {
      result: { downloadRef: 'guest-ref' },
    });
  });

  it('resolves an incoming claim while signed out', async () => {
    const { useOpenWithCode } = await import('@/hooks/useOpenWithCode');
    renderHook(() => useOpenWithCode());
    await act(async () =>
      mocks.handlers.get('app-incoming-url')?.(
        new CustomEvent('app-incoming-url', {
          detail: { urls: ['bookarc://open?code=abc1234'] },
        }),
      ),
    );
    expect(mocks.fetchBookByCode).toHaveBeenCalledWith('abc1234');
    expect(localStorage.getItem('bookarc_pending_claim_url')).toBeNull();
  });

  it('replays a previously deferred claim without login and clears the saved URL', async () => {
    localStorage.setItem('bookarc_pending_claim_url', 'bookarc://open?code=old1234');
    const { useOpenWithCode } = await import('@/hooks/useOpenWithCode');
    renderHook(() => useOpenWithCode());
    await waitFor(() => expect(mocks.fetchBookByCode).toHaveBeenCalledWith('old1234'));
    expect(localStorage.getItem('bookarc_pending_claim_url')).toBeNull();
  });
});
