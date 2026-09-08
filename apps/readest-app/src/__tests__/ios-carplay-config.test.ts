import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('iOS CarPlay configuration', () => {
  test('keeps the CarPlay scene, background audio mode, and release entitlement', () => {
    const infoPlist = readFileSync(join(process.cwd(), 'src-tauri/Info.plist'), 'utf8');
    const entitlementScript = readFileSync(
      join(process.cwd(), 'scripts/apply-ios-entitlements.sh'),
      'utf8',
    );

    expect(infoPlist).toContain('CPTemplateApplicationSceneSessionRoleApplication');
    expect(infoPlist).toContain('<key>UISceneClassName</key>');
    expect(infoPlist).toContain('<string>CPTemplateApplicationScene</string>');
    expect(infoPlist).toContain('<string>audio</string>');
    expect(entitlementScript).toContain('<key>com.apple.developer.carplay-audio</key>');
    expect(entitlementScript).toContain('<true/>');
  });
});
