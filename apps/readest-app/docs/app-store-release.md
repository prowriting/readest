# App Store release checklist (iOS)

Status as of 2026-10-20. Supersedes the "Store follow-up" notes in
[ios-device-test-2026-09-11.md](ios-device-test-2026-09-11.md).

## Released to the App Store 2026-10-23

- Apple approved version **0.12.7**, build **0.12.7.12017**; verified status
  **PENDING_DEVELOPER_RELEASE** before acting.
- At the user's request, created the manual release request through App Store Connect.
- Verified the resulting status as **READY_FOR_SALE / READY_FOR_DISTRIBUTION**.
- Release receipt and before/after records are retained at
  `/Users/chrisbanks/bookarc/output/app-store-release-2026-10-23/`.

## Metadata correction and resubmission 2026-10-21

- Apple rejected build 0.12.7.12017 under **2.3.10 — Accurate Metadata**, asking
  us to remove Google Play references from the app description.
- Removed “Google Play Books” from the live en-US iOS description and synced
  `fastlane/metadata/ios/en-US/description.txt`.
- Resubmitted the same build at **12:16 CEST**. Verified version and submission
  state as **WAITING_FOR_REVIEW**, release mode **MANUAL**.
- Receipts and before/after metadata are retained at
  `/Users/chrisbanks/bookarc/output/app-store-metadata-fix-2026-10-21/`.

## Resubmitted for App Review 2026-10-20

- Version **0.12.7**, build **0.12.7.12017**, resubmitted at **18:33 CEST**.
- Review submission `d36af17b-7d89-4c63-bd72-54d8600e90a4` is verified as
  **WAITING_FOR_REVIEW**. Release remains **MANUAL**.
- Attached the user-provided iPad recording `RPReplay_Final1792510158.MP4`
  (2m59s, 114,858,866 bytes). Apple verified attachment delivery as **COMPLETE**,
  with no errors; attachment ID `25715a18-e1b1-47a1-a324-1cd082764c39`.
- Updated review notes to describe the recording accurately, retain reusable review
  codes, and include purpose, audience, business model, external services, regional
  behavior and content rights. Synced the local review notes to the submitted text.
- Submission receipts and verification are retained at
  `/Users/chrisbanks/bookarc/output/app-store-submission-2026-10-20/`.

## CarPlay candidate uploaded 2026-10-20

- Version **0.12.7**, build **0.12.7.12017**, uploaded successfully with no errors.
  Delivery UUID: `e56ac185-de88-4c1a-aa5b-ae898529a8ff`.
- Fixes CarPlay returning to the Audiobooks list when playback causes a library refresh:
  the existing list template is updated in place, preserving Now Playing and chapter navigation.
- Includes the current working tree based on `ab355c505`. Source snapshots, IPA, checksum,
  and validation/build/upload logs are retained at `dist/ios/0.12.7-12017-appstore/`.
- Validation: **5,400 app tests** and **33 native iOS tests** passed, including the new
  regression test; TypeScript/lint, Rust formatting and Clippy, production frontend build,
  native archive/export, and strict signature verification passed.
- Export verified as `com.bookarc.app`, iOS 15 minimum, with the privacy manifest,
  Sign in with Apple, associated domains, and CarPlay audio distribution entitlements.
- Apple processing completed: **VALID**, App Store eligible, internal TestFlight state
  **IN_BETA_TESTING**. Build 12017 is selected on App Store version 0.12.7, whose status is
  **PREPARE_FOR_SUBMISSION**. Release mode is verified as **MANUAL**. As requested, this
  candidate is left for the user to submit to Apple review; it has not been publicly released.
- Fresh physical CarPlay testing remains outstanding. The fixed build was installed in the
  simulator with Moby-Dick loaded, but automated CarPlay control clicks were unavailable.

## Earlier candidate uploaded 2026-10-20

- Version **0.12.7**, build **0.12.7.12016**, uploaded successfully with no errors.
  Delivery UUID: `9fce6c01-9552-4d6c-a3f2-023db1691691`.
- Apple processing completed: `VALID`, internal TestFlight state `READY_FOR_BETA_TESTING`.
  The existing internal `Alpha Testing` group has automatic access to all builds.
- Includes the existing guest claim/local reading changes in the working tree based on
  `b8a05a28b`. Beta participation/sign-in requirements remain a proposed follow-up.
- Validation: 31 focused unit tests, all three guest browser checks, TypeScript, lint of
  the changed application files, production frontend build, native archive/export, and
  strict code-signature verification passed. The first cold browser run timed out compiling
  the reader; the complete rerun passed.
- Export verified as `com.bookarc.app`, iOS 15 minimum, with the privacy manifest,
  Sign in with Apple, associated domains, CarPlay audio and distribution entitlements.
- Artifacts, build/upload logs, checksum and source changes are retained locally at
  `dist/ios/0.12.7-12016-appstore/` relative to the app directory.
- No physical device was available for a fresh smoke test. Public App Store submission
  and release are separate from this candidate upload.

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

- **Listing pushed** 2026-10-07 with `fastlane ios upload_metadata`: text, keywords, categories,
  review notes, age rating (full current declaration schema in `rating_config.json`; the API
  rejects retired keys such as `seventeenPlus`) and the 10 screenshots. Build 0.12.7 processed
  (VALID). Note: the App Store Connect version record is still "1.0" with no build attached; the
  version string must match the build's `CFBundleShortVersionString` before it can be attached.

## Account holder actions (cannot be scripted)

1. ~~Accept the updated Apple Developer Program License Agreement~~ — done: the agreement
   issued 2026-08-18 shows as accepted on 2026-10-01 (developer.apple.com/account → Agreements).
   Any future update appears as a banner on that page and under App Store Connect → Agreements.
2. ~~Create the App Review demo account~~ — decided 2026-10-07: review runs without sign-in.
   The notes carry reusable, non-expiring review codes (Pride and Prejudice ebook ×3, Moby-Dick audiobook
   test code) from the "BookArc for Readers" pen name; reviewers may use any Apple account for
   Sign in with Apple. Demo credential files stay empty. Regenerate codes from
   Dashboard → Gift codes if replacements are needed. On 2026-10-20 the four existing codes were
   moved to standalone unlimited download records, keeping the same strings and preserving gift
   history. Repeated download/confirm/redeem checks passed for every code, including packaged audio.
   App Store Connect review notes were updated to match. Change evidence is retained under
   `output/app-review-codes-2026-10-20/` in the workspace root.
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
