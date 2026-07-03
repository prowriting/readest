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

## Wearable surfaces (system now-playing, phase 10 preview)

- [ ] Apple Watch "Now Playing" shows the book and controls play/pause/skip.
- [ ] Wear OS media controls show the book and control playback.

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
