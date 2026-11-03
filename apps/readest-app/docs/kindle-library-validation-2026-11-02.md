# Save to Library → Send to Kindle validation

Implemented on `audiobook2`, November 2–3, 2026. Version 0.12.8, replacement iOS build 12023, was submitted for public App Store review on November 3; Apple reports `WAITING_FOR_REVIEW`, with automatic release after approval. Android build 12022 is submitted for Google Play production review. Neither submission is confirmation of public availability.

## Behavior

- Save to My Library persists the book, confirms the claim, closes the dialog, and returns to Library without opening the reader. A one-shot library notice survives the route change.
- Start Reading still persists and opens the reader. Failed storage leaves the claim open and unconsumed, without publishing an unsaved book into the live library.
- A single local EPUB, PDF or TXT has Send to Kindle in the selection action bar and the native desktop context menu. Multiple selections, audio-only books, unsupported formats and recorded app-only deliveries do not offer it. Cloud-only books show disabled download guidance.
- Library delivery reads the saved file by hash. It does not redeem, confirm or download a claim, and preserves file bytes, including the recipient watermark.
- iOS/Android use native file sharing. Desktop/web provide explicit Save file and Open Send to Kindle steps. Cancellation is neutral, failed preparation can be retried, and a dismissed sheet is never reported as Kindle delivery.
- App-only restrictions live in existing book metadata and survive local storage, sync, metadata edits, refresh and reimport. Ordinary books keep generic Export; recorded app-only deliveries hide it.

## Automated checks

Regression tests were run failing before the associated fixes. After the physical-device file fix and the subsequent native deep-link fix, the full pre-push unit suite passed: **5,434 passed, 8 skipped**. `pnpm lint` and formatting passed (Lua syntax checking soft-skipped because LuaJIT is not installed; no Lua changed). The production frontend, signed iOS archive/export, Android packages and 22 native Android unit tests passed. No Rust source changed.

Coverage includes save/read navigation, failed persistence and retry, deferred claim confirmation, metadata restrictions and sync in both timestamp directions, eligibility, cloud guidance, multiple selection, native cancellation, duplicate taps, retry and desktop save cancellation. The saved-file test restores a serialized library book and asserts no fetch call while retaining the recipient text.

Logs: `/tmp/bookarc-kindle-unit-final.log`, `/tmp/bookarc-kindle-lint-final.log`, `/tmp/bookarc-kindle-build-final.log`.

## Browser checks

Chrome, local app at port 3012:

- Imported The Writer’s Mind and used Select Books → Send to Kindle.
- At 375px width, the action bar fits; Kindle target measured 72.75 × 61px.
- Checked e-ink action bar: crisp border and readable icons/text without shadow dependence.
- Save file downloaded the EPUB. SHA-256 comparison confirmed it is byte-for-byte identical to the 3,009,948-byte imported source.
- Open Send to Kindle opened Amazon’s upload page only after the explicit click. No file was uploaded to Amazon through the web flow.

Screenshots: `/Users/chrisbanks/bookarc/audits/kindle-library-2026-11-02/screenshots/` (`web-narrow-action.jpg`, `web-kindle-steps.jpg`, `web-file-saved.jpg`, `web-eink-action.jpg`).

## iPad validation: completed November 3

Tested on the attached iPad Air 11-inch (M3), iPadOS 26.6.2. Installed the same compiled app from the store archive, re-signed with the existing device-test profile; its local signing copy omits CarPlay because that profile lacks the entitlement. The uploaded distribution IPA retains CarPlay, Sign in with Apple, associated domains and the privacy manifest, and passed strict signature verification.

- Claimed the prepared throwaway gift code and chose Save to My Library. Returned to Library without opening the reader; the existing four-book library remained intact. The short-lived notice was not captured on device; its behavior is covered by regression tests.
- Long-pressed the saved book and chose Send to Kindle directly from the action bar. The target measured 84 × 45 points. Canceled the native share sheet, then retried successfully; cancellation did not remove the book or report delivery.
- Terminated and reopened BookArc and confirmed the saved gift still offered the action after its code was consumed.
- The first candidate exposed a native lazy-file bug: wrapping `NativeFile` directly in a new `File` created an empty blob. Added failing tests using `NativeFile`, then fixed the handler to read its bytes and close the handle. The focused tests went from 2 failures to all 10 passing. Build 12019 was superseded and expired in TestFlight; corrected build **12020** was initially submitted, then replaced with 12023 after the follow-up below.
- On build 12020, the native sharing file was **byte-for-byte identical** to the saved library EPUB: 2,539,803 bytes, SHA-256 `3f89bb36a90ec9fe2b1cda4178d5ff6caf2655ce1e7d30d746adee0d422c5a7a`. This preserves the existing personalized watermark without another claim download.
- Kindle accepted the file and displayed its own “File sent” confirmation. Opened the newly arrived copy, distinguished from the older copy by its Kindle document ID, and verified the test gift's watermark in the reader. The test copy uses its claim-code identifier rather than an email address. No consumed code was reopened or extended.

Screenshots and XML for each step, file-integrity evidence, the private test files and release logs remain local under `/Users/chrisbanks/bookarc/output/releases/delivery-20261103/`. They are not committed because they include gift identifiers and book contents.

Known polish issue: Kindle's own submission form derives its default title from the unique temporary filename, which includes a random suffix. The title and author were edited in that form before sending. This does not affect file integrity or delivery, but a future native-share improvement should preserve a clean display filename without reusing stale personalized files.

## Android and replacement iPad checks

The Android emulator journey delivered a separate copy to Kindle and rendered the original personalized watermark. Upgrade preservation, Save/Read behavior, cancellation, restart, multiple-selection eligibility and native audiobook playback passed. See [Android validation](android-release-validation-2026-11-03.md) for exact builds and evidence.

That testing found `useOpenWithBooks` treating `bookarc://` URLs as local files, navigating away from the reader and losing a pending claim dialog. Seven regression tests were added first (four failed, three passing controls); all pass after the scheme exclusion. The fix preserves ordinary native file imports and leaves the dedicated BookArc deep-link handlers responsible for claims and shares.

Rebuilt Android 12022 and iOS 12023 from `0f7a88a84`. On both, opening a claim link over an active reader keeps the dialog visible; Save returns to Library after completion; the saved personalized EPUB reaches Kindle's submission form; cancellation retains the book and re-enables the action. These final checks stopped at the Kindle form to avoid sending duplicate copies; actual delivery and watermark rendering were already verified on Android 12021 and iOS 12020 with the same file-handoff implementation. Withdrew iOS 12020 and submitted 12023 at 12:40 CET.

Follow-up screenshots and receipts are local at `/Users/chrisbanks/bookarc/output/releases/android-delivery-20261103/`. The input EPUB's declared cover is an interior diagram; this release does not alter the supplied book's cover metadata. Android validation used the Pixel 7 API 35 emulator, not a physical Android or Fire device.
