import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function androidTool(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('Set ANDROID_HOME to your Android SDK directory.');
  const root = join(sdk, 'build-tools');
  const version = readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .find(v => existsSync(join(root, v, name)));
  if (!version) throw new Error(`Android build-tools ${name} is not installed.`);
  return join(root, version, name);
}

export function amazonGradle(gradle) {
  if (!gradle.includes('defaultConfig {')) throw new Error('Missing Android defaultConfig block.');
  const strategy = 'missingDimensionStrategy("store", "foss")';
  if (/missingDimensionStrategy\("store",[^\n]+/.test(gradle)) {
    return gradle.replace(/missingDimensionStrategy\("store",[^\n]+/, strategy);
  }
  return gradle.replace('defaultConfig {', `defaultConfig {\n        ${strategy}`);
}

export function amazonManifest(manifest) {
  // Always override library manifests as well as the app's own permissions.
  if (manifest.includes('<!-- Amazon distribution -->')) return manifest;
  if (!manifest.includes('</application>')) throw new Error('Missing Android application element.');
  let result = manifest.replace(/<uses-permission\b[^>]*android:name="android.permission.(?:REQUEST_INSTALL_PACKAGES|MANAGE_EXTERNAL_STORAGE)"[^>]*\/>/g, '')
    .replace(/<(?:uses-feature|category)\b[^>]*android:name="(?:android.software.leanback|android.intent.category.LEANBACK_LAUNCHER)"[^>]*\/>/g, '');
  if (!result.includes('xmlns:tools=')) {
    result = result.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ');
  }
  result = result.replace('<application', `<!-- Amazon distribution -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" tools:node="remove" />
    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" tools:node="remove" />
    <application`);
  return result.replace('</application>', `
        <provider android:name="androidx.startup.InitializationProvider"
            android:authorities="\${applicationId}.androidx-startup"
            android:exported="false" tools:node="merge">
            <meta-data android:name="com.readest.webview_upgrade.WebViewUpgradeInitializer" tools:node="remove" />
        </provider>
    </application>`);
}

export function parseApkBadging(badging) {
  const pkg = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
  if (!pkg || pkg[1] !== 'com.bookarc.app') throw new Error('APK must have package com.bookarc.app.');
  const versionCode = Number(pkg[2]);
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) throw new Error('Invalid APK versionCode.');
  const nativeCode = badging.match(/^native-code: (.+)$/m)?.[1] ?? '';
  const architectures = [...nativeCode.matchAll(/'([^']+)'/g)].map(m => m[1]);
  if (!['armeabi-v7a', 'arm64-v8a'].every(abi => architectures.includes(abi))) {
    throw new Error('Amazon APK must include armeabi-v7a and arm64-v8a.');
  }
  return { packageName: pkg[1], versionCode, versionName: pkg[3],
    minSdk: Number(badging.match(/sdkVersion:'(\d+)'/)?.[1]), architectures };
}
