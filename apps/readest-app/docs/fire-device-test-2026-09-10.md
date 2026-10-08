# Fire tablet test — 10 September 2026

**Latest result: build 12011 passes the core Fire retest.** Clean cloud restoration, exact audiobook resume, notification controls, sentence tracking, mini-player X, PDF reading and offline restart passed after the fixes documented below. Use **0.12.7 (12011)** for the Amazon candidate; builds 12007–12010 are superseded. On September 11 the owner confirmed physical touch selection in Fire's system file picker works, resolving the last pending hands-on check. The September 10 retest did not update or submit Amazon's draft; submission work resumed separately on September 11.

The sections through the first server-deployment follow-up below are chronological evidence from earlier builds, not the final candidate's status. See **Final candidate: 12011** at the end for current results and limitations.

## Device and build

- Amazon Fire HD 10 (2023), KFTUWI; Android 11 / API 30; build RS8338.3339N.
- Amazon WebView 148.amazon-webview-v148-7778.7778.258.34. Google Play services absent.
- Fresh installation of `com.bookarc.app`, version 0.12.7, version code 12007.
- APK SHA-256: `564a9f408922e886721624f6b222fd985e12ee1ef4ea3213d71ff7a49a414748` (matches release manifest).
- Dedicated account: `fire-review@bookarc.app`. Email confirmed; API and physical-device sign-in verified. Password is in macOS Keychain, service `bookarc.store-reviewers`, account `fire-review@bookarc.app`.

Evidence paths below are relative to `dist/amazon/0.12.7-12007/fire-test/`. Screenshots and corresponding UI XML are retained there; raw screenshots include private device notifications in some cases and are not all suitable for store publication.

## Passed checks

| Check | Evidence / result |
| --- | --- |
| Fresh installation and launch | Release hash and installed package version verified; library renders. |
| Email/password login without Google services | `25-signed-in`, `74-more-menu` (confirms exact Fire account). |
| Discover and book acquisition | `26-discover`–`30-reader`: Pride and Prejudice downloads, opens and renders. |
| Page turns and chapter navigation | `31-next-page`, `32-chapter-controls`, `41-offline-turn`. |
| Bookmark creation | Toolbar changes from Add Bookmark to Remove Bookmark locally. Follow-up: the server record has an empty book identifier, so bookmark cloud sync is NOT passed. |
| Font resizing | `33-font-settings`, `34-font-increased`: 16 → 17, visible text reflows. |
| Rotation | `35-landscape`, `36-portrait-reading`: both orientations render readable content. Exact restored position is a separate open issue. |
| Offline cold launch and reading | Wi-Fi disabled, app force-stopped and relaunched; library and downloaded book open, pages turn (`37`–`41`). |
| Normal book close/reopen | `41-offline-turn` and `76-progress-before-close` show the same saved spread after leaving/reopening the book. |
| Local EPUB import | Fire picker keyboard focus + Enter imports the narrated sample (`51-keyboard-focus`, `52-enter-import`). Touch selection is not passed. |
| Audiobook play/pause | Elapsed time advances; native AudioTrack starts; pause switches UI to Play and MediaSession to state 2 (`54`–`56`). |
| Seek / chapter navigation | Skip Back, seek bar and Previous Chapter respond (`57`, `68`, `69`). |
| Full player down arrow | Minimizes to the mini-player while playback continues (`57-minimized-playing`). |
| Mini-player X | Player disappears; MediaSession state 2, speed 0, AudioTrack paused. Observed position 31,135 ms (`58-x-pauses-audio`). |
| Background playback | Home leaves native playback running; Fire notification controls are present (`59-background-notification`). |
| Notification pause/resume | Pause switches notification to Play and MediaSession to state 2 at 51,830 ms; resume works (`60`, `61`). |
| Offline audiobook / return to app | Native playback starts with Wi-Fi disabled; returning shows Pause and the current sentence underlined (`67-offline-audio-return`). |
| Automatic chapter transition | Playback reaches The Drowned Village while offline (`68-offline-player-paused`). |
| Crash / ANR inspection | Exit history contains the intentional force-stop and associated WebView cleanup, with no app crash or ANR observed during this session. See `exit-info.txt`. |

