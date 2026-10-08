import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/environment', () => ({ getAPIBaseUrl: () => 'https://reader.test/api' }));

const now = 1_789_070_000_000;
const user = {
  id: 'reviewer',
  email: 'reviewer@example.test',
  plan: 'free',
  createdAt: '2026-01-01',
};
const jwt = (expires: number) =>
  `header.${btoa(JSON.stringify({ sub: user.id, exp: expires }))}.signature`;
const expired = jwt(now / 1000 - 10);
const fresh = jwt(now / 1000 + 3600);
const seed = (token = expired, refresh = 'refresh-1') => {
  localStorage.setItem('token', token);
  localStorage.setItem('refresh_token', refresh);
  localStorage.setItem('user', JSON.stringify(user));
};
const response = () => Response.json({ accessToken: fresh, refreshToken: 'refresh-2', user });

describe('authenticated access token lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes an expired stored token before sync uses it', async () => {
    seed();
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const { getAccessToken } = await import('@/utils/access');
    expect(await getAccessToken()).toBe(fresh);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://reader.test/api/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'refresh-1' }),
      }),
    );
    expect(localStorage.getItem('refresh_token')).toBe('refresh-2');
  });

  it('refreshes just before expiry so a request does not start with a dying token', async () => {
    seed(jwt(now / 1000 + 30));
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const { getAccessToken } = await import('@/utils/access');
    expect(await getAccessToken()).toBe(fresh);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('shares one rotating refresh across simultaneous book, note, config and file requests', async () => {
    seed();
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { getAccessToken } = await import('@/utils/access');
    const pending = Array.from({ length: 10 }, () => getAccessToken());
    expect(fetchMock).toHaveBeenCalledOnce();
    resolve(response());
    expect(await Promise.all(pending)).toEqual(Array(10).fill(fresh));
  });

  it('uses a healthy token without a network request', async () => {
    seed(fresh);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { getAccessToken } = await import('@/utils/access');
    expect(await getAccessToken()).toBe(fresh);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not contact the server for a signed-out session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { getAccessToken } = await import('@/utils/access');
    expect(await getAccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])('clears a rejected refresh session on HTTP %s', async (status) => {
    seed();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    const { getAccessToken } = await import('@/utils/access');
    expect(await getAccessToken()).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it.each([
    429, 500, 503,
  ])('preserves the session on temporary HTTP %s and retries later', async (status) => {
    seed();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetchMock);
    const { getAccessToken } = await import('@/utils/access');
    await expect(getAccessToken()).rejects.toThrow();
    expect(localStorage.getItem('token')).toBe(expired);
    expect(localStorage.getItem('refresh_token')).toBe('refresh-1');
    expect(await getAccessToken()).toBe(fresh);
  });

  it('preserves an offline session and recovers when connectivity returns', async () => {
    seed();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetchMock);
    const { getAccessToken } = await import('@/utils/access');
    await expect(getAccessToken()).rejects.toThrow();
    expect(localStorage.getItem('refresh_token')).toBe('refresh-1');
    expect(await getAccessToken()).toBe(fresh);
  });

  it('never restores a logged-out session when an old refresh finishes', async () => {
    seed();
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    const { getAccessToken } = await import('@/utils/access');
    const pending = getAccessToken();
    localStorage.clear();
    resolve(response());
    await expect(pending).rejects.toThrow('Session changed');
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it.each([
    200, 401,
  ])('does not overwrite or clear a newer login when an old refresh returns %s', async (status) => {
    seed();
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    const { getAccessToken } = await import('@/utils/access');
    const pending = getAccessToken();
    seed('new-account-token', 'new-account-refresh');
    resolve(status === 200 ? response() : new Response('', { status }));
    await expect(pending).rejects.toThrow('Session changed');
    expect(localStorage.getItem('token')).toBe('new-account-token');
    expect(localStorage.getItem('refresh_token')).toBe('new-account-refresh');
  });

  it('rejects an incomplete refresh response without corrupting stored credentials', async () => {
    seed();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ accessToken: fresh })));
    const { getAccessToken } = await import('@/utils/access');
    await expect(getAccessToken()).rejects.toThrow();
    expect(localStorage.getItem('token')).toBe(expired);
    expect(localStorage.getItem('refresh_token')).toBe('refresh-1');
  });
});
