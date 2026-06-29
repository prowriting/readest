import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuthUser } from '@/context/AuthContext';

import { handleAuthCallback } from '@/helpers/auth';

const fakeUser: AuthUser = {
  id: 'user-123',
  email: 'test@example.com',
  displayName: 'Test User',
  plan: 'free',
  createdAt: '2024-01-01T00:00:00Z',
};

describe('handleAuthCallback', () => {
  let mockLogin: ReturnType<typeof vi.fn<(accessToken: string, user: AuthUser) => void>>;
  let mockNavigate: ReturnType<typeof vi.fn<(path: string) => void>>;

  beforeEach(() => {
    mockLogin = vi.fn<(accessToken: string, user: AuthUser) => void>();
    mockNavigate = vi.fn<(path: string) => void>();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should navigate to /auth/error when error is present', async () => {
    handleAuthCallback({
      accessToken: 'token',
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
      error: 'some_error',
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/auth/error');
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should navigate to /library when accessToken is missing', async () => {
    handleAuthCallback({
      accessToken: null,
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/library');
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should navigate to /library when refreshToken is missing', async () => {
    handleAuthCallback({
      accessToken: 'token',
      refreshToken: null,
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/library');
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should navigate to /library when both tokens are missing', async () => {
    handleAuthCallback({
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/library');
    });
  });

  it('should navigate to /auth/error when /auth/me returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    handleAuthCallback({
      accessToken: 'bad-token',
      refreshToken: 'bad-refresh',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/auth/error');
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should login and navigate to next URL on successful auth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fakeUser }));

    handleAuthCallback({
      accessToken: 'good-token',
      refreshToken: 'good-refresh',
      login: mockLogin,
      navigate: mockNavigate,
      next: '/reader',
    });

    await vi.waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('good-token', fakeUser);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/reader');
  });

  it('should default next to "/" when not specified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fakeUser }));

    handleAuthCallback({
      accessToken: 'token',
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('should navigate to /auth/recovery when type is "recovery"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fakeUser }));

    handleAuthCallback({
      accessToken: 'token',
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
      type: 'recovery',
      next: '/some-page',
    });

    await vi.waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('token', fakeUser);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/auth/recovery');
    expect(mockNavigate).not.toHaveBeenCalledWith('/some-page');
  });

  it('should navigate to /auth/error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    handleAuthCallback({
      accessToken: 'token',
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/auth/error');
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });
});