The narrated fixture is an original-prose test sample derived from the repository's fictional Lantern EPUB. Its originally silent tracks were replaced with locally generated speech and matching SMIL timings. It is a roughly 96-second, two-chapter WAV sample, not a long commercial AAC/M4B compatibility test. The device reports a running speech AudioTrack; physical speaker audibility was not independently confirmed by a listener.

## Findings requiring follow-up

### 1. Production library sync — release blocker

The device has two books and says it synced recently (`70-sync-menu`, `71-sync-details`), with automatic cloud upload enabled (`74-more-menu`). Repeated authenticated API reads for the same account report zero books, zero configs, zero replica rows, and one note (`final-sync-counts.json`).

The client boot request is incompatible with the production API:

```text
GET /api/sync/replicas?kind=book
HTTP 400
errors.since: ["The since field is required."]
```

`src/libs/replicaSyncClient.ts` omits `since` for an initial pull. `BookArcReaderApi/Controllers/ReplicaSyncController.cs` declares it as a required non-null string. Evidence: `sync-api-checks.json`. Follow-up below confirms a separate, direct cause of the missing book records: the basic sync endpoint accepts the wrong input field names. Replica sync covers settings/dictionaries/fonts/textures/OPDS, not the main book library. Do not treat the UI's recent-sync label as proof that the library is backed up. A clean second-device restore has not passed.

### 2. Exact position after rotation and forced restart

After changing font size and rotating landscape → portrait, the visible spread was page 33 (`36-portrait-reading`). Following an offline force-stop/relaunch, reopening started at page 31 (`40-offline-progress`), with an earlier paragraph on the left and the previously left-hand text on the right. A normal later close/reopen preserved its spread. Reproduce with a fixed layout and inspect saved CFI/layout state before assigning the cause.

### 3. Fire native picker touch selection remains unverified

Automated taps and long presses on folders and files did nothing, although picker navigation/search controls worked. Searching Downloads found the EPUB. Tab focused the file and Enter imported it successfully. This establishes that the file can be imported, but does not distinguish a physical-touch defect from an automation limitation. A request for the owner to try a physical tap was unanswered during this session.

### 4. Top inset observation

The system clock/status icons overlap the top Discover label and part of the fullscreen audiobook toolbar in device screenshots (`26-discover`, `55-full-player`). Reader content itself is readable. Review Fire status-bar inset handling before replacing store assets.

## Remaining coverage

Not signed off: second-device library restoration, exact force-stop position recovery, physical touch in the file picker, PDF import/rendering, long AAC/M4B books, Bluetooth/headphone interruption, screen-locked playback, extended sleep/battery behavior, other Fire models, and the author claim-code flow. The release was not rebuilt, modified, uploaded or submitted as part of this test session.

Three physical-device captures are saved in the release's `screenshots/` directory (`fire-library.png`, `fire-reader.png`, `fire-discover.png`); they have not replaced Amazon's draft assets. Wi-Fi, rotation and charging stay-awake settings were restored; playback was left paused. See `restored-settings.json` and `final-media-session.txt`.


## Follow-up diagnosis: server compatibility, not an unchanged redeployment

The direct book/progress failure is in `POST /api/sync`. `SyncClient.pushChanges` sends the app's models unchanged: `Book.hash`, `BookConfig.bookHash`, camel-case timestamps, and structured metadata/settings/progress. The original Next.js server calls `transformBookToDB`, `transformBookConfigToDB`, and `transformBookNoteToDB` before storage. The .NET port binds the incoming request directly to database-shaped DTOs (`book_hash`, stringified JSON fields).

An isolated HTTP reproduction against the current .NET API confirmed:

| App request | Actual result |
| --- | --- |
| Book with `hash` | HTTP 200, zero books saved |
| Book with structured `metadata` | HTTP 400: cannot convert metadata to string |
| Config with `bookHash` | HTTP 200, zero configs saved |
| Bookmark with `bookHash` | HTTP 200, bookmark stored with empty `book_hash` |
| Control using server-shaped `book_hash` | Book and config save successfully |

