# Android 0.12.8 release validation

Submitted **0.12.8 (12022)** to Google Play production review on November 3, 2026, from committed source `0f7a88a849eedafdac80d7549123b6d465def214`. Play Console shows **Changes in review**, with automatic quick checks running. Managed publishing is off; the pending change is **Start full rollout** after approval. Submission does not mean the update is publicly available.

[Google Play publishing overview](https://play.google.com/console/u/1/developers/8028954603947203615/app/4973508317603289687/publishing). The existing internal, alpha and beta tracks were preserved. Candidate 12021 was superseded before the production edit was committed.

## Validation

Used the Google Play Pixel 7 API 35 emulator (Android 15, arm64, 1080 × 2400). Kindle was installed and signed in by the user. No physical Android or Amazon Fire device was tested, and no Amazon Appstore update was submitted.

- Installed released build 12007, imported the personalized EPUB, opened it, then upgraded to 12021. The book and reading position survived. Upgrading again to 12022 preserved the library.
- Claim → Save to My Library returned to Library; Start Reading opened the saved book.
- One EPUB selected exposed Send to Kindle. Multiple selection and an audio-only book hid it. Android's native share sheet attached the actual EPUB and offered Kindle.
- Canceling retained the book and allowed retry. Force-stop and restart retained the action for the saved gift without requiring another claim.
- On 12021, sent one distinct test copy to Kindle, downloaded it, opened it, and visually verified the existing personalized watermark. Kindle briefly reported a connection warning, but the copy arrived and was readable.
- Claimed and opened the review audiobook; Android MediaSession reported `PLAYING` with Moby-Dick metadata. Paused playback after verification.
- Found a shared deep-link bug while another book was open: the native file-import consumer treated `bookarc://` as a file, navigating away and losing the claim dialog. Added seven tests first (four reproduced the failure, three passed as controls), then excluded the scheme. Dedicated deep-link handling is retained; ordinary file imports remain covered.
- On final 12022, verified the claim dialog remains over the reader, Save returns to Library, the personalized file reaches Kindle's form, cancellation allows retry, and the selected audiobook has no Kindle action. Canceled the final form to avoid sending a duplicate; file-handoff code is unchanged from the successful delivery test.

The full shared reader suite passed **5,434 tests**, with 8 skipped. Type checking, lint and formatting passed. Optional Lua checking was skipped because LuaJIT is absent; no Lua changed. Android native tests passed **22 tests across 5 suites**. The production frontend and signed release build passed.

## Artifact checks

Package `com.bookarc.app`; version 0.12.8 / code 12022; min SDK 26, target SDK 36; arm64-v8a and armeabi-v7a. Verified the existing upload signing identity, bundle validity, APK signature, 16 KB ZIP and arm64 ELF alignment, and absence of the restricted all-files-access and package-install permissions.

| Artifact | SHA-256 |
| --- | --- |
| AAB | `31a6da6dced16f4b2de9692abd10680b6ad087c5760c2a07c2c301f9513842ce` |
| APK | `cc679537fc2dd018306d9953639895f1f8b42d08f1bf1cc9733a8e4acb3d2e24` |

Known polish: Kindle defaults its title field to the temporary filename with a unique suffix. The test title and author were edited before sending. The input EPUB declares an interior diagram as its cover; this release does not change the supplied cover metadata.

## Evidence and iOS replacement

Private screenshots, XML, logs, package checks and submission receipts remain under `/Users/chrisbanks/bookarc/output/releases/android-delivery-20261103/`, excluded from Git. Open `screenshots.html` for the curated journey. `39-kindle-watermark.png` shows the delivered watermark; final-build screenshots 54–63 show the fixed dialog, saving, Kindle handoff, cancellation and audiobook exclusion.

The same deep-link fix was built as iOS **12023**. After physical iPad verification, the previous 12020 submission was withdrawn and 12023 was submitted at 12:40 CET. Apple reports **WAITING_FOR_REVIEW**, with automatic release after approval. See [App Store release record](app-store-release.md) and [shared Kindle validation](kindle-library-validation-2026-11-02.md).
