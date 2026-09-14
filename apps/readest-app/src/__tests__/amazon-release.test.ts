// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  amazonManifest,
  amazonGradle,
  parseApkBadging,
} from '../../scripts/lib/amazon-release.mjs';
import { uploadAmazonRelease } from '../../scripts/upload-amazon-appstore.mjs';

afterEach(() => vi.unstubAllGlobals());

describe('Amazon APK preparation', () => {
  it('restores generated files when the Android build fails and cannot reuse a stale APK', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bookarc-amazon-build-test-'));
    const put = (path: string, content: string, executable = false) => {
      const full = join(dir, path);
      mkdirSync(full.substring(0, full.lastIndexOf('/')), { recursive: true });
      writeFileSync(full, content, { mode: executable ? 0o755 : 0o644 });
    };
    try {
      put(
        'scripts/lib/amazon-release.mjs',
        readFileSync(resolve('scripts/lib/amazon-release.mjs'), 'utf8'),
      );
      copyFileSync(
        resolve('scripts/release-amazon-appstore.mjs'),
        join(dir, 'scripts/release-amazon-appstore.mjs'),
      );
      put('scripts/setup-android-signing.mjs', '');
      put('package.json', JSON.stringify({ version: '1.0.0' }));
      put(
        'release-notes.json',
        JSON.stringify({ releases: { '1.0.0': { notes: ['Test release'] } } }),
      );
      put(
        'src-tauri/tauri.conf.json',
        JSON.stringify({
          identifier: 'com.bookarc.app',
          bundle: { android: { minSdkVersion: 26 } },
        }),
      );
      const gradle = 'android {\n defaultConfig {\n applicationId = "com.bookarc.app"\n }\n}';
      const manifest =
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application></application></manifest>';
      put('src-tauri/gen/android/app/build.gradle.kts', gradle);
      put('src-tauri/gen/android/app/src/main/AndroidManifest.xml', manifest);
      put(
        'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk',
        'STALE',
      );
      put('sdk/build-tools/36.0.0/apksigner', '#!/bin/sh\nexit 0\n', true);
      put('sdk/build-tools/36.0.0/aapt', '#!/bin/sh\nexit 0\n', true);
      put('bin/pnpm', '#!/bin/sh\nexit 7\n', true);
      const result = spawnSync(
        process.execPath,
        [join(dir, 'scripts/release-amazon-appstore.mjs')],
        {
          env: {
            ...process.env,
            PATH: `${join(dir, 'bin')}:${process.env['PATH']}`,
            ANDROID_HOME: join(dir, 'sdk'),
          },
          encoding: 'utf8',
        },
      );
      expect(result.status).not.toBe(0);
      expect(readFileSync(join(dir, 'src-tauri/gen/android/app/build.gradle.kts'), 'utf8')).toBe(
        gradle,
      );
      expect(
        readFileSync(join(dir, 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'), 'utf8'),
      ).toBe(manifest);
      expect(() =>
        readFileSync(
          join(
            dir,
            'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk',
          ),
        ),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('removes TV targeting and overrides transitive installer and WebView startup entries', () => {
    const manifest = amazonManifest(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/><application><activity><intent-filter><category android:name="android.intent.category.LEANBACK_LAUNCHER"/></intent-filter></activity></application></manifest>`,
    );
    expect(manifest).not.toContain('LEANBACK_LAUNCHER');
    expect(manifest).toContain('android.permission.REQUEST_INSTALL_PACKAGES" tools:node="remove"');
    expect(manifest).toContain(
      'com.readest.webview_upgrade.WebViewUpgradeInitializer" tools:node="remove"',
    );
    expect(amazonManifest(manifest)).toBe(manifest);
  });
  it('selects foss even when the generated project already selects Google Play', () => {
    expect(
      amazonGradle('defaultConfig {\n missingDimensionStrategy("store", "googleplay")\n}'),
    ).toContain('missingDimensionStrategy("store", "foss")');
    expect(amazonGradle('defaultConfig {\n minSdk = 26\n}')).toContain('minSdk = 26');
    expect(() => amazonGradle('unexpected template')).toThrow();
  });
  it('verifies package identity and both Fire architectures in the built APK', () => {
    const badging =
      "package: name='com.bookarc.app' versionCode='12006' versionName='0.12.6'\nsdkVersion:'26'\nnative-code: 'armeabi-v7a' 'arm64-v8a'";
    expect(parseApkBadging(badging)).toMatchObject({
      versionCode: 12006,
      versionName: '0.12.6',
      minSdk: 26,
    });
    expect(() =>
      parseApkBadging(badging.replace('com.bookarc.app', 'com.bilingify.readest')),
    ).toThrow();
    expect(() => parseApkBadging(badging.replace(" 'armeabi-v7a'", ''))).toThrow();
  });
});

describe('Amazon upload protocol', () => {
  const release = { versionCode: 12006, releaseNotes: 'Fire tablet release' };
  function mockAmazon(failAt = '', existingVersion = 12005) {
    const requests: { path: string; method: string; headers: Headers; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = new URL(url).pathname;
        requests.push({
          path,
          method: init.method ?? 'GET',
          headers: new Headers(init.headers),
          body: init.body,
        });
        if (failAt && path.endsWith(failAt)) return new Response('failure', { status: 403 });
        let body: unknown = {};
        if (path.endsWith('/token')) body = { access_token: 'test-token' };
        else if (path.endsWith('/edits')) body = { id: 'edit-1' };
        else if (path.endsWith('/apks')) body = [{ id: 'apk-1', versionCode: existingVersion }];
        else if (path.endsWith('/listings/en-US'))
          body = { title: 'BookArc', recentChanges: 'Old notes', fullDescription: 'Keep this' };
        else if (path.endsWith('/edit-1')) body = { id: 'edit-1', status: 'IN_PROGRESS' };
        return Response.json(body, { headers: { etag: '"current-etag"' } });
      }),
    );
    return requests;
  }
  const options = {
    appId: 'com.bookarc.app',
    clientId: 'client',
    clientSecret: 'secret',
    release,
    apk: new Blob(['apk']),
  };

  it('replaces the existing APK to preserve targeting and leaves a draft by default', async () => {
    const requests = mockAmazon();
    await uploadAmazonRelease(options);
    const replacement = requests.find((r) => r.path.endsWith('/replace'));
    expect(replacement?.method).toBe('PUT');
    expect(replacement?.headers.get('content-type')).toBe('application/octet-stream');
    expect(replacement?.headers.get('if-match')).toBe('"current-etag"');
    expect(requests.some((r) => r.path.endsWith('/commit'))).toBe(false);
    const listing = requests.find((r) => r.path.endsWith('/listings/en-US') && r.method === 'PUT');
    expect(JSON.parse(String(listing?.body))).toMatchObject({
      title: 'BookArc',
      fullDescription: 'Keep this',
      recentChanges: release.releaseNotes,
    });
  });
  it('validates before an explicit submission and sends a fresh edit ETag', async () => {
    const requests = mockAmazon();
    await uploadAmazonRelease({ ...options, submit: true });
    expect(requests.at(-3)?.path).toMatch(/\/validate$/);
    expect(requests.at(-2)?.method).toBe('GET');
    expect(requests.at(-1)?.path).toMatch(/\/commit$/);
    expect(requests.at(-1)?.headers.get('if-match')).toBe('"current-etag"');
  });
  it('never commits after a failed upload', async () => {
    const requests = mockAmazon('/replace');
    await expect(uploadAmazonRelease({ ...options, submit: true })).rejects.toThrow();
    expect(requests.some((r) => r.path.endsWith('/commit'))).toBe(false);
  });

  it.each([
    '/edits',
    '/listings/en-US',
    '/validate',
  ])('does not submit when %s fails', async (path) => {
    const requests = mockAmazon(path);
    await expect(uploadAmazonRelease({ ...options, submit: true })).rejects.toThrow();
    expect(requests.some((r) => r.path.endsWith('/commit'))).toBe(false);
  });
  it('rejects a non-increasing version before replacing the binary', async () => {
    const requests = mockAmazon('', 12006);
    await expect(uploadAmazonRelease(options)).rejects.toThrow(/versionCode/);
    expect(requests.some((r) => r.path.endsWith('/replace'))).toBe(false);
  });

  it.each([
    undefined,
    '',
    42,
  ])('rejects an invalid access token before creating an edit', async (token) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: token }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadAmazonRelease(options)).rejects.toThrow(/access token/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses replacement without an ETag and never submits', async () => {
    const requests = mockAmazon();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const response = await originalFetch(url, init);
        if (url.endsWith('/apks/apk-1')) response.headers.delete('etag');
        return response;
      }),
    );
    await expect(uploadAmazonRelease({ ...options, submit: true })).rejects.toThrow(/ETag/);
    expect(requests.some((r) => r.path.endsWith('/replace') || r.path.endsWith('/commit'))).toBe(
      false,
    );
  });

  it('makes connection checks mutually exclusive with uploads before any credential lookup', () => {
    const execution = spawnSync(
      process.execPath,
      ['scripts/upload-amazon-appstore.mjs', '--check-access', '--submit'],
      { encoding: 'utf8' },
    );
    expect(execution.status).toBe(1);
    expect(execution.stderr).toContain('--check-access cannot be combined');
  });

  it('verifies a local artifact in dry-run without needing credentials or contacting Amazon', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bookarc-amazon-dry-run-'));
    try {
      writeFileSync(join(dir, 'bookarc.apk'), 'apk');
      writeFileSync(
        join(dir, 'release.json'),
        JSON.stringify({
          channel: 'amazon',
          packageName: 'com.bookarc.app',
          versionName: '1.0.0',
          versionCode: 1,
          sha256: createHash('sha256').update('apk').digest('hex'),
        }),
      );
      const execution = spawnSync(
        process.execPath,
        ['scripts/upload-amazon-appstore.mjs', '--artifact', dir, '--dry-run'],
        {
          encoding: 'utf8',
          env: { ...process.env, AMAZON_CLIENT_ID: 'incomplete', AMAZON_CLIENT_SECRET: '' },
        },
      );
      expect(execution.status, execution.stderr).toBe(0);
      expect(execution.stdout).toContain('No network requests made');
      writeFileSync(join(dir, 'bookarc.apk'), 'changed');
      const corrupted = spawnSync(
        process.execPath,
        ['scripts/upload-amazon-appstore.mjs', '--artifact', dir, '--dry-run'],
        { encoding: 'utf8' },
      );
      expect(corrupted.status).toBe(1);
      expect(corrupted.stderr).toContain('does not match');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
