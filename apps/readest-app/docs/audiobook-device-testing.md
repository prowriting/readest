# Audiobook device testing checklist

Manual verification for the parts of audiobook playback that automated tests
cannot reach: real lock screens, background execution, interruptions, and
hardware controls. Run on a physical iPhone and a physical Android phone
(emulators do not reproduce audio focus, calls, or Bluetooth accurately).

Everything web-verifiable is already covered by the Playwright suites
(`pnpm test:e2e:web`); this list is the device-only remainder from plan
Phase 7. Use the sentence-level test book (`e2e/fixtures/books/
mo-sentences.epub`) or any real EPUB3 media-overlay title.

## Setup

- [ ] Build and install on device (`pnpm tauri ios build` / `dev-android`).
- [ ] Import an audiobook; confirm the headphone badge and mini player.

## Background playback

- [ ] Start playback, lock the screen: audio continues for ≥ 10 minutes.
- [ ] Start playback, switch to another app for several minutes: audio
      continues; returning to the app shows the correct live position.
- [ ] iOS specifically: kill-and-relaunch after backgrounded playback —
      position restored to within one sentence.

## Lock screen / notification controls

- [ ] Now-playing surface shows cover art, book title, author, and the
      playing chapter.
- [ ] Play/pause from the lock screen works and the in-app player mirrors it.
- [ ] Next/previous track buttons move by chapter.
- [ ] The seek bar shows whole-book position and duration; scrubbing it
      seeks the audio (Android: requires the notification seek bar; iOS:
      the now-playing scrubber).
- [ ] Position/duration keep advancing while locked.

## Interruptions & routes

- [ ] Incoming phone call while playing: audio pauses; after the call ends,
      playback resumes (or stays paused per platform convention) and the
      position is exactly where the interruption happened.
- [ ] Timer/alarm interruption behaves the same.
- [ ] Unplugging wired headphones (or disconnecting Bluetooth) pauses
      playback and never loses the position.
- [ ] Another app taking audio focus (start a song in a music app) pauses
      the audiobook; the position is preserved.

## Downloads & offline

- [ ] Airplane mode: a downloaded audiobook plays fully offline.
- [ ] Wi-Fi Only Downloads on + Wi-Fi off (cellular only): downloading a
      cloud audiobook is blocked with the explanatory toast; turning the
      preference off allows it.
- [ ] Remove Download (Audiobook Storage dialog) frees the space and the
      book re-downloads from the cloud on next open.

## Hardware controls

- [ ] Wired/Bluetooth headphone play/pause toggles playback.
- [ ] Bluetooth next/previous (double/triple press on many headsets) moves
      by chapter.
- [ ] Volume keys work during playback with the screen off.

## AirPlay & audio routes (iOS)

- [ ] The Audio Output button in the full player opens the system route
      sheet; picking an AirPlay speaker moves the audio there.
- [ ] Position keeps advancing and the read-along highlight stays in sync
      while routed to AirPlay; switching back to the phone never loses the
      position.
- [ ] Route switch mid-chapter across a section boundary keeps auto-advance
      working.

## Wearable surfaces (system now-playing)

Decision (recorded in the plan): v1 wearable support is the system
now-playing surfaces driven by the media session — the PRD asks for
playback controls, which these satisfy. Dedicated Watch/Wear apps are
deferred.

- [ ] Apple Watch "Now Playing" shows the book title, author, chapter and
      artwork; play/pause and skip forward/back work and mirror the phone.
- [ ] Watch skip buttons honor the configured skip intervals.
- [ ] Wear OS media controls show the book and control play/pause/skip.
- [ ] Locking the phone does not drop the wearable controls.

## Known platform notes

- iOS background audio is enabled via `UIBackgroundModes: audio`
  (src-tauri/Info.plist). If playback still suspends in background, check
  that the WKWebView audio session is active (NativeBridgePlugin) before
  suspecting the web layer.
- Android lock-screen scrubbing flows through the native-tts plugin's
  `MediaPlaybackService` (`ACTION_SEEK_TO` → `media-session-seek` plugin
  event → the app's `seekto` handler). The Kotlin side compiles with the
  Android app build — it is not covered by any JS/Rust gate, so a failed
  seek bar on device points there first.
- AAC/M4B decoding on devices is native; the desktop `chrome-aac`
  Playwright project already proves the in-package codec path.

## In-car (CarPlay / Android Auto)

Prerequisites: the CarPlay audio entitlement
(`com.apple.developer.carplay-audio`) must be granted by Apple and added to
the provisioning profile + entitlements file before the CarPlay scene will
connect; Android Auto testing uses the Desktop Head Unit (DHU) from the
Android SDK (`sdkmanager 'extras;google;auto'`), with head-unit server
enabled in the Android Auto app's developer settings.

### CarPlay (Simulator: Xcode → I/O → External Displays → CarPlay)

- [ ] The Bookarc icon appears on the CarPlay home screen.
- [ ] Launching it shows the "Audiobooks" list, most recent first, with
      titles + authors (no truncated-critical text, tappable row height).
- [ ] Tapping a book with no cached chapters starts playback and lands on
      the system Now Playing screen with correct metadata.
- [ ] Tapping the currently open book shows Resume + the chapter list;
      tapping a chapter plays that chapter.
- [ ] Now Playing: play/pause, skip forward/back (configured intervals via
      the media-session handlers), and the progress bar reflect the phone.
- [ ] Disconnecting and reconnecting the car resumes the correct position.
- [ ] While driving-mode restrictions are simulated (Simulator → "limit UI"),
      the list remains usable: no deep nesting beyond book → chapters.

### Android Auto (DHU)

- [ ] Bookarc appears in the Auto media apps row.
- [ ] The browse tab lists audiobooks (title + author); a book expands to
      its chapters when it is the one currently open in the app.
- [ ] Selecting a book/chapter starts playback on the phone and the Auto
      playback view shows metadata, a bounded seek bar, and working
      play/pause/skip/seek.
- [ ] Voice: "OK Google, pause" / "resume" control playback (media session
      transport actions).
- [ ] App is not usable for anything except media while parked-restrictions
      are simulated (DHU `restrict` command).

### Distraction-compliance notes (documented pass)

- Browse depth is two levels (books → chapters) — within both Apple's
  CarPlay audio-app guidance and Android for Cars media guidelines.
- All strings on car screens come from book metadata (no free text entry,
  no web content); controls are template-native so sizing/contrast are
  system-managed.
- Playback state, metadata, artwork and seek all flow through the existing
  media session — no custom drawing on the head unit.
