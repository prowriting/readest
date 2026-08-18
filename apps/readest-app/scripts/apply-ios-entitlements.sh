#!/usr/bin/env bash
# Re-apply the iOS entitlements that Sign in with Apple and universal links require.
#
# `src-tauri/gen` is gitignored and regenerated per machine, and `tauri ios init` writes
# an EMPTY entitlements file. So this must run AFTER `pnpm tauri ios init` and BEFORE
# `pnpm tauri ios build` (the release script does this for you). Idempotent.
#
# The matching Apple-side setup: App ID `com.bookarc.app` (team BYFE3Y9258) with Sign in
# with Apple enabled and grouped under primary App ID `app.bookarc.reader`, plus the AASA
# at public/.well-known/apple-app-site-association (appID BYFE3Y9258.com.bookarc.app).
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
</dict>
</plist>
PLIST

echo "Applied Sign in with Apple + associated-domains entitlements to:"
echo "  $ENTITLEMENTS"
