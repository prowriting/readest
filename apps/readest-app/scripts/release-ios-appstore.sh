#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The web bundle only initializes the native shell when NEXT_PUBLIC_APP_PLATFORM=tauri;
# without it the app builds but launches to a black screen. Default it here so the build
# is correct even if the env file that normally sets it isn't loaded.
: "${NEXT_PUBLIC_APP_PLATFORM:=tauri}"
export NEXT_PUBLIC_APP_PLATFORM

# src-tauri/gen is gitignored; `tauri ios init` (run once beforehand) writes an EMPTY
# entitlements file and RGBA icons, so re-apply the entitlements and flatten the icons first.
bash scripts/apply-ios-entitlements.sh

pnpm tauri ios build --export-method app-store-connect

BUNDLE_DIR=src-tauri/gen/apple/build/arm64
IPA_BUNDLE=$BUNDLE_DIR/Bookarc.ipa

xcrun altool --upload-app --type ios --file "$IPA_BUNDLE" --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
