import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { exchangeAppleCredential } from '@/helpers/appleTokenExchange';
import type { AppleIDAuthorizationResponse } from '@/app/auth/utils/appleIdAuth';

const credential: AppleIDAuthorizationResponse = {
  userIdentifier: 'apple-user',
  givenName: null,
  familyName: null,
  email: null,
  authorizationCode: 'code-123',
  identityToken: 'id-token-123',
  state: null,
};

const marketing = {
  marketingOptIn: false,
  marketingPolicyVersion: 'p1',
  marketingWordingVersion: 'w1',
};

describe('exchangeAppleCredential', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('returns the session when the API accepts the token', async () => {
    const payload = {
      accessToken: 'access',
      refreshToken: 'refresh',
      user: { id: 'u1', email: 'a@b.c', displayName: 'A', plan: 'free', createdAt: '' },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    const result = await exchangeAppleCredential('https://api.test', credential, marketing);

    expect(result).toEqual({ ok: true, session: payload });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/auth/apple/token',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({
      idToken: 'id-token-123',
      authorizationCode: 'code-123',
      marketingOptIn: false,
      marketingPolicyVersion: 'p1',
      marketingWordingVersion: 'w1',
    });
  });

  it('fails without calling the API when Apple returned no identity token', async () => {
    const result = await exchangeAppleCredential(
      'https://api.test',
      { ...credential, identityToken: null },
      marketing,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/identity token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the API error body when the exchange is rejected', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid Apple identity token' }), { status: 401 }),
    );

    const result = await exchangeAppleCredential('https://api.test', credential, marketing);

    expect(result).toEqual({ ok: false, error: 'Invalid Apple identity token', status: 401 });
  });

  it('falls back to the HTTP status when the API error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));

    const result = await exchangeAppleCredential('https://api.test', credential, marketing);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(502);
    expect(result.ok === false && result.error).toMatch(/502/);
  });
});
