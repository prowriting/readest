# iPad device test — September 11, 2026

Status: the launch and paused-seek defects are fixed and verified on the physical iPad in development build **0.12.7.12015**. Broader release testing and CarPlay approval remain outstanding. The initial findings below are retained as historical evidence.

## Fixes and final device verification

Installed candidate: `dist/ios/0.12.7-12015-device/Bookarc.app`. This build retains both the ordinary application and CarPlay scene configurations. Only the development signing copy excludes the unapproved CarPlay entitlement; no store build was uploaded.

### Root causes and changes

- Adding a CarPlay scene opts the entire application into UIKit's scene lifecycle. Tao 0.34.8 creates a legacy window that was never attached to an ordinary application scene. Added `ReaderWindowSceneDelegate` and its plist configuration, retaining Tauri's existing window, controller and web view. The native plugin explicitly hands over the web view because `UIApplication.windows` excludes the unattached window. The delegate handles either startup order and forwards scene lifecycle and incoming URL/activity events to the existing application delegate.
- Wry's legacy flexible margins caused the initially zero-sized web view to become undersized and offset when the scene supplied its real dimensions. The reader now fills its container and resizes only in width/height. Physical portrait–landscape–portrait checks verify origin `(0, 0)` and dimensions `820×1180`, `1180×820`, then `820×1180`.
- The production linker discarded the CarPlay scene delegate when only the plist referenced it. Both delegate types now have explicit native references, and both class names are present in the built executable.
- The iPad's Macintosh user agent incorrectly selected web playback and disabled native audio preparation. Playback backend selection, native manifest/control bridging and audio-output picker availability now use Tauri's native OS value. Native seeks already preserve pause; routing the iPad correctly restores a single authoritative native playback state.

### Regression evidence

Failing tests were run before the corresponding fixes: backend/platform selection, scene registration, explicit window handoff, web-view sizing and native bridge availability. Added native paused-seek/resume coverage and tests for both web-view/window creation orders.

- `pnpm test --maxWorkers=2`: **5,349 passed, 8 skipped** across 334 passing test files. Log: `/private/tmp/bookarc-ios-fixes-tests-final.log`.
- Swift plugin XCTest suite: **32 passed**. Log: `/private/tmp/bookarc-ios-plugin-final.log`.
- `pnpm lint`, `pnpm fmt:check`, `pnpm clippy:check`: passed. Lua syntax checking soft-skipped because LuaJIT is unavailable; no Lua changed.
- iOS production frontend/native archive and development signature verification passed. Tauri's store-style export still fails on the pending CarPlay entitlement; the archive was copied and signed with the existing device-test profile.
- Physical final-build evidence: `/private/tmp/bookarc-ipad-12015-evidence/checks.json` and screenshots in that directory. Installation receipt: `/private/tmp/bookarc-ipad-12015-install.json`. Build log: `/private/tmp/bookarc-ios-device-12015-build.log`.

### Final-build physical checks

- Cold launch shows the signed-in four-book library with the full scene manifest enabled; no black screen or reduced viewport.
- Portrait, landscape and portrait again fill the screen correctly.
- Paused playback at 34 seconds: forward → 64, back → 49. The button remains Play and the clock remains stationary. Resume advances to 53 seconds.
- The down arrow minimizes while playback stays active.
- Background playback advances from approximately 53 seconds to 81 seconds of the book across about 27 seconds, crossing into chapter two. On return, the highlight moves from the chapter-one sentence beginning “But Mira saw…” to the chapter-two sentence beginning “They say a village…”, matching the current audio position.
- Mini-player X dismisses the player and pauses playback. Reopening shows Play and remains at chapter-two position 7 seconds across subsequent checks.
- Another process termination/relaunch preserves authentication and the cloud library. Alice PDF reopens on page 5 with its bookmark intact.

