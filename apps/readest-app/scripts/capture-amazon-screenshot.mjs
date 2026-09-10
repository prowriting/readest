#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

try {
  const { values } = parseArgs({ options: {
    artifact: { type: 'string' }, name: { type: 'string' }, serial: { type: 'string' },
  } });
  if (!values.artifact || !values.name || !/^[a-z0-9-]+$/.test(values.name) || !values.serial) {
    throw new Error('Use --artifact RELEASE_DIRECTORY --name library --serial FIRE_DEVICE_SERIAL.');
  }
  const release = JSON.parse(readFileSync(join(values.artifact, 'release.json'), 'utf8'));
  const adb = (...args) => execFileSync('adb', ['-s', values.serial, ...args], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }).trim();
  const manufacturer = adb('shell', 'getprop', 'ro.product.manufacturer');
  if (manufacturer.toLowerCase() !== 'amazon') throw new Error('Connect an Amazon Fire tablet to capture Fire screenshots.');
  const installed = adb('shell', 'dumpsys', 'package', 'com.bookarc.app');
  const versionCode = Number(installed.match(/versionCode=(\d+)/)?.[1]);
  if (release.channel !== 'amazon' || versionCode !== release.versionCode) {
    throw new Error('Install the verified Amazon release APK before capturing screenshots.');
  }
  const png = execFileSync('adb', ['-s', values.serial, 'exec-out', 'screencap', '-p'], {
    maxBuffer: 32 * 1024 * 1024,
  });
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const sizes = ['800x480', '1024x600', '1280x720', '1280x800', '1920x1080', '1920x1200', '2560x1600'];
  if (!sizes.includes(`${Math.max(width, height)}x${Math.min(width, height)}`)) {
    throw new Error(`Screenshot ${width}x${height} is outside Amazon's documented tablet sizes.`);
  }
  const output = resolve(values.artifact, 'screenshots');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, `${values.name}.png`), png);
  writeFileSync(join(output, 'device.json'), `${JSON.stringify({
    manufacturer, model: adb('shell', 'getprop', 'ro.product.model'),
    os: adb('shell', 'getprop', 'ro.build.display.id'),
    sdk: adb('shell', 'getprop', 'ro.build.version.sdk'),
    webview: adb('shell', 'dumpsys', 'webviewupdate'),
    versionCode, apkSha256: release.sha256,
  }, null, 2)}\n`);
  console.log(`Captured ${join(output, `${values.name}.png`)}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
