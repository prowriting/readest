import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { addPrivacyManifest } from '../../scripts/ios/add-privacy-manifest.mjs';

const root = process.cwd();

// Apple rejects uploads that use "required reason" APIs without a PrivacyInfo.xcprivacy
// (ITMS-91053). The native bridge uses UserDefaults and file timestamps, the dialog plugin
// reads modification dates, device-info reads disk space, and the Rust side links sysinfo.
describe('iOS privacy manifest', () => {
  const manifest = readFileSync(join(root, 'src-tauri/PrivacyInfo.xcprivacy'), 'utf8');

  test('declares no tracking and no tracking domains', () => {
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  });

  test('declares every required-reason API the binary uses with an approved reason', () => {
    const reasons: Record<string, string[]> = {
      NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1'],
      NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1', '3B52.1'],
      NSPrivacyAccessedAPICategoryDiskSpace: ['E174.1'],
      NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1'],
    };
    for (const [category, codes] of Object.entries(reasons)) {
      const block = manifest.split(category)[1]?.split('</dict>')[0] ?? '';
      expect(block, category).not.toBe('');
      for (const code of codes)
        expect(block, `${category} ${code}`).toContain(`<string>${code}</string>`);
    }
  });

  test('lists the account data the reader API stores', () => {
    for (const type of [
      'NSPrivacyCollectedDataTypeEmailAddress',
      'NSPrivacyCollectedDataTypeName',
      'NSPrivacyCollectedDataTypeUserID',
      'NSPrivacyCollectedDataTypeProductInteraction',
      'NSPrivacyCollectedDataTypeCrashData',
    ]) {
      expect(manifest).toContain(type);
    }
  });

  test('is installed into the generated Xcode project by the entitlements script', () => {
    const script = readFileSync(join(root, 'scripts/apply-ios-entitlements.sh'), 'utf8');
    expect(script).toContain('add-privacy-manifest.mjs');
  });
});

const FIXTURE = `// !$*UTF8*$!
{
	objects = {
/* Begin PBXBuildFile section */
		A48FE665545A275171423D6C /* LaunchScreen.storyboard in Resources */ = {isa = PBXBuildFile; fileRef = 75F4352B7B2C3B2D9BE02062 /* LaunchScreen.storyboard */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		75F4352B7B2C3B2D9BE02062 /* LaunchScreen.storyboard */ = {isa = PBXFileReference; lastKnownFileType = file.storyboard; path = LaunchScreen.storyboard; sourceTree = "<group>"; };
		04A4C540906E63B7ED879637 /* Bookarc_iOS.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = Bookarc_iOS.entitlements; sourceTree = "<group>"; };
/* End PBXFileReference section */

/* Begin PBXGroup section */
		AAAA0000000000000000AAAA /* Bookarc_iOS */ = {
			isa = PBXGroup;
			children = (
				04A4C540906E63B7ED879637 /* Bookarc_iOS.entitlements */,
			);
			path = Bookarc_iOS;
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXResourcesBuildPhase section */
		BBBB0000000000000000BBBB /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				A48FE665545A275171423D6C /* LaunchScreen.storyboard in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXResourcesBuildPhase section */
	};
}
`;

describe('add-privacy-manifest pbxproj patcher', () => {
  test('adds the manifest as a resource of the app target, inside the Bookarc_iOS group', () => {
    const out = addPrivacyManifest(FIXTURE);
    expect(out).toMatch(
      /PBXFileReference; lastKnownFileType = text\.xml; path = PrivacyInfo\.xcprivacy/,
    );
    expect(out).toMatch(
      /PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile; fileRef = /,
    );
    const group = out.split('/* Bookarc_iOS */ = {')[1]!.split('};')[0]!;
    expect(group).toContain('PrivacyInfo.xcprivacy');
    const resources = out.split('isa = PBXResourcesBuildPhase;')[1]!.split('};')[0]!;
    expect(resources).toContain('PrivacyInfo.xcprivacy in Resources');
  });

  test('is idempotent', () => {
    const once = addPrivacyManifest(FIXTURE);
    expect(addPrivacyManifest(once)).toBe(once);
  });

  test('refuses a project without the expected group or resources phase', () => {
    expect(() => addPrivacyManifest('{ objects = { }; }')).toThrow(/Bookarc_iOS group/);
  });
});
