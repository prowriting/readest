#!/usr/bin/env node
import { openAsBlob, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const API = 'https://developer.amazon.com/api/appstore/v1/applications';

/**
 * @param {{appId: string, clientId: string, clientSecret: string,
 * release: {versionCode: number, releaseNotes: string}, apk: Blob,
 * submit?: boolean, editId?: string, apkId?: string}} options
 */
export async function uploadAmazonRelease({ appId, clientId, clientSecret, release, apk,
  submit = false, editId, apkId }) {
  if (!appId || !clientId || !clientSecret) throw new Error('Set AMAZON_APP_ID, AMAZON_CLIENT_ID and AMAZON_CLIENT_SECRET.');
  if (!Number.isSafeInteger(release.versionCode) || release.versionCode <= 0 || !release.releaseNotes?.trim()) {
    throw new Error('Release requires a positive versionCode and release notes.');
  }
  const auth = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials',
      scope: 'appstore::apps:readwrite', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!auth.ok) throw new Error(`Amazon authentication failed (HTTP ${auth.status}).`);
  const { access_token: token } = await auth.json();
  if (!token) throw new Error('Amazon did not return an access token.');
  const root = `${API}/${encodeURIComponent(appId)}/edits`;
  async function request(url, method = 'GET', body, headers = {}) {
    const response = await fetch(url, { method, body,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!response.ok) {
      // Do not print authentication tokens, credentials or request bodies.
      throw new Error(`Amazon ${method} ${new URL(url).pathname}: HTTP ${response.status}. Inspect the edit in the Developer Console.`);
    }
    return response;
  }
  function etag(response) {
    const value = response.headers.get('etag');
    if (!value) throw new Error('Amazon response is missing its ETag; refusing an unprotected update.');
    return { 'If-Match': value };
  }

  // Never silently take over an existing console/API draft.
  if (!editId) {
    const edit = await (await request(root, 'POST')).json();
    editId = edit.id;
  }
  if (!editId) throw new Error('Amazon did not return an edit ID.');
  console.log(`Amazon edit: ${editId}. Keep this ID if an upload needs to be retried.`);
  const editUrl = `${root}/${encodeURIComponent(editId)}`;
  const apks = await (await request(`${editUrl}/apks`)).json();
  if (!Array.isArray(apks) || apks.length === 0) {
    throw new Error('Publish the first APK using the Amazon Developer Console before using this uploader.');
  }
  const current = apkId ? apks.find(a => a.id === apkId) : apks.length === 1 ? apks[0] : undefined;
  if (!current) throw new Error('Specify --apk-id when the app has multiple APKs; no targeting will be guessed.');
  if (!Number.isInteger(current.versionCode) || release.versionCode <= current.versionCode) {
    throw new Error(`APK versionCode must exceed ${current.versionCode}; build a new release.`);
  }
  const apkUrl = `${editUrl}/apks/${encodeURIComponent(current.id)}`;
  const existingApk = await request(apkUrl);
  await request(`${apkUrl}/replace`, 'PUT', apk, {
    ...etag(existingApk), 'Content-Type': 'application/vnd.android.package-archive',
  });
  // Replace preserves the manually tested device targeting from the published APK.
  const listingUrl = `${editUrl}/listings/en-US`;
  const listingResponse = await request(listingUrl);
  const listing = await listingResponse.json();
  await request(listingUrl, 'PUT', JSON.stringify({ ...listing, recentChanges: release.releaseNotes }), {
    ...etag(listingResponse), 'Content-Type': 'application/json',
  });
  await request(`${editUrl}/validate`, 'POST');
  if (submit) {
    const freshEdit = await request(editUrl);
    await request(`${editUrl}/commit`, 'POST', undefined, etag(freshEdit));
    console.log('Submitted to Amazon review.');
  } else {
    console.log('Validated Amazon draft; not submitted. Review it in the Developer Console.');
  }
  return editId;
}

async function main() {
  const { values } = parseArgs({ options: {
    artifact: { type: 'string' }, submit: { type: 'boolean', default: false },
    'edit-id': { type: 'string' }, 'apk-id': { type: 'string' },
    'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('upload-amazon-appstore --artifact dist/amazon/<version>-<code> [--dry-run] [--submit] [--edit-id ID] [--apk-id ID]');
    return;
  }
  if (!values.artifact) throw new Error('Provide --artifact with the directory printed by release-amazon-appstore.');
  const dir = resolve(values.artifact);
  const release = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
  const apkFile = join(dir, 'bookarc.apk');
  const digest = createHash('sha256').update(readFileSync(apkFile)).digest('hex');
  if (release.channel !== 'amazon' || release.packageName !== 'com.bookarc.app' || digest !== release.sha256) {
    throw new Error('APK does not match the verified Amazon release manifest. Rebuild before uploading.');
  }
  if (values['dry-run']) {
    console.log(`Verified local Amazon artifact: ${release.versionName} (${release.versionCode}). No network requests made.`);
    return;
  }
  await uploadAmazonRelease({ appId: process.env.AMAZON_APP_ID,
    clientId: process.env.AMAZON_CLIENT_ID, clientSecret: process.env.AMAZON_CLIENT_SECRET,
    release, apk: await openAsBlob(apkFile), submit: values.submit,
    editId: values['edit-id'], apkId: values['apk-id'],
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
