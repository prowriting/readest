# Audiobooks v1 — Implementation Plan

**Source PRD:** `Audiobook_PRD.html` / `audiobook_prd.md` (Chris Banks, 2026-07-03, Draft v1)
**Branch:** `audiobook2` (== `rebrand` HEAD at plan time)
**Method:** TDD throughout — every phase starts by writing its acceptance tests (Playwright web e2e + vitest unit), watching them fail, then implementing to green. Repo rule `.agents/rules/test-first.md` applies to every change.

**Prior-work policy (decided 2026-07-03):** the `audiobooks` branch commit (`c0ee8244`) is **highly broken and will NOT be ported**. It may be consulted only as a *scenario catalog* (what surfaces/behaviors were attempted, which e2e techniques worked) — **no code is copied from it**. The uncommitted foliate-js submodule extensions built alongside it get the same treatment: preserved as a reference patch, then the submodule is reset to its pin; any engine extension re-enters only through a failing test.

---

## 1. Where we're starting from (verified against the working tree)

| Asset | State |
| --- | --- |
| `packages/foliate-js` `MediaOverlay` (epub.js:429) | **Upstream (pinned) class is the baseline we build on:** plays SMIL media overlays, per-item highlight/unhighlight events, rate/volume, pause/resume, prev/next item, section auto-advance. Known upstream bug: view.js highlight handler uses `x.index = resolved.index` (assignment in a `find` predicate) + missing null checks — will be caught by our highlight e2e and fixed test-first. The working tree currently carries ~115 lines of **uncommitted, untrusted extensions** (seek/position/duration/data-URL loading) from the broken prototype — to be exported to a reference patch and reset in Phase 0. |
| `audiobooks` branch (`c0ee8244`) | **Reference-only. Do not port.** Useful as a catalog: which UI surfaces were attempted (mini-bar/full player/library badge), 21 e2e scenario ideas, and proven test techniques (`HTMLMediaElement` interception for seeks/rates/currentTime, since `new Audio()` elements never enter the DOM). |
| Playwright web lane | `playwright.config.ts`, `e2e/fixtures/base.ts` (`openBook` fixture, demo-books suppressed), page objects (`LibraryPage`, `ReaderPage` with visible-iframe scan), import via `filechooser`. No audio fixture; only `sample-alice.epub` (414 KB) + txt. |
| MediaSession | `src/libs/mediaSession.ts` abstracts web `navigator.mediaSession` vs `TauriMediaSession` (Android native-tts plugin), supports position/duration + seek events. `useTTSMediaSession.ts` shows the wiring pattern. |
| Native plugins | `tauri-plugin-native-tts/android/MediaPlaybackService.kt` — MediaSessionCompat + audio focus + MediaStyle notification + **`MediaBrowserServiceCompat` with `onGetRoot`** (the exact service Android Auto binds to). iOS `NativeBridgePlugin.swift` — AVAudioSession management + `MPRemoteCommandCenter` forwarding into the webview. **No `UIBackgroundModes: audio` found in `src-tauri/Info.plist`** — must be audited/added. |
| Position persistence & sync | Per-book `config.json` via `bookDataStore.saveConfig` → `appService.saveBookConfig`; debounced autosave (`useProgressAutoSave`); cloud sync via `useProgressSync` → `SyncClient` (`/sync`, REST) **and** a newer replica/CRDT path (`src/services/sync/replica*`). Sync categories gate `'progress'`. |
| Bookmarks | `BookNote type:'bookmark'` in `config.booknotes`, `BookmarkToggler`, synced as notes. Reusable for audio bookmarks. |
| Sleep timer | TTS has timeout state in `useTTSControl` (`timeoutOption/timeoutTimestamp`) + UI in `TTSPanel` — pattern to follow, not shared code. |
| Stats | Dwell-time analytics pipeline (`DwellRecord`, `useDwellTracking`, `useAnalyticsDwells`, sync type `'dwells'`), opt-in. No user-facing stats screens. |
| Library | `BookItem` has cloud-transfer overlays + `StatusBadge` pattern; `ContinueReadingStrip` surfaces most recent book from `settings.lastOpenBooks`. |