The production Fire bookmark also has `book_hash: ""`. Its presence in the earlier count was not evidence of usable bookmark sync. Evidence: `sync-contract-reproduction.json`; probe source `sync-contract-probe.cs`. Tests used an isolated temporary SQLite database, not production mutations.

Other API mismatches also need coverage:

- Basic sync push returns `{msg:"ok"}` instead of the authoritative record collections expected by the client. The server also unconditionally overwrites existing values instead of matching the original conflict/merge behavior.
- Replica full GET requires `since`, although the client omits it on a full pull.
- Replica batch pull (`POST` with `cursors`) returns HTTP 200 `{msg:"ok"}` instead of `{results:[...]}`; reproduced against production using a read request.
- Replica-key list returns `{keys:[...]}` instead of `{rows:[...]}`. Creation expects `{key}` instead of `{alg}` and lacks the expected salt response; forget semantics also differ.
- Replica writes replace whole rows based on one timestamp rather than matching the original per-field merge protocol. This requires concurrency/conflict tests, not just field-name changes.

The active production revision is `bookarcreader-prod-api--0000021`, image `bookarcwebprodacr.azurecr.io/bookarcreader-prod-api:oauth-username-fix-c092b58`. The implicated sync controllers and DTOs have no changes between commit `c092b58` and the current source, so redeploying current code unchanged will not fix sync.

All nine existing .NET replica controller tests pass. They use the .NET server's own request/response format and do not verify compatibility with the shipping app. The next implementation should start with failing HTTP contract tests using actual app payloads, including book/config/note round trips, structured fields, timestamps, push acknowledgements, batched pulls, key lifecycle, stale writes and account isolation. Then fix and deploy the Reader API and verify a clean second-device restore using the unchanged 0.12.7 APK. An app rebuild is not inherently required for these server contract fixes, but remains unproven until that end-to-end check passes. The misleading sync UI and separate Fire layout/position observations may still warrant an app change.

No server changes were deployed during diagnosis.


## Server fix deployed and verified (September 10, 2026, 18:25 UTC onwards)

The Reader API compatibility fixes are deployed as revision `bookarcreader-prod-api--0000022`, image `bookarcwebprodacr.azurecr.io/bookarcreader-prod-api:sync-contract-20260910-1822-d5475d87`. Azure reports this revision ready and running. The previous image remains available for rollback. The only schema addition is nullable `Books.SourceTitle`.

Implementation started with 14 failing book/config/note HTTP tests and 10 failing replica client contract tests. Additional red tests caught invalid envelopes, missing explicit nulls in replica responses, and malformed identifiers. The final Release suite passed **194 tests, zero failures or skips** (37 new cases). EF reports no pending model changes; SQL Server migration script generation and `git diff --check` passed.

The API now accepts actual app payloads, including camel-case identifiers, epoch timestamps and structured JSON, while retaining database-format compatibility. Push returns authoritative records. Stale writes are rejected, explicit restoration is supported, and audio locators merge independently of reading-page timestamps. Database timestamps return UTC markers. Writes serialize per user through a transaction-owned SQL Server application lock, protecting merges across server instances. Replica full/batch pulls, field merging, manifest cursors, tombstones/revival and salt lifecycle now match the shipping client.

Verification used the **unchanged Amazon 0.12.7 (12007) APK** on the attached Fire HD 10:

