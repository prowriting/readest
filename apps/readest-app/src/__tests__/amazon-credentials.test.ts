// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  loadAmazonCredentials,
  saveAmazonCredentials,
} from '../../scripts/lib/amazon-credentials.mjs';
import { checkAmazonAccess } from '../../scripts/upload-amazon-appstore.mjs';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
const credentials = { clientId: 'test-client', clientSecret: 'test-secret' };
const encoded = Buffer.from(JSON.stringify(credentials)).toString('base64');
const run = vi.mocked(spawnSync);
const result = (stdout = '', status = 0) => ({
  status,
  stdout,
  stderr: '',
  pid: 1,
  output: [],
  signal: null,
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('Amazon release credentials', () => {
  it('uses a complete environment pair without opening Keychain on CI', () => {
    expect(
      loadAmazonCredentials({
        env: { AMAZON_CLIENT_ID: 'ci-id', AMAZON_CLIENT_SECRET: 'ci-secret' },
        platform: 'linux',
      }),
    ).toEqual({ appId: 'com.bookarc.app', clientId: 'ci-id', clientSecret: 'ci-secret' });
    expect(run).not.toHaveBeenCalled();
  });
  it('reads the app-specific Keychain entry when environment credentials are blank', () => {
    run.mockReturnValue(result(encoded));
    expect(
      loadAmazonCredentials({
        env: { AMAZON_CLIENT_ID: '', AMAZON_CLIENT_SECRET: '' },
        platform: 'darwin',
      }),
    ).toEqual({ appId: 'com.bookarc.app', ...credentials });
    expect(run.mock.calls[0]?.slice(0, 2)).toEqual([
      '/usr/bin/security',
      ['find-generic-password', '-s', 'bookarc.amazon-appstore', '-a', 'com.bookarc.app', '-w'],
    ]);
  });
  it('never mixes a partial environment pair with a different Keychain identity', () => {
    expect(() =>
      loadAmazonCredentials({ env: { AMAZON_CLIENT_ID: 'partial' }, platform: 'darwin' }),
    ).toThrow(/both/);
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    'linux',
    'win32',
  ])('explains missing credentials on %s without invoking security', (platform) => {
    expect(() => loadAmazonCredentials({ env: {}, platform })).toThrow(/AMAZON_CLIENT_ID/);
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { clientId: 'id' },
    { clientId: 'id', clientSecret: 42 },
  ])('rejects malformed Keychain payloads', (payload) => {
    run.mockReturnValue(result(Buffer.from(JSON.stringify(payload)).toString('base64')));
    expect(() => loadAmazonCredentials({ env: {}, platform: 'darwin' })).toThrow(/Keychain/);
  });
  it('does not expose Keychain output when access fails', () => {
    run.mockReturnValue({ ...result('private-data', 1), stderr: 'private-data' });
    expect(() => loadAmazonCredentials({ env: {}, platform: 'darwin' })).toThrow(
      'Cannot read Amazon credentials from Keychain.',
    );
  });
  it('writes secrets through stdin, not process arguments, and verifies persistence', () => {
    const special = { clientId: 'id', clientSecret: 'quote"\n$(echo secret)\\' };
    const secretData = Buffer.from(JSON.stringify(special)).toString('base64');
    run.mockReturnValueOnce(result()).mockReturnValueOnce(result(secretData));
    saveAmazonCredentials(special, { platform: 'darwin' });
    expect(run.mock.calls[0]?.slice(0, 2)).toEqual(['/usr/bin/security', ['-i']]);
    expect(run.mock.calls[0]?.[2]).toMatchObject({
      input: `add-generic-password -U -s bookarc.amazon-appstore -a com.bookarc.app -w ${secretData}\n`,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('fails when interactive security reports success but saved nothing', () => {
    run.mockReturnValueOnce(result()).mockReturnValueOnce(result('', 44));
    expect(() => saveAmazonCredentials(credentials, { platform: 'darwin' })).toThrow(/Keychain/);
  });
});

describe('Amazon connection check', () => {
  it('uses the documented scope and only reads the existing draft', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'token' }))
      .mockResolvedValueOnce(Response.json({ id: 'existing-draft', status: 'IN_PROGRESS' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkAmazonAccess({ appId: 'com.bookarc.app', ...credentials })).resolves.toEqual({
      appAccessible: true,
      editId: 'existing-draft',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const auth = fetchMock.mock.calls[0];
    expect(auth?.[0]).toBe('https://api.amazon.com/auth/o2/token');
    expect(auth?.[1].body.get('scope')).toBe('appstore::apps:readwrite');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer token' },
    });
  });
  it('accepts an empty successful response when no draft is open', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'token' }))
        .mockResolvedValueOnce(new Response('')),
    );
    await expect(checkAmazonAccess({ appId: 'com.bookarc.app', ...credentials })).resolves.toEqual({
      appAccessible: true,
      editId: null,
    });
  });
  it('distinguishes authentication from an app not available via the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'token' }))
        .mockResolvedValueOnce(new Response('', { status: 404 })),
    );
    await expect(checkAmazonAccess({ appId: 'com.bookarc.app', ...credentials })).resolves.toEqual({
      appAccessible: false,
      editId: null,
    });
  });
  it.each([401, 403, 500])('fails rather than claiming success for HTTP %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'token' }))
        .mockResolvedValueOnce(new Response('private data', { status })),
    );
    await expect(checkAmazonAccess({ appId: 'com.bookarc.app', ...credentials })).rejects.toThrow(
      `HTTP ${status}`,
    );
  });
  it('never contacts the app API after failed authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('test-secret', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkAmazonAccess({ appId: 'com.bookarc.app', ...credentials })).rejects.toThrow(
      'Amazon authentication failed (HTTP 401).',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