The iPad is left on the PDF with audio paused. These checks address the observed launch, layout and playback-state defects. They do not constitute full store sign-off: CarPlay/head-unit behavior, live system transport intervals/metadata, ten-minute background endurance, offline playback, hardware/audio-route interruptions, end-to-end local import and Apple sign-in/deep-link flows still need their release-device checks. Scene URL forwarding is implemented but not counted as physically verified here.

## Device and candidate

- iPad Air 11-inch (M3), iPad15,3; iPadOS 26.6 (23G71).
- Xcode 26.6 (17F113), iPhoneOS 26.5 SDK.
- Bundle `com.bookarc.app`, version 0.12.7, build `0.12.7.12011`.
- Installable development app: `dist/ios/0.12.7-12011-device/Bookarc.app`.
- Device registered through the existing Bookarc CI Upload API key. No new key or certificate was created.
- New active profile: `BookArc iPad Device Test 20260911`, UUID `66b0f6a4-c1a4-49e3-a47f-cebc1da18ded`, using the existing Chris Banks development certificate.

The ordinary build initially failed because the generated project requests CarPlay audio, but Apple's bundle ID capabilities and cached profiles do not include it. A temporary xcconfig allowed native compilation and archiving. Tauri reapplied the original CarPlay entitlement during export, so export still failed. A separate copy of the compiled application was signed with the real Apple Development identity and the new device profile, retaining Sign in with Apple and associated domains and excluding CarPlay. `codesign --verify --deep --strict` passed. The tracked app entitlement configuration is unchanged.

This is a device-test candidate, not an App Store IPA or a CarPlay-certified build. CarPlay must be enabled by Apple before signing/testing a release that requests it. Signing preparation is under `/private/tmp/bookarc-ios-device-signing/`; build log: `/private/tmp/bookarc-ios-device-12011-build.log`.

## Verification completed

- Production frontend build and native iOS compilation/archive passed.
- Focused regression suite: 63 tests passed across iOS CarPlay configuration, native reader playback, auth-session renewal and progress sync. Log: `/private/tmp/bookarc-ios-preflight-tests.log`.
- Device pairing and Apple device registration succeeded.
- App signature and profile/device match verified.
- `devicectl` installed the app and launched `com.bookarc.app` successfully on September 11 at 10:07–10:08 CEST. Installed app inventory confirms version 0.12.7, build 0.12.7.12011. Receipts: `/private/tmp/bookarc-ipad-install.json`, `/private/tmp/bookarc-ipad-launch.json`, `/private/tmp/bookarc-ipad-apps.json`.
- Physical checks and their limitations are recorded below.

## Physical test findings

### Launch blocker: CarPlay scene manifest

The installed candidate launches to a black screen, with no accessible web view. Repeated UI inspection confirmed this was persistent, not just the splash screen. The plist declares `UIApplicationSceneManifest` with a CarPlay scene but no ordinary application scene. The bundled Tao 0.34.8 iOS implementation creates legacy `UIWindow` instances and does not attach them to a `UIWindowScene`.

Controlled diagnostic: copy the exact signed candidate to `/private/tmp/bookarc-ios-no-scene/Bookarc.app`, remove only `UIApplicationSceneManifest` from that copy's `Info.plist`, and re-sign with the same identity and entitlements. Installing this copy immediately restores the library UI. The original candidate and tracked source configuration remain unchanged. This diagnostic build is the one used for subsequent regular-app tests; it is not a release-ready fix. Before submission, resolve the application/CarPlay scene lifecycle and repeat launch, background, deep-link and playback tests against the resulting release candidate.

### Regular app checks on the diagnostic build