- Restarted the app and queued the narrated book's cloud upload from Book Details. Both local library records appeared in production with their original titles and uploaded-file state. The manual “synced” menu action performs a pull; its initial “0 books synced” was not treated as an upload acknowledgement.
- Retrieved the narrated book's reading config and valid version-2 audio locator from a separate authenticated API session. The saved locator identifies the correct edition and `OEBPS/audio/c1.wav`, with its associated text sentence locator.
- Created a new bookmark on Fire; verified the corresponding cloud row has the correct book hash and CFI.
- Repaired only the test account's historical orphan bookmark `ldtjoel`. Its CFI target `pgepubid00022` was verified in the downloaded Pride and Prejudice EPUB before associating it with that book. Final snapshot: two books, one reading config, two correctly associated bookmarks, zero orphan bookmarks.
- Downloaded both EPUBs and both covers through authenticated storage requests from the independent session. All four returned HTTP 200 and exactly matched recorded byte sizes. Both EPUB ZIP integrity checks passed. The narrated EPUB's SHA-256 exactly matches the original local fixture: `8b64d8df0109601375cb5893285329d3ca96e3ac8f99b6dc7103b460b1fa8da6`.
- Rechecked the miniplayer X: the player disappeared and Android reported stopped playback (`state=1`, speed zero). Charging stay-awake was restored to off.
- Production full replica pull and batch pull now return HTTP 200 with the expected collections. Six concurrent stale-book retries preserved the authoritative title, and an invalid mixed batch returned HTTP 400.

Evidence: `fire-test/server-fix-verification.json`, screenshots 81–95, and downloaded fixtures under `/private/tmp/bookarc-fire-sync-restored/`. The backend build source digest is `d5475d876a7fa9e9facb39b96bcb7b7332fd0e01dd8956b7de391d576934c7dd`.

**Limits:** independent API/file restoration passed; a complete second-client visual restore has not been signed off. The local web dev server routes existing API pages to its legacy backend, and the temporary proxy/Chrome session then encountered rendering/navigation timeouts. These were not counted as server test passes. The earlier Fire inset, physical picker-touch and exact force-stop-position observations remain open. No Amazon submission was made and no APK rebuild was needed for the verified server fixes.


## Retest: session expiry and clean restoration

Build 12007 stopped syncing after its one-hour access token expired. The client only read the stored token; it never renewed it during sync. Build 12008 adds shared, proactive token renewal, coalesces concurrent refreshes, updates the signed-in UI, preserves sessions through transient failures, and prevents late refresh responses from undoing logout or overwriting a newer login. The initial red run had 13 failures. Regression coverage includes expired/near-expiry tokens, concurrent requests, 401/403 rejection, 429/5xx/offline recovery, logout/login races, malformed responses, and AuthProvider updates.

The first upgraded session was correctly rejected because the server had revoked it during an independent reviewer login. The server previously revoked **every** refresh token for a user whenever any device signed in or refreshed. Six new HTTP tests also reproduced concurrent token reuse and the empty-body logout-all bug. Production revision **bookarcreader-prod-api--0000023** is healthy and running image `bookarcwebprodacr.azurecr.io/bookarcreader-prod-api:session-refresh-20260910-28998696`; image digest `sha256:4ea6fe75dd36706bb6d8c3c293d4c4315840f5d76ea28ac97def77e3ec487fa5`. Source digest `289986962fa320544bed3b4ce94b86cac9f3bc3b7d3f81aa1813f1a6423a0a0d`. All **200 server tests pass**. There is no additional schema migration. Live verification: two separate sessions both refresh with HTTP 200; replay of the consumed token returns 401. Other-device sessions remain independent; rotation uses a conditional database update to enforce single use.

The fixed-layout offline forced-restart test passed on 12007: page 34 and its visible text match before and after Wi-Fi-off/force-stop/relaunch (screenshots 103 and 106). PDF import through keyboard selection, rendering and page turns passed on 12008. Automated picker taps remain inconclusive. All three fixture files and all three covers were independently downloaded, with HTTP 200 and matching byte sizes; backup metadata is in `dist/amazon/0.12.7-12008/fire-test/pre-clear-backup.json`. Private backup payloads and files are retained under `/private/tmp/bookarc-fire-12008-restore/` and `/private/tmp/bookarc-fire-clean-restore-backup.json`.

A brief 65-minute device-clock advance exercised renewal; the Fire remained signed in. The clock and automatic time were restored immediately. This exposed a separate throttle problem: rolling wall time backwards postponed new library pushes until the old time returned. The PDF bytes uploaded successfully, but the upload flag therefore did not reach the cloud before the first clean reset. A failing regression test now covers clock rollback, with an additional queued-call/duplicate check. The throttle now handles rollback immediately. This clock-induced delay is distinguished from ordinary upload failure.

