#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { androidTool, amazonGradle, amazonManifest, parseApkBadging } from './lib/amazon-release.mjs';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const { values } = parseArgs({ options: {
  'version-code': { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('release-amazon-appstore [--version-code INTEGER]\nBuilds and verifies a signed APK; does not upload or submit.');
  process.exit(0);
}

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
const capture = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const androidDir = 'src-tauri/gen/android';
let restore;
const cleanup = () => { restore?.(); restore = undefined; };
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

try {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  if (config.identifier !== 'com.bookarc.app') throw new Error('Run this release from the BookArc checkout.');
  const notes = JSON.parse(readFileSync('release-notes.json', 'utf8')).releases[version]?.notes;
  if (!Array.isArray(notes) || !notes.length || notes.some(n => typeof n !== 'string')) {
    throw new Error(`Add release notes for ${version} before building.`);
  }
  const overrideCode = values['version-code'] ?? process.env.AMAZON_VERSION_CODE;
  if (overrideCode && (!/^\d+$/.test(overrideCode) || Number(overrideCode) < 1 || Number(overrideCode) > 2100000000)) {
    throw new Error('Amazon version code must be an integer between 1 and 2100000000.');
  }
  // Force these after dotenv loading; a copied Play environment cannot change the Amazon channel.
  Object.assign(process.env, { NEXT_PUBLIC_APP_PLATFORM: 'tauri', NEXT_PUBLIC_DIST_CHANNEL: 'amazon',
    NEXT_PUBLIC_DISABLE_UPDATER: 'true', ORG_GRADLE_PROJECT_storeFlavor: 'foss' });
  const apksigner = androidTool('apksigner');
  const aapt = androidTool('aapt');
  if (!existsSync(join(androidDir, 'app/build.gradle.kts'))) run('pnpm', ['tauri', 'android', 'init', '--ci']);
  run('node', ['scripts/setup-android-signing.mjs']);
  const manifestFile = join(androidDir, 'app/src/main/AndroidManifest.xml');
  const gradleFile = join(androidDir, 'app/build.gradle.kts');
  const manifest = readFileSync(manifestFile, 'utf8');
  const gradle = readFileSync(gradleFile, 'utf8');
  if (!gradle.includes('com.bookarc.app')) throw new Error('Generated Android project is not BookArc; regenerate with pnpm tauri android init.');
  restore = () => { writeFileSync(manifestFile, manifest); writeFileSync(gradleFile, gradle); };
  writeFileSync(manifestFile, amazonManifest(manifest));
  writeFileSync(gradleFile, amazonGradle(gradle));
  const overlay = { bundle: { createUpdaterArtifacts: false, android: {
    ...(overrideCode ? { versionCode: Number(overrideCode) } : {}),
  } } };
  const apkFile = join(androidDir, 'app/build/outputs/apk/universal/release/app-universal-release.apk');
  // A failed build must never leave an old APK looking like a new release.
  rmSync(apkFile, { force: true });
  run('pnpm', ['tauri', 'android', 'build', '--apk', '--target', 'aarch64', 'armv7', '--config', JSON.stringify(overlay)]);
  capture(apksigner, ['verify', '--verbose', '--print-certs', apkFile]);
  const metadata = parseApkBadging(capture(aapt, ['dump', 'badging', apkFile]));
  if (metadata.versionName !== version || metadata.minSdk !== config.bundle.android.minSdkVersion ||
      (overrideCode && metadata.versionCode !== Number(overrideCode))) {
    throw new Error('Built APK version or minimum SDK does not match the requested release.');
  }
  const mergedManifest = capture(aapt, ['dump', 'xmltree', apkFile, 'AndroidManifest.xml']);
  for (const forbidden of ['REQUEST_INSTALL_PACKAGES', 'MANAGE_EXTERNAL_STORAGE', 'LEANBACK_LAUNCHER', 'WebViewUpgradeInitializer', 'com.android.vending.BILLING']) {
    if (mergedManifest.includes(forbidden)) throw new Error(`Amazon APK still contains ${forbidden}.`);
  }
  const dependencies = capture(join(resolve(androidDir), 'gradlew'), ['-p', resolve(androidDir), ':app:dependencies', '--configuration', 'universalReleaseRuntimeClasspath']);
  if (/com\.android\.billingclient|com\.google\.android\.gms|com\.android\.installreferrer/.test(dependencies)) {
    throw new Error('Amazon release still depends on Google Play services.');
  }
  const dir = `dist/amazon/${version}-${metadata.versionCode}`;
  mkdirSync(dir, { recursive: true });
  copyFileSync(apkFile, join(dir, 'bookarc.apk'));
  const releaseNotes = notes.map(note => `• ${note}`).join('\n');
  const release = { channel: 'amazon', ...metadata, releaseNotes,
    sha256: createHash('sha256').update(readFileSync(apkFile)).digest('hex') };
  writeFileSync(join(dir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  writeFileSync(join(dir, 'release-notes.txt'), `${releaseNotes}\n`);
  writeFileSync(join(dir, 'signature.txt'), capture(apksigner, ['verify', '--verbose', '--print-certs', apkFile]));
  console.log(`Verified Amazon release: ${resolve(dir)}\nUpload the first release in the Developer Console; for updates use pnpm upload-amazon-appstore --artifact ${dir}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