- Email/password sign-in with the dedicated reviewer account succeeded; four cloud books appeared, including the narrated Lantern sample and Alice PDF. No app data was wiped.
- Downloading/opening the narrated EPUB succeeded. Both chapter texts render; the audio player shows cover art and chapter information.
- Play advances the position and highlights the current sentence. Pause changes the mini-player button back to Play.
- Full-player down arrow minimizes while playback remains active.
- Mini-player X hides the player and pauses it. Reopening shows Play; position stays at 12 seconds across subsequent checks.
- Background playback after an explicit Pause/Play cycle advanced from 27 to 43 seconds over approximately 16 seconds. On return, the reader highlighted the later sentence ("Sailors climbed the cliff path..."). This is a short background check, not the required ten-minute endurance test.
- Screen-off playback continued into the lock-screen observation. The system surface showed the book title, author and cover with an advancing timeline. Audible output was not independently recorded.
- Alice PDF downloaded and rendered at its cloud-saved page 4 of 69. Page turn reached page 5. Landscape and portrait renderings were verified visually.
- Added a bookmark on PDF page 5, terminated the app process, relaunched and reopened the PDF. The signed-in library survived; page 5 and the bookmarked state were restored.
- Import Books → From Local File opened the native iOS document picker. Cancel returned to the library successfully. No local document was selected, so end-to-end local import is still unverified.

### Additional playback findings to investigate

- From the paused full player at 12 seconds, Skip Forward moved to 42 seconds, and Skip Back moved to 27 seconds. The button then showed Pause although the position remained at 27 seconds, including after approximately 18 seconds in the background. Explicit Pause followed by Play restored progression. Seeking must preserve truthful playback state; this needs a regression test and fix before release.
- Lock-screen skip buttons displayed 10 seconds in both directions, while the app was configured for 15 seconds back and 30 seconds forward. The lock-screen duration showed approximately 1:17 (first chapter), while the two-chapter sample totals approximately 1:36. Verify transport intervals and whole-book metadata against the native playback checklist.

Evidence screenshots, assertions and latest accessibility tree: `/private/tmp/bookarc-ipad-evidence/`. Test runner: Appium WebDriverAgent built locally with the existing development certificate, bundle `com.bookarc.devicetests.xctrunner`. The initial automation timeout was resolved by unlocking the iPad. Lock-screen pause/resume, end-to-end local import, offline playback, ten-minute background endurance, hardware/audio-route interruptions and Apple sign-in are not yet counted as passed. The iPad was left in the library, signed into the reviewer account, with playback stopped. No product source fix or store upload was made during this smoke test.

## Next device checks

Keep the iPad unlocked while installing and launching. Verify email and Apple sign-in; cloud library/bookmark/listening-position restoration; EPUB/PDF import; page turns and rotation; offline reading and restart; audiobook play/pause, sentence tracking, down-arrow/X behavior, background/lock-screen controls and interruption handling. Use `docs/audiobook-device-testing.md` for the native playback checklist.

## Store follow-up

App Store Connect app `6802607914` has an iOS 1.0 draft in Prepare for Submission and older 0.12.5 builds. Align the final release's marketing version and draft, upload a properly distribution-signed build for TestFlight, finish iPhone/iPad assets, privacy/age-rating/reviewer details and submit after device verification. The account shows an updated Apple Developer Program License Agreement requiring Account Holder review/acceptance; it was opened for review and was not accepted by the agent. No iOS build was uploaded or submitted during this preparation.


## CarPlay Audio request submitted

On September 11, the owner explicitly authorized accepting the CarPlay Entitlement Addendum and submitting the Audio request for Orpheus Technology Ltd (BYFE3Y9258). The Addendum revision was 06-08-2026, LYL247. Apple immediately showed “Thank you for your submission” and said it would review the request and contact the account with a status update. No reference number was displayed.

The form submitted after the Audio category and agreement acceptance; it did not present app-specific description or bundle-ID fields. The intended app is BookArc (`com.bookarc.app`), but the prepared description was not transmitted. This confirms request receipt, not entitlement approval. After approval, enable the capability on the app ID and regenerate profiles before building/testing CarPlay. Local receipt: `/private/tmp/bookarc-carplay-submission.json`.
