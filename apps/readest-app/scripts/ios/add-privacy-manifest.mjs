#!/usr/bin/env node
// Installs src-tauri/PrivacyInfo.xcprivacy into the generated (gitignored) Xcode project:
// copies the file next to the entitlements and registers it as a resource of the iOS target so
// it lands at the root of Bookarc.app. Idempotent. Run by scripts/apply-ios-entitlements.sh.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE_REF_ID = 'B00CA7C0C0DEF0000000F00D';
const BUILD_FILE_ID = 'B00CA7C0C0DEF0000000F00E';
const NAME = 'PrivacyInfo.xcprivacy';

/** Returns the pbxproj text with the manifest registered; unchanged when already present. */
export function addPrivacyManifest(pbxproj) {
  if (pbxproj.includes(NAME)) return pbxproj;

  const groupMarker = '/* Bookarc_iOS */ = {';
  const groupAt = pbxproj.indexOf(groupMarker);
  if (groupAt < 0) throw new Error('add-privacy-manifest: Bookarc_iOS group not found in project.pbxproj');
  const resourcesAt = pbxproj.indexOf('isa = PBXResourcesBuildPhase;');
  if (resourcesAt < 0) throw new Error('add-privacy-manifest: resources build phase not found in project.pbxproj');

  let out = pbxproj;

  out = out.replace(
    '/* End PBXBuildFile section */',
    `\t\t${BUILD_FILE_ID} /* ${NAME} in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF_ID} /* ${NAME} */; };\n/* End PBXBuildFile section */`,
  );
  out = out.replace(
    '/* End PBXFileReference section */',
    `\t\t${FILE_REF_ID} /* ${NAME} */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = ${NAME}; sourceTree = "<group>"; };\n/* End PBXFileReference section */`,
  );

  // Add to the Bookarc_iOS group's children (first "children = (" after the group marker).
  const groupChildren = out.indexOf('children = (', out.indexOf(groupMarker)) + 'children = ('.length;
  out = `${out.slice(0, groupChildren)}\n\t\t\t\t${FILE_REF_ID} /* ${NAME} */,${out.slice(groupChildren)}`;

  // Add to the resources phase's files list.
  const files = out.indexOf('files = (', out.indexOf('isa = PBXResourcesBuildPhase;')) + 'files = ('.length;
  out = `${out.slice(0, files)}\n\t\t\t\t${BUILD_FILE_ID} /* ${NAME} in Resources */,${out.slice(files)}`;

  return out;
}

function main() {
  const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const source = join(appRoot, 'src-tauri', NAME);
  const genApple = join(appRoot, 'src-tauri', 'gen', 'apple');
  const target = join(genApple, 'Bookarc_iOS', NAME);
  const pbxprojPath = join(genApple, 'Bookarc.xcodeproj', 'project.pbxproj');

  if (!existsSync(pbxprojPath)) {
    console.error(`error: ${pbxprojPath} not found — run 'pnpm tauri ios init' first.`);
    process.exit(1);
  }
  copyFileSync(source, target);
  const before = readFileSync(pbxprojPath, 'utf8');
  const after = addPrivacyManifest(before);
  if (after !== before) writeFileSync(pbxprojPath, after);
  console.log(`${after === before ? 'Privacy manifest already registered' : 'Registered privacy manifest'} in Bookarc_iOS: ${target}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
