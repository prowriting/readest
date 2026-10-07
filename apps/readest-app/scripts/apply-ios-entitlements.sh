#!/usr/bin/env bash
# Prepare the generated iOS project for a valid App Store build:
#   1. Re-apply the Sign in with Apple, universal-links, and CarPlay audio entitlements.
#   2. Install the privacy manifest (src-tauri/PrivacyInfo.xcprivacy) into the iOS target.
#   3. Strip the alpha channel from the app icons (App Store rejects icons with alpha).
#
# `src-tauri/gen` is gitignored and regenerated per machine, and `tauri ios init` writes
# an EMPTY entitlements file (and `tauri icon` generates RGBA icons). So this must run AFTER
# `pnpm tauri ios init` and BEFORE `pnpm tauri ios build` (the release script does this for
# you). Idempotent.
#
# The matching Apple-side setup: App ID `com.bookarc.app` (team BYFE3Y9258) with Sign in
# with Apple enabled and grouped under primary App ID `app.bookarc.reader`, plus the AASA
# at public/.well-known/apple-app-site-association (appID BYFE3Y9258.com.bookarc.app), and
# Apple's CarPlay audio-app entitlement approval for the same App ID.
set -euo pipefail

APP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENTITLEMENTS="$APP_ROOT/src-tauri/gen/apple/Bookarc_iOS/Bookarc_iOS.entitlements"

if [[ ! -f "$ENTITLEMENTS" ]]; then
  echo "error: $ENTITLEMENTS not found — run 'pnpm tauri ios init' first." >&2
  exit 1
fi

cat > "$ENTITLEMENTS" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.applesignin</key>
	<array>
		<string>Default</string>
	</array>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:web.bookarc.app</string>
	</array>
	<key>com.apple.developer.carplay-audio</key>
	<true/>
</dict>
</plist>
PLIST

echo "Applied Sign in with Apple + associated-domains + CarPlay audio entitlements to:"
echo "  $ENTITLEMENTS"

# App Store uploads need a privacy manifest for the required-reason APIs the binary uses
# (ITMS-91053). The tracked source is src-tauri/PrivacyInfo.xcprivacy; this copies it into the
# generated project and registers it as a resource of the iOS target.
node "$APP_ROOT/scripts/ios/add-privacy-manifest.mjs"

# App Store Connect rejects app icons that carry an alpha channel, but `tauri icon` /
# `tauri ios init` generate them from an RGBA source. The BookArc icon is fully opaque, so
# dropping alpha is lossless. Flatten every AppIcon PNG to RGB.
ICONSET="$APP_ROOT/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset"
if [[ -d "$ICONSET" ]] && command -v python3 >/dev/null 2>&1 && python3 -c "import PIL" >/dev/null 2>&1; then
  python3 - "$ICONSET" <<'PY'
import glob, os, sys
from PIL import Image
d = sys.argv[1]
n = 0
for f in glob.glob(os.path.join(d, "*.png")):
    Image.open(f).convert("RGB").save(f)
    n += 1
print(f"Flattened {n} iOS app icons to RGB (removed alpha) in {d}")
PY
else
  echo "warning: python3 + Pillow not found — iOS app icons may still carry an alpha channel," >&2
  echo "         which App Store Connect rejects. Install with: python3 -m pip install Pillow" >&2
fi
