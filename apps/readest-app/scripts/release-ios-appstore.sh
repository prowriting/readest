#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# src-tauri/gen is gitignored; `tauri ios init` (run once beforehand) writes an EMPTY
# entitlements file, so re-apply Sign in with Apple / universal-link entitlements first.
bash scripts/apply-ios-entitlements.sh

pnpm tauri ios build --export-method app-store-connect

BUNDLE_DIR=src-tauri/gen/apple/build/arm64
IPA_BUNDLE=$BUNDLE_DIR/Bookarc.ipa

xcrun altool --upload-app --type ios --file "$IPA_BUNDLE" --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