**Codec reality check for tests:** Playwright's bundled Chromium plays WAV/MP3/Opus but **not AAC/M4B** (licensed codecs). E2e fixtures use WAV/MP3; AAC/M4B coverage runs as an optional `channel: 'chrome'` Playwright project + on-device checks. On iOS/Android WebViews, AAC/M4B play natively.

**Format scope decision (recommendation baked into this plan):** v1 = **EPUB3 only** (Media Overlays for read-along; audio-only-EPUB3 = same mechanism with minimal text). W3C/LPF `.audiobook` packages and bare `.m4b` import are deferred — foliate-js has no LPF book module, real-world LPF catalog is tiny, and the PRD's codec requirement (M4B) is satisfied by m4b/AAC audio *inside* EPUB packages. Revisit if the sourcing plan (PRD open question) surfaces LPF titles.

---

## 2. TDD workflow (applies to every phase)

1. **Write the phase's e2e acceptance specs first** in `e2e/tests/` — they are the phase contract. Mark unimplemented behaviors with failing (not skipped) tests locally; commit them together with the implementation once green.
2. **Unit-test-first for every pure module** (vitest, `src/__tests__/`): SMIL/duration math, sleep-timer state machine, sync merge, detection heuristics, storage math. Failing test → implement → green.
3. **Nothing from the broken prototype enters without a test.** The old branch and the reference patch are consulted for *what* to build and *where the traps are* (WKWebView audio loading, seek-while-playing races), never copy-pasted. If a reference technique is right, it's re-implemented against a failing test that proves the behavior.
4. Page objects get actions/locators only; assertions stay in specs (harness convention).
5. Per-phase definition of done (all self-checkable):
   - `pnpm test` green (new + existing; `auth.test.ts` failure is pre-existing on this branch — track separately)
   - `pnpm test:e2e:web` green including the phase's new spec file
   - `pnpm lint` green; `pnpm fmt:check`/`clippy:check` when `src-tauri` touched
   - i18n: new strings extracted/translated (`/i18n` flow), `pnpm check:translations`
   - New UI verified under `[data-eink='true']` and RTL where applicable
   - Aria labels/roles asserted in the phase's e2e specs (accessibility is per-phase, the final phase is the audit, not the retrofit)

---

## 3. Phases

### Phase 0 — Test infrastructure & clean baseline (S/M)

*Goal: deterministic fixtures, e2e scaffolding, and an untainted engine baseline — the rig every later phase's red tests run on. No feature code.*

Deliverables:
1. **Submodule hygiene:** export the current uncommitted foliate-js diff to `patches/foliate-js-media-overlay.reference.patch` (reference-only, committed to this repo for archaeology), then reset `packages/foliate-js` to its pinned commit. Root `git status` ends clean; the app builds and existing tests stay green (no app code on this branch references the extensions — verified).
2. **Fixture generator** `e2e/fixtures/make-audiobook-fixtures.mjs` producing committed fixtures (< ~300 KB total):
   - `mo-sentences.epub` — 3 chapters × ~8 sentences, sentence-level SMIL, short generated WAV/MP3 clips (distinct tones per sentence so seeks are observable); one chapter authored word-level for granularity coverage
   - `mo-audio-only.epub` — chapters are title-only XHTML with full-chapter audio (the audio-only shape); OPF carries `media:duration` metadata
   - `mo-malformed.epub` — missing audio file + one broken SMIL reference
   - Generator is itself unit-tested (valid zip structure, SMIL parses, durations as declared)
