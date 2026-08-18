# Sign in with Apple

Auth is brokered by **BookArcReaderApi** (`reader.bookarc.app`), not by the client directly.
Two flows exist:

- **Web / desktop / Android** — server-side redirect: the app opens
  `${API_BASE}/auth/apple`, the API redirects to Apple, Apple posts back to
  `https://reader.bookarc.app/api/auth/apple/callback`, and the API returns tokens.
- **Native iOS** — the `sign-in-with-apple` Tauri plugin returns an identity token +
  authorization code, which the app POSTs to `${API_BASE}/auth/apple/token`.

## Apple Developer account (team `BYFE3Y9258`, Orpheus Technology Ltd)

| Identifier | Kind | Role |
| --- | --- | --- |
| `app.bookarc.reader` | App ID (primary) | Anchors the Sign in with Apple key; the web Services ID and the iOS App ID group under it. |
| `com.bookarc.app` | App ID | The **iOS app's actual bundle id** (same as the Android package). Sign in with Apple enabled, grouped under `app.bookarc.reader`. |
| `app.bookarc.signin` | Services ID | Web/desktop `client_id`. Return URL `https://reader.bookarc.app/api/auth/apple/callback`. |
| `57YT397J7Z` | Key | Signs the client secret. Tied to `app.bookarc.reader`. |

Server config (`OAuth:Apple:*`) — local user-secrets and the prod container app:
`ClientId=app.bookarc.signin`, `BundleId=com.bookarc.app`, `TeamId=BYFE3Y9258`,
`KeyId=57YT397J7Z`, `PrivateKey=<the .p8>`.

> There are June duplicates (`app.bookarc.web` Services ID, key `5DAUL3CH7A`) that predate
> this setup. Once native iOS is verified, revoke the key and delete the Services ID.

## Building iOS with Sign in with Apple

`src-tauri/gen` is **gitignored** (regenerated per machine), and `tauri ios init` writes an
empty entitlements file — so the Sign in with Apple + associated-domains entitlements are
re-applied by a tracked script rather than committed inside `gen/apple`.

```bash
# once per machine / worktree:
pnpm tauri ios init                     # generates gen/apple (bundle com.bookarc.app, team BYFE3Y9258)
bash scripts/apply-ios-entitlements.sh  # adds com.apple.developer.applesignin + associated-domains

# build:
pnpm tauri ios build                    # or: bash scripts/release-ios-appstore.sh (runs the apply step for you)
```

Signing: with Xcode automatic signing (an account with access to `BYFE3Y9258`), the
provisioning profile with Sign in with Apple is created automatically. For CI, the App
Store Connect API key (`APPLE_API_KEY` / `APPLE_API_ISSUER`) handles it.

The universal-links entitlement (`applinks:web.bookarc.app`) matches
`public/.well-known/apple-app-site-association` (appID `BYFE3Y9258.com.bookarc.app`).