The first clean reset removed only BookArc's three known reviewer fixtures after backup. Signing in restored both EPUBs, their covers, the Pride and Prejudice chapter locator, and the Lantern bookmark. Page numbering changed because the clean installation used default layout settings; the saved chapter content was restored. This test exposed another client bug: cloud book records do not contain the import-time `hasAudio` flag, so the restored narrated EPUB showed TTS controls. Reader initialization now derives media-overlay availability, audio-only status and duration from the downloaded book. Two failing cases cover narrated and audio-only EPUBs, with a plain-text control. This does not modify the user's progress timestamp.

The Fire status-bar overlap in Discover and the fullscreen audio player is also corrected using the existing theme-store status-bar height. Six layout cases cover zero reported safe-area inset, larger notches, hidden system UI and desktop spacing; two failed before the change. The full application suite after these fixes passes **5,338 tests**, with eight existing skips. TypeScript and Biome pass; the lint wrapper skips Lua syntax locally because LuaJIT is absent.

Evidence for this intermediate retest is under `dist/amazon/0.12.7-12008/fire-test/`. Builds 12008 and 12009 are intermediate test artifacts. Final device verification and submission status are recorded below once the combined candidate is tested.


### Listening-position restoration follow-up

Build 12010 restored the EPUB's audio controls, but clean playback started at zero instead of the backed-up 22-second locator. The remote config contained an ebook XPointer (`/body/DocFragment[2]/body/div[1]`); the original downloaded chapter contains a `section` element. Ebook XPointer conversion ran before config merging, so a conversion failure discarded otherwise valid audio progress. The merge now happens first, and conversion failure retains the saved CFI. Separately, native idle-player timeline hydration ignored cloud locators arriving after initial mounting; it now updates the idle timeline without starting playback. Two regression tests failed before these fixes and pass afterwards. Active playback remains authoritative.

The final combined application suite passes **5,340 tests**, with eight existing skips, and TypeScript/Biome pass. Build 12010 also passed the repeated clock-expiry/rollback test: without signing in again, the PDF advanced from page 2 to 3 and the cloud record updated immediately at `2026-09-10T19:39:57.545Z`. Its Discover title and fullscreen controls now render below the system status bar. Final verification uses build 12011; earlier candidates should not be uploaded.


## Final candidate: 12011

- Installed and tested `dist/amazon/0.12.7-12011/bookarc.apk`, version 0.12.7, code 12011, min SDK 26, target SDK 36. Release signing and Amazon package checks passed during the build.
- SHA-256: `c2ae10ea2b9cc0bf77d2c7dfa4a1e4a7850133ea8a3f8b808e41103b0596ce7a`.
- Server revision `bookarcreader-prod-api--0000023` includes both sync-contract and independent-device session fixes. No further server deployment is needed for this candidate.
- Final application suite: **5,340 passed, eight existing skips**. Server: **200 passed, zero skipped**. TypeScript and Biome passed. Lua syntax was skipped by the local lint wrapper because LuaJIT is unavailable; no Lua code changed.

Before clearing the three known reviewer fixtures for the final clean-restore test, all three book files and covers were downloaded and checked against their recorded sizes. The narrated EPUB also matched its original SHA-256. The pre-clear snapshot is `/private/tmp/bookarc-fire-12011-before-restore.json`. No unknown personal BookArc library data was cleared.

Final evidence is relative to `dist/amazon/0.12.7-12011/fire-test/`:

