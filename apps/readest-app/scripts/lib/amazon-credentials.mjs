import { spawnSync } from 'node:child_process';

const SERVICE = 'bookarc.amazon-appstore';
const DEFAULT_APP = 'com.bookarc.app';

function validPair(value) {
  return value && typeof value.clientId === 'string' && value.clientId.trim()
    && typeof value.clientSecret === 'string' && value.clientSecret.trim();
}

function readKeychain(appId) {
  const result = spawnSync('/usr/bin/security', [
    'find-generic-password', '-s', SERVICE, '-a', appId, '-w',
  ], { encoding: 'utf8', timeout: 30_000 });
  try {
    if (result.status !== 0) throw new Error();
    const pair = JSON.parse(Buffer.from(result.stdout.trim(), 'base64').toString('utf8'));
    if (!validPair(pair)) throw new Error();
    return { clientId: pair.clientId, clientSecret: pair.clientSecret };
  } catch {
    throw new Error('Cannot read Amazon credentials from Keychain.');
  }
}

/** @param {{env?: Record<string, string | undefined>, platform?: string}} [options] */
export function loadAmazonCredentials({ env = process.env, platform = process.platform } = {}) {
  const appId = env.AMAZON_APP_ID?.trim() || DEFAULT_APP;
  const clientId = env.AMAZON_CLIENT_ID?.trim();
  const clientSecret = env.AMAZON_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) return { appId, clientId, clientSecret };
  if (clientId || clientSecret) throw new Error('Set both AMAZON_CLIENT_ID and AMAZON_CLIENT_SECRET, or leave both unset to use Keychain.');
  if (platform !== 'darwin') throw new Error('Set AMAZON_CLIENT_ID and AMAZON_CLIENT_SECRET in CI secrets.');
  return { appId, ...readKeychain(appId) };
}

export function saveAmazonCredentials(pair, { platform = process.platform } = {}) {
  if (platform !== 'darwin') throw new Error('Keychain configuration requires macOS.');
  if (!validPair(pair)) throw new Error('Provide clientId and clientSecret.');
  // Base64 keeps arbitrary credential characters out of security's command grammar.
  // Keychain encrypts the stored value. Secrets never appear in process arguments.
  const encoded = Buffer.from(JSON.stringify({ clientId: pair.clientId, clientSecret: pair.clientSecret })).toString('base64');
  const result = spawnSync('/usr/bin/security', ['-i'], {
    input: `add-generic-password -U -s ${SERVICE} -a ${DEFAULT_APP} -w ${encoded}\n`,
    encoding: 'utf8', timeout: 30_000,
  });
  if (result.status !== 0) throw new Error('Cannot save Amazon credentials to Keychain.');
  // security -i can exit successfully even when an individual command failed.
  const saved = readKeychain(DEFAULT_APP);
  if (saved.clientId !== pair.clientId || saved.clientSecret !== pair.clientSecret) {
    throw new Error('Amazon Keychain verification failed.');
  }
}
