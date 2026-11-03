# Save to Library → Send to Kindle validation

Implemented locally on `audiobook2`, November 2, 2026. No release was published.

## Behavior

- Save to My Library persists the book, confirms the claim, closes the dialog, and returns to Library without opening the reader. A one-shot library notice survives the route change.
- Start Reading still persists and opens the reader. Failed storage leaves the claim open and unconsumed, without publishing an unsaved book into the live library.
- A single local EPUB, PDF or TXT has Send to Kindle in the selection action bar and the native desktop context menu. Multiple selections, audio-only books, unsupported formats and recorded app-only deliveries do not offer it. Cloud-only books show disabled download guidance.
- Library delivery reads the saved file by hash. It does not redeem, confirm or download a claim, and preserves file bytes, including the recipient watermark.
- iOS/Android use native file sharing. Desktop/web provide explicit Save file and Open Send to Kindle steps. Cancellation is neutral, failed preparation can be retried, and a dismissed sheet is never reported as Kindle delivery.
- App-only restrictions live in existing book metadata and survive local storage, sync, metadata edits, refresh and reimport. Ordinary books keep generic Export; recorded app-only deliveries hide it.

## Automated checks

Regression tests were run failing before the associated fixes. Final `pnpm test --run --maxWorkers=2`: **5,423 passed, 8 skipped**, 349 passing test files and 2 skipped files. `pnpm lint` passed (Lua syntax checking soft-skipped because LuaJIT is not installed; no Lua changed). `pnpm build` passed. No Rust source changed.

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

## iPad validation: pending device reconnection

The iPad was initially available and the original four-book library was visible. It disconnected before the updated app could be installed. The new native Kindle action and completed Kindle delivery are **not yet physically verified**.

Local device candidate: `dist/ios/kindle-library-device/Bookarc.app`, bundle `com.bookarc.app`, version `0.12.7.12018`. Native compilation and strict signature verification passed. The existing device-test provisioning profile was used; the local signing copy excludes the unavailable CarPlay entitlement. Generated Xcode signing settings were restored afterward. Automatic store-style provisioning/export still reports an Apple agreement/profile problem; no agreement was accepted and no store upload was attempted.

A one-code draft named **Kindle library flow validation — Nov 2** was prepared using the author UI. Its throwaway test code remains unconsumed and is retained in the local audit evidence. The original production code was not reopened or extended. No new campaign email was sent.

Remaining physical checks after reconnecting and unlocking:

1. Install the local candidate over the current app, retaining its data.
2. Claim the throwaway code, Save to My Library, and confirm the return/notice without reader navigation.
3. Long-press the saved book → Send to Kindle; cancel once and retry.
4. Choose Kindle, complete its own send UI, and open the delivered personalized copy.
5. Terminate and reopen BookArc; verify Kindle remains available for the saved gift even after the code is consumed.
6. Capture each step in the audit screenshot directory and update this record.