| Check | Result and evidence |
| --- | --- |
| Clean installation / reviewer login | Cleared app data, signed in as the Fire reviewer; all three cloud library entries and covers restored (`01`–`03`). |
| Cloud-restored audiobook controls and bookmark | Narrated EPUB opens with recorded-audio controls and its saved bookmark (`04`–`05`). |
| Exact saved audio position | Fullscreen showed 0:49; Play started Android MediaSession at **49,150 ms**, exactly matching the backed-up locator (`06`, `07`, `07-media-session.txt`). |
| Fullscreen down arrow / background | Down arrow collapsed the player without stopping playback; Home left playback running with Fire notification controls (`08`). |
| Notification pause / app state | Notification pause produced native state 2 at 76,708 ms. Returning showed Play and the current underlined sentence (`09`, `10`). |
| Resume and chapter tracking | Play changed to Pause, advanced into chapter 2 and underlined the current sentence (`11`). |
| Mini-player X | During playback, X removed the player and paused native playback at 7,716 ms in chapter 2 (`12`). |
| Cloud PDF restoration | PDF downloaded and reopened at saved page 3 (`14`). |
| Offline page turn / forced restart | With Wi-Fi disabled, advanced to page 4, force-stopped and relaunched. PDF reopened on page 4 with all 44 captured text nodes identical (`15`–`17`). |
| Offline audiobook | After the offline cold launch, narrated EPUB reopened at its saved chapter and Play entered playback (`18`, `19`). The short remaining chapter subsequently reached its natural end; the later native dump records that stopped state. |
| Reconnection | Offline PDF page 4 remained local until the book was reopened online, then reached production as `epubcfi(/6/8)` / `[4,69]` without another page turn (`21`, `final-verification.json`). This is not evidence of immediate background upload while idle in the library. |
| Production records | Independent authenticated read confirms three uploaded books, three configs and two bookmarks associated with the correct books (`final-verification.json`). Independent logins no longer invalidate the Fire session. |
| Crash / ANR inspection | Exit history shows deliberate force-stops and associated WebView/system cleanup; no app crash or ANR observed (`final-exit-info.txt`). |
| Device cleanup | Wi-Fi on, automatic time on, rotation restored to automatic / portrait default, charging stay-awake off. Playback paused; app left at the signed-in library (`restored-settings.json`, `final-media-session.txt`, `22-ready-library`). |

The combined candidate contains fixes proven first by failing tests: session renewal and refresh races, independent server sessions with atomic token consumption, clock rollback throttling, missing audio flags on cloud-restored books, Fire top insets, ebook XPointer failure discarding audio progress, and late native idle-player locator hydration. Physical inset and forced-expiry/clock-recovery checks passed on build 12010, which contains the same inset/auth/throttle changes; the additional audio restoration fixes were verified on 12011.

**Remaining limits:** physical file-picker touch selection still needs the owner to try a real tap; keyboard selection successfully imports EPUB and PDF. Long commercial AAC/M4B playback, Bluetooth interruption, locked-screen playback, overnight battery/sleep behavior, other Fire models and author claim codes were not covered. Speaker audibility was not independently confirmed by a listener. The device has a secure keyguard, so it was not deliberately locked without an available owner to unlock it. No claim of exhaustive hardware compatibility is made.

**Submission state:** use the 12011 APK above when replacing the old Amazon draft binary. The draft binary, screenshots and final submission have not been changed in this retest. Previously unanswered Amazon declarations remain for completion in the console; testing does not establish those answers.


## Amazon submission completed — September 11, 2026

The owner confirmed physical file-picker selection works, resolving the pending touch check. Build **0.12.7 (12011)** was uploaded and Amazon confirmed **App Submission Successful / Submitted**. The console records September 10 at 10:31 pm GMT-7 (September 11 in Europe/Madrid), with an estimated Appstore date of September 15 at 11:00 pm PDT; this is an estimate, not approval.

The three web previews were replaced by final-build Fire captures `22-ready-library`, `17-offline-restored-page4` and `06-restored-audio-position`. The dedicated Fire credentials and detailed sample-book/playback instructions were supplied privately. Export compliance was checked after the owner's explicit certification. Existing targeting was preserved: 12 compatible Fire tablets, zero Fire TV and automotive devices; only the named Fire HD 10 was physically tested. Google Play was not changed. The sanitized receipt is `dist/amazon/0.12.7-12011/amazon-submission.json`.