3. **E2e audio instrumentation** as shared fixtures in `e2e/fixtures/`: `HTMLMediaElement` prototype interception exposing `_seeks`, `_rates`, `_getAudioTime()` via init script (the one proven technique worth re-implementing from the old spec — audio elements created with `new Audio()` never enter the DOM, so locators can't see them).
4. **Page object skeleton** `e2e/pages/AudiobookPlayerPage.ts` (grows with each phase; actions/locators only).
5. **Process kick-offs:** file the CarPlay entitlement request (weeks of Apple lead time; gates release, not dev); raise the catalog/sourcing question from PRD §9.

Acceptance (self-checkable):
- `pnpm test:e2e:web` full existing suite green after submodule reset; `pnpm test`, `pnpm lint` green; `git status` clean at root
- Fixture generator unit tests green; generated EPUBs open in the reader without errors (smoke e2e); combined fixture size < 300 KB
- Reference patch file committed; submodule pin unchanged from upstream

### Phase 1 — Core playback engine & mini player, built fresh (M/L)

*Goal: the walking skeleton the whole feature hangs off — an MO book imports with an audio badge, opens with a mini player, plays/pauses/resumes with visible highlight, and never loses its position. All new code, test-first.*

Deliverables:
1. **Detection at import:** `Book.hasAudio` from OPF media-overlay presence — pure function over the parsed package, unit-tested against all three fixtures + a plain ebook.
2. **Types/store/config:** `MediaOverlayConfig` (+ defaults in `constants.ts`/`settingsService`), `BookConfig.mediaOverlayLocation` (schema + serialization round-trip unit tests), reader-store state for player visibility/enabled.
3. **Playback hook** (`useMediaOverlayControl` or equivalent, written fresh): explicit state machine (`stopped/loading/playing/paused/ended/error`), play/pause/resume/stop against `view.mediaOverlay`, position capture on pause + save interval, restore-on-open, foliate `error` events surfaced as toasts. State machine extracted as a pure module and unit-tested; the hook is thin.
4. **Engine extensions, re-derived test-first as the app demands them** (committed to a branch on the foliate-js fork, pin updated): expected minimum is a way to read the active section/item and current audio time (for position save/restore). Each lands with a test that fails without it. The upstream view.js `find`-predicate highlight bug gets fixed here via a failing highlight e2e — kept as its own commit (upstreamable).
5. **UI:** mini-bar (play/pause, title, basic elapsed), expandable full-player shell (expand/collapse only — transport lands next phase), mounted from `FooterBar` alongside the TTS control; library cover badge (headphone glyph via the `StatusBadge` pattern), e-ink + RTL correct.
6. **WKWebView audio-loading strategy** (the reference patch warns blob URLs fail there): decide data-URL vs served-URL loading with a small on-device spike; whichever wins is covered by a unit test at the loader seam.

Acceptance:
- New `audiobook-core.spec.ts` (fresh, scenario ideas from the old catalog): import `mo-sentences.epub` → badge visible in library; open → mini-bar appears with title; Play starts audio (`_getAudioTime()` advances) within 2 s; highlight class appears on the active sentence in the visible iframe; Pause halts audio (time stops advancing); Resume continues from the same position (not restart — assert no seek-to-0 in `_seeks`); expand/collapse player shell; reload book → position restored within tolerance (assert restore seek in `_seeks`); `mo-malformed.epub` opens without crash
- Unit: detection, state machine transitions, config round-trip, loader seam — `pnpm test`
- `pnpm lint` green; new strings i18n-extracted; controls have aria labels (asserted in spec)

### Phase 2 — Transport completeness (PRD 5.2 core) (M)

*Goal: the full transport a listener expects, hardened against edge cases.*

Deliverables:
1. **Variable speed 0.5×–3.0×** in fine steps (slider + presets in full player; per-book persistence in `MediaOverlayConfig`; live `playbackRate` change without restart).
2. **Skip forward/back** with configurable intervals (10/15/30/60 s, both directions independently) in a player settings sheet — requires a real `seekRelative` in the engine, built test-first (seek within clip, across clips, across audio files, across sections; clamp at book edges).
3. **Chapter navigation:** prev/next chapter buttons (prev restarts current chapter mid-chapter, jumps back at chapter start — standard player semantics) + chapter list from TOC with jump.
4. **Whole-book duration model:** parse `media:duration` metadata from the OPF (per-refinement + total) with fallback to on-demand SMIL scan, so elapsed/remaining are correct from cold start. Pure module + unit tests first.
5. **Book-level scrubber:** seek across sections (maps global offset → section + SMIL item), elapsed/remaining labels, chapter markers.
6. **Auto-advance & end-of-book:** continuous playback across sections, explicit `ended` UI state, position pinned at end, no restart-from-zero.
7. **Error states** (PRD 5.1): missing/corrupt audio or SMIL → toast + inline player error state, playback of remaining valid sections still possible; uses `mo-malformed.epub`.

Acceptance:
- New `audiobook-transport.spec.ts`: speed slider changes `_rates` and persists across reopen; skip buttons seek by the configured interval from the *current* audio position (assert `_seeks` deltas — the classic bug is seeking from paragraph start); chapter prev/next semantics as specified (assert active section index via the engine); book scrubber commits to correct section+time; remaining-time label monotonically decreases while playing; end-of-book shows ended state; malformed book shows error toast and keeps UI responsive
- Unit: duration model, global-offset→(section,item) mapping, seekRelative edge cases, interval config persistence

### Phase 3 — Read-along experience (PRD 5.3) (M)

*Goal: the differentiator — tight, configurable, theme-aware read-along.*

Deliverables:
1. **Highlight styling setting** (color presets incl. high-contrast, underline/background style) applied via the injected `activeClass` CSS in `FoliateViewer`; respects reading themes incl. dark and e-ink.
2. **Auto-scroll/auto-page** keeps active item visible in both paginated and scrolled modes; no fighting user scroll (pause follow while user is interacting, resume after idle or on chapter jump — same UX rule TTS uses).
3. **Tap-to-play-from-here:** tapping a sentence during playback (or when paused with the player open) seeks audio to that SMIL item — map tapped range → CFI → MO item.
4. **Read-along toggle:** highlight+follow off while audio continues; independent "reader mode" — user can page away freely while listening, with a "return to playing position" affordance.
5. **Granularity:** honor whatever granularity the SMIL provides (word or sentence); the word-level fixture chapter proves it.

Acceptance:
- `audiobook-readalong.spec.ts`: active class advances across sentence elements in the visible iframe; page auto-turns at section boundary while playing; tap on later sentence produces the matching seek; highlight color setting changes computed style inside the iframe; toggle off → audio keeps playing (`_getAudioTime` advances) with no active class present; word-level chapter highlights word spans
- Unit: range→MO-item mapping

### Phase 4 — Sleep timer & bookmarks (PRD 5.2) (S/M)

Deliverables:
1. **Sleep timer:** presets (5/15/30/60 min), **end-of-current-chapter**, custom; volume fade-out over the final seconds; countdown visible in player; cancel/extend. Implemented as a pure state machine module driven by injected clock (unit-testable), UI on top.
2. **Audio bookmarks:** reuse `BookNote type:'bookmark'` — CFI of the active MO item + captured audio offset + optional note (existing note editor); bookmark list in the player (and sidebar) with timestamps; tap → seek. Syncs like existing booknotes with zero new sync surface.

Acceptance:
- `audiobook-sleep-bookmarks.spec.ts` using Playwright's clock API: set 15-min timer → advance clock → audio paused (and volume fade observed); end-of-chapter option pauses exactly at section boundary (assert section index unchanged after pause); add bookmark mid-sentence → appears in list with timestamp → tapping it seeks (assert `_seeks`) and highlights the right sentence; bookmark note round-trips
- Unit: timer state machine (all transitions incl. cancel/extend/end-of-chapter), bookmark serialization

### Phase 5 — Audio-only audiobooks (PRD 5.1) (M/L)

*Goal: books with no meaningful text get a player-first experience, not a paginated near-empty reader.*

Deliverables:
1. **Detection:** `isAudioOnly` heuristic at import (MO covers ~all spine + text char count below threshold; metadata `media:duration` present) — pure function, unit-tested against fixture OPFs; stored on `Book`.
2. **Player-first reader mode:** when `isAudioOnly`, `/reader` renders a dedicated player screen (cover, title/author, transport, book scrubber, chapter list, speed, sleep timer, bookmarks) instead of paginated text; foliate still drives playback underneath (hidden view).
3. **Codec coverage:** mime map extended (m4a/m4b/aac); optional Playwright `chrome` channel project for an AAC fixture; on-device checklist entry for M4B-in-EPUB.
4. **Library treatment:** audio-only books show duration (not page count) and the audio badge (from Phase 1); "reading status" derived from listen position.

Acceptance:
- `audiobook-audio-only.spec.ts`: importing `mo-audio-only.epub` → cover badge; opening lands on player UI (no pagination chrome); play/chapter-nav/scrub/restore-position all work; reload restores exact position
- Unit: detection heuristic across MO, audio-only, plain-ebook, malformed OPFs
- AAC project (`channel: chrome`) green locally where Chrome is installed; skipped cleanly otherwise

### Phase 6 — Library & continuity (PRD 5.4) (M)

Deliverables:
1. **Continue Listening:** `ContinueReadingStrip` + library "recently played" surfacing for audiobooks (resume position shown as time, play affordance).
2. **Audiobook library filter/section** and audio indicator polish (grid + list modes, e-ink).
3. **Cross-device position sync:** `mediaOverlayLocation` (+`updatedAt`) rides both sync paths (REST `SyncClient` config records and the replica path); conflict policy = latest `updatedAt` wins (consistent with progress). Unit tests on merge in both paths. (Web e2e lane is unauthenticated, so cross-device is proven by unit/integration tests + a manual two-device checklist item.)
4. **Listening stats:** listening time feeds the existing dwell pipeline (`DwellRecord` from MO playback intervals — section + char ranges from active items; opt-in respected). No new user-facing stats screens in v1 (none exist for reading either) — parity is the requirement.

Acceptance:
- `audiobook-library.spec.ts`: after listening, strip shows the book with resume time; filter shows only audiobooks; position survives reload and the config JSON contains synced fields with fresh `updatedAt`
- Unit: sync merge (both paths) incl. conflict cases; dwell records emitted during playback map to played ranges and respect consent gating

### Phase 7 — Background playback, media session, headphone controls (PRD 5.2/5.6) (L, native)

*Goal: lock-screen/notification controls, background audio, interruption recovery — the foundation CarPlay/Auto/wearables sit on.*

Deliverables:
1. **Web/desktop MediaSession** (via existing `src/libs/mediaSession.ts`): metadata w/ cover art, `setPositionState` (position/duration/rate), handlers: play/pause/seekforward/seekbackward (configured intervals), seekto, previous/next track → chapters.
2. **iOS:** audit/add `UIBackgroundModes: audio`; AVAudioSession `.playback` active during audiobook playback (extend `NativeBridgePlugin`); `MPNowPlayingInfoCenter` elapsed/duration/rate kept true; `MPRemoteCommandCenter` skip-interval commands (forwarding exists — extend to skip/seek); interruption (call) → pause, resume-after per system signal.
3. **Android:** generalize `tauri-plugin-native-tts` media pieces into a shared media-session plugin (or extend in place): notification with seek bar (`PlaybackStateCompat` position), audio focus transient-loss ducking/pause-resume, correct `MediaStyle` actions for audiobooks.
4. **Interruption/route change policy** (both platforms): pause on unplug/focus loss, never lose position (position save on every pause + 10 s interval + visibility change).
5. Bluetooth/wired remote controls come free via the above — verified manually.

Acceptance (self-checkable extent):
- `audiobook-mediasession.spec.ts` (web): `navigator.mediaSession.metadata` populated with book/chapter/cover; playbackState mirrors UI; invoking our registered handlers via the app's own dispatch layer performs the seeks (assert `_seeks`); position state updates while playing
- Unit/contract: plugin command payloads (TS ↔ Rust) round-trip; Rust `cargo clippy`/`fmt` green; iOS `xcodebuild build` (sim destination) and Android `gradle assembleDebug` compile gates
- **Manual device checklist** (deliverable artifact, for Chris): background continue ≥ 10 min screen-off, lock-screen controls incl. skip intervals + scrubbing, phone-call interruption resume, headphone unplug pause, Bluetooth multi-press skip — iOS + Android

### Phase 8 — Offline, storage & downloads (PRD 5.7) (M)

Deliverables:
1. Audiobook-size-aware transfer UX: existing cloud upload/download + radial progress verified for 100 MB+ files, resumable/retry behavior, clear failure states.
2. **Storage dashboard** (settings): total audio storage, per-title sizes, remove-download per title + bulk; uses existing fs APIs.
3. **Wi-Fi-only downloads** toggle: gating logic as a pure tested module; network-type detection via existing native bridges where available (web: N/A gracefully).
4. Library bulk select → download/remove for audiobooks (extends existing select mode).
5. **Download quality/bitrate: deferred** — requires server-side transcoding (BookArcReaderApi ticket); v1 ships original quality. Recorded as an explicit descope.

Acceptance:
- Unit: storage math, wifi-only gating, size formatting
- `audiobook-storage.spec.ts`: dashboard lists imported audiobook with size; remove-download clears it and UI reflects state (web build uses its local storage equivalent)
- Manual checklist: airplane-mode playback of downloaded title; wifi-only blocks cellular download (device)

### Phase 9 — CarPlay & Android Auto (PRD 5.5) (XL, native)

*Prereq: Phase 7. The CarPlay entitlement request fires at Phase 0 — Apple approval has weeks of lead time and gates App Store release, not development.*

Deliverables:
1. **Typed AudiobookBridge protocol** (TS ↔ Rust ↔ Swift/Kotlin): `listAudiobooks`, `listChapters(bookId)`, `play(bookId, chapter?)`, transport commands, and a state event stream (playing/position/book). Contract unit tests on both sides; this is the testable core.
2. **iOS CarPlay:** `CPTemplateApplicationSceneDelegate` scene; `CPListTemplate` tabs (Continue Listening, Library, Chapters); `CPNowPlayingTemplate` with skip intervals + rate button; connect/disconnect resumes correct position (audio session continuity).
3. **Android Auto:** extend the existing `MediaBrowserServiceCompat` tree (root exists in the TTS plugin) with the audiobook library/chapters hierarchy; playback commands route through the bridge; distraction-guideline-compliant metadata/icons; evaluate Media3 migration while in there (recommend yes if low-risk, else ticket it).
4. Driving-distraction compliance pass (glanceability, voice-safe labels) against Apple/Google checklists — documented.

Acceptance (self-checkable extent):
- Bridge contract tests green (TS + Rust); Swift/Kotlin compile gates green
- CarPlay Simulator (Xcode I/O → External Displays) and Android DHU **manual test scripts with expected screens** — deliverable checklist for Chris; builds + bridge behavior verified via unit/integration, head-unit UI verified manually
- Regression: full web e2e suite still green (bridge refactors must not disturb the web player)

### Phase 10 — Casting & wearables (PRD 5.6) (M as scoped; decisions required)

Deliverables:
1. **AirPlay (iOS):** `AVRoutePickerView` exposed as a player button via the native bridge; system routes WKWebView audio; verify long-form playback + position integrity on route change. (Small — OS does the work.)
2. **Wearables v1 = system Now Playing surfaces:** with Phase 7 done correctly, Apple Watch Now Playing and Wear OS media controls (play/pause/skip/speed via media session) work without building watch apps. Deliverable: on-device verification checklist + fixes for whatever the session metadata gets wrong. **Dedicated Watch/Wear apps: deferred** (documented decision — PRD asks for "playback controls", which system surfaces satisfy).
3. **Chromecast: decision gate before any code.** Receivers pull media over the network, so casting local files needs an embedded HTTP server (or cloud URLs) + native Cast SDK on both platforms. Options: (a) defer entirely (recommended), (b) cloud-stored books only via remote URLs. Costed in plan; build only after Chris picks.

Acceptance:
- AirPlay button present/aria-labeled (e2e asserts the control renders on iOS-capability builds; behavior manual); route-change position integrity on the manual checklist
- Wearable checklist executed on Watch + Wear OS device/emulator
- Chromecast decision recorded; if (b), its own spec + phase addendum

### Phase 11 — Accessibility audit, resilience & performance hardening (PRD 5.8 + NFRs) (M)

Deliverables:
1. **A11y audit:** axe scan (`@axe-core/playwright`) on library-with-audio, mini-bar, full player, player settings; VoiceOver/TalkBack manual pass scripts; dynamic-type/large-text verification; dyslexia-font + high-contrast highlight interplay checks (built in Phase 3, audited here).
2. **Never-lose-position guarantee:** position save on pause/interval/visibilitychange/`beforeunload`; e2e kills the page mid-playback and asserts restore within tolerance; interruption-recovery unit tests.
3. **Performance:** e2e budget assertions (play-start < 2 s, scrub-commit < 500 ms perceived) tracked in the spec; battery/data spot-checks on device checklist.
4. **Skip-silence & volume boost (PRD "optional"):** Web Audio (GainNode + silence gate) — only if the audio-loading pipeline chosen in Phase 1 tolerates `AudioContext` routing on WKWebView; time-boxed spike first, descope without ceremony if it fights the platform.

Acceptance:
- axe: zero serious/critical violations on audited surfaces; keyboard operability e2e (tab order, space/enter transport)
- Crash-resilience e2e green; perf assertions green in CI
- Device a11y checklist executed

---

## 4. Suggested delivery mapping

One PR per phase onto `main` (phases 0–6 are pure web/TS and independently shippable; 7–11 touch native). Phase 0 lands first and unblocks everything; Phases 1–4 proceed serially (each builds on the last); Phases 5 and 6 are parallelizable; 7 gates 9/10. CarPlay entitlement request + catalog/sourcing question (PRD §9) fire immediately at Phase 0.

## 5. Open decisions (defaults chosen so work never blocks)

| # | Decision | Status |
| --- | --- | --- |
| 1 | Reuse `audiobooks` branch commit vs rebuild | **RESOLVED (Chris, 2026-07-03): rebuild from scratch — the commit is highly broken. Reference/scenario catalog only; no code copied.** |
| 2 | Untrusted foliate-js submodule extensions | Default: export to reference patch, reset submodule, re-derive test-first (Phase 0/1) |
| 3 | W3C/LPF packages + bare `.m4b` import in v1 | **Defer**; EPUB3-only v1, m4b-as-in-package-codec covered |
| 4 | Streaming-without-full-download (PRD 5.1) | **Defer**; v1 = download-to-play (current model), streaming phase later |
| 5 | Download quality/bitrate selection | **Defer** (needs server transcoding — BookArcReaderApi ticket) |
| 6 | Chromecast scope | **Defer / decision gate** at Phase 10 |
| 7 | Dedicated Watch/Wear apps | **Defer**; system Now Playing surfaces satisfy v1 controls |

## 6. Risks

- **Unknown failure modes in the prototype:** we don't know exactly *why* the old build was broken, so nothing is trusted by association — every behavior re-enters through a failing test, and the fixture matrix (sentence/word/audio-only/malformed) is built before any feature code (Phase 0) to catch engine-level breakage early.
- **SMIL authoring variance** (PRD §9): mitigated by fixture matrix + Phase 2 error states; add publisher-book smoke tests as real titles arrive.
- **WKWebView audio loading** (blob-URL vs data-URL): flagged by the reference patch as a real trap; Phase 1 runs a small on-device spike before committing to a loader.
- **CarPlay entitlement lead time**: request at Phase 0; App Store release gate, not dev gate.
- **AAC/M4B not testable in bundled Chromium**: covered via `chrome`-channel project + device checklist (known, scoped).
- **Two sync paths (REST + replica)**: the new position field must merge correctly in both; unit tests on each are non-negotiable (Phase 6).
- **Background audio on iOS WKWebView**: `UIBackgroundModes` audit is Phase 7 item #1; if WKWebView background audio proves unreliable for long sessions, fallback is native `AVAudioPlayer` playback for audio (bridge exists) — spike early in Phase 7.
