#!/bin/bash

set -e

VERSION=$(jq -r '.version' package.json)
MANIFEST="./src-tauri/gen/android/app/src/main/AndroidManifest.xml"
INSTALL_PERMISSION_LINE='<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>'
STORAGE_PERMISSION_LINE='<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE"/>'

ised() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi

  return $?
}

# --- REMOVE PERMISSION BEFORE BUILD ---
if grep -q 'REQUEST_INSTALL_PACKAGES' "$MANIFEST"; then
  echo "🧹 Removing REQUEST_INSTALL_PACKAGES from AndroidManifest.xml"
  if ised "/REQUEST_INSTALL_PACKAGES/d" "$MANIFEST"; then
    echo "✅ Successfully removed REQUEST_INSTALL_PACKAGES"
  else
    echo "❌ Failed to remove REQUEST_INSTALL_PACKAGES" >&2
    exit 1
  fi
fi

if grep -q 'MANAGE_EXTERNAL_STORAGE' "$MANIFEST"; then
  echo "🧹 Removing MANAGE_EXTERNAL_STORAGE from AndroidManifest.xml"
  if ised "/MANAGE_EXTERNAL_STORAGE/d" "$MANIFEST"; then
    echo "✅ Successfully removed MANAGE_EXTERNAL_STORAGE"
  else
    echo "❌ Failed to remove MANAGE_EXTERNAL_STORAGE" >&2
    exit 1
  fi
fi

source .env.google-play.local

echo "🔐 Wiring Android release signing"
node scripts/setup-android-signing.mjs

echo "🚀 Running: pnpm tauri android build (googleplay flavor)"
ORG_GRADLE_PROJECT_storeFlavor=googleplay pnpm tauri android build --config src-tauri/tauri.playstore.conf.json

# --- ADD PERMISSION BACK AFTER BUILD ---
if ! grep -q 'REQUEST_INSTALL_PACKAGES' "$MANIFEST"; then
  echo "♻️  Restoring REQUEST_INSTALL_PACKAGES in AndroidManifest.xml"
  ised "/android.permission.INTERNET/a\\
    $INSTALL_PERMISSION_LINE
  " "$MANIFEST"
fi

if ! grep -q 'MANAGE_EXTERNAL_STORAGE' "$MANIFEST"; then
  echo "♻️  Restoring MANAGE_EXTERNAL_STORAGE in AndroidManifest.xml"
  ised "/android.permission.WRITE_EXTERNAL_STORAGE/a\\
    $STORAGE_PERMISSION_LINE
  " "$MANIFEST"
fi

# --- VERIFY THE AAB IS SIGNED (fail here, not at Play upload) ---
AAB="./src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab"
if [[ ! -f "$AAB" ]]; then
  echo "❌ Expected AAB not found at $AAB" >&2
  exit 1
fi
JARSIGNER="$(command -v jarsigner || true)"
if [[ -z "$JARSIGNER" && -n "$(/usr/libexec/java_home 2>/dev/null)" ]]; then
  JARSIGNER="$(/usr/libexec/java_home)/bin/jarsigner"
fi
if [[ -x "$JARSIGNER" || -n "$JARSIGNER" ]]; then
  if "$JARSIGNER" -verify "$AAB" >/dev/null 2>&1; then
    echo "✅ AAB is signed: $AAB"
  else
    echo "❌ AAB is NOT signed — check keystore.properties and the release signingConfig" >&2
    exit 1
  fi
else
  echo "⚠️  jarsigner not found; skipping signature verification"
fi

if [[ -z "$GOOGLE_PLAY_JSON_KEY_FILE" ]]; then
  echo "❌ GOOGLE_PLAY_JSON_KEY_FILE is not set"
  exit 1
fi

# --- GENERATE CHANGELOG FOR GOOGLE PLAY ---
CHANGELOG_DIR="../../fastlane/metadata/android/en-US/changelogs"
mkdir -p "$CHANGELOG_DIR"

NOTES=$(jq -r --arg ver "$VERSION" '.releases[$ver].notes // empty | map("• " + .) | join("\n")' release-notes.json)
if [[ -n "$NOTES" ]]; then
  # Google Play has a 500-character limit for release notes per language
  if [[ ${#NOTES} -gt 480 ]]; then
    NOTES="${NOTES:0:477}..."
  fi
  echo "$NOTES" > "$CHANGELOG_DIR/default.txt"
  echo "📝 Release notes for v$VERSION written to changelogs/default.txt"
else
  echo "⚠️  No release notes found for v$VERSION in release-notes.json"
fi

cd ../../

fastlane android upload_production
