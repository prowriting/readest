# App Store release checklist (iOS)

Status as of 2026-10-07. Supersedes the "Store follow-up" notes in
[ios-device-test-2026-09-11.md](ios-device-test-2026-09-11.md).

## Done

- **CarPlay Audio entitlement**: approved by Apple and enabled on App ID `com.bookarc.app`
  (2026-10-07). Enabling it invalidated the existing provisioning profiles; Xcode regenerates
  them on the next build (`release-ios-appstore.sh` passes `-allowProvisioningUpdates`).
  Verified in the Simulator: I/O → External Displays → CarPlay shows Bookarc, and opening it
  presents the Audiobooks list template.
- **Sign in with Apple**: native flow verified end to end against prod on 2026-10-07.
- **No purchasing on iOS**: StoreKit purchase code, Stripe checkout, plan comparison and the
  "Restore Purchase" button are removed; the listing's "No in-app purchases" claim is true.
  Guarded by `src/__tests__/store-branding-guard.test.ts`.
- **Privacy manifest**: `src-tauri/PrivacyInfo.xcprivacy` is installed into the generated
  project by `scripts/apply-ios-entitlements.sh` → `scripts/ios/add-privacy-manifest.mjs`.
  Declares UserDefaults (CA92.1), file timestamps (C617.1, 3B52.1), disk space (E174.1) and
  system boot time (35F9.1). Tested by `src/__tests__/ios-privacy-manifest.test.ts`.
- **Account deletion**: in-app (Account → Delete Account) → `DELETE /api/user/delete` on the
  reader API, which purges data, revokes refresh tokens and revokes the Apple token.
- **Listing metadata** under `fastlane/metadata/ios/`: description, keywords (no third-party
  trademarks), categories (Books / Entertainment), copyright, age rating (`rating_config.json`,
  all NONE → 4+), review notes template. Upload with `bundle exec fastlane ios upload_metadata`.

- **Build 0.12.7 uploaded to App Store Connect** on 2026-10-07 (delivery
  d00ba756-2207-4e36-b908-5b968e5f5b79) via `pnpm release-ios-appstore`, signed with the
  CarPlay-enabled distribution profile; `PrivacyInfo.xcprivacy` verified at the bundle root of the
  exported IPA. `.env.ios-appstore.local` (gitignored) holds `APPLE_API_KEY`, `APPLE_API_ISSUER`
  and `APPLE_API_KEY_PATH`.

## Account holder actions (cannot be scripted)

1. ~~Accept the updated Apple Developer Program License Agreement~~ — done: the agreement
   issued 2026-08-18 shows as accepted on 2026-10-01 (developer.apple.com/account → Agreements).
   Any future update appears as a banner on that page and under App Store Connect → Agreements.
2. ~~Create the App Review demo account~~ — decided 2026-10-07: review runs without sign-in.
   The notes carry single-use claim codes (Pride and Prejudice ebook ×3, Moby-Dick audiobook
   test code) from the "BookArc for Readers" pen name; reviewers may use any Apple account for
   Sign in with Apple. Demo credential files stay empty. Regenerate codes from
   Dashboard → Gift codes if they get used up; a batch test code is the only way to deliver an
   audiobook without the author's audiobook add-on.
3. ~~App privacy labels~~ — done 2026-10-07 in App Store Connect. The answers entered, kept here
   so `PrivacyInfo.xcprivacy` and the labels stay in sync:
   - Data collected, linked to the user, not used for tracking:
     - Contact info → Email address (app functionality)
     - Contact info → Name (app functionality; from Sign in with Apple / Google when provided)
     - Identifiers → User ID (app functionality, analytics)
     - Usage data → Product interaction (app functionality, analytics; reading-progress
       analytics are shared with an author only after the reader opts in per book, and PostHog
       product events are opt-in)
     - Diagnostics → Crash data (app functionality; unhandled errors via PostHog)
   - Not collected: location, contacts, purchases, browsing/search history, health, financial
     info, photos, audio recordings, device identifiers for tracking.
   - "Do you or your third-party partners use data for tracking?" → No.
4. **Export compliance**: `ITSAppUsesNonExemptEncryption` is `false`. The app uses AES-GCM
   (WebCrypto) only to protect the user's own sync data, which is exempt; confirm the same answer
   in App Store Connect if asked.

## Build and upload

```bash
cd apps/readest-app
pnpm tauri ios init            # once per machine (gen/apple is gitignored)
pnpm release-ios-appstore      # applies entitlements + privacy manifest, builds, uploads via altool
cd ../.. && bundle exec fastlane ios upload_metadata   # listing text + screenshots
```

Regenerate screenshots after UI changes with `pnpm store:assets:ios` (the current set dates
from 2026-08-18, before the purchasing UI was removed).

## Before submitting for review

- Release-device pass on a physical iPhone: Apple sign-in, deep link `https://web.bookarc.app`,
  local EPUB import, offline audiobook playback, audio-route interruptions, CarPlay on a head
  unit or the Simulator.
- Check the TestFlight build processes without ITMS warnings (missing-reason APIs would show
  up here as ITMS-91053).
