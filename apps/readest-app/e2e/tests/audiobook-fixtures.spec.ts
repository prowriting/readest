import { expect, test } from '../fixtures/base';
import {
  installAudioInstrumentation,
  lastAudioTime,
  recordedRates,
  recordedSeeks,
} from '../fixtures/audio-instrumentation';
import {
  AUDIOBOOK_AUDIO_ONLY_EPUB,
  AUDIOBOOK_LONG_EPUB,
  AUDIOBOOK_MALFORMED_EPUB,
  AUDIOBOOK_MO_EPUB,
} from '../fixtures/books';

/**
 * Phase 0 infrastructure smoke tests: the generated Media Overlay fixtures
 * are importable, openable books, and the audio instrumentation the later
 * audiobook specs rely on actually records. Playback behavior is Phase 1+.
 */
test.describe('audiobook fixture books', () => {
  const fixtures: [string, string][] = [
    ['sentence-level media overlay book', AUDIOBOOK_MO_EPUB],
    ['long media overlay book', AUDIOBOOK_LONG_EPUB],
    ['audio-only book', AUDIOBOOK_AUDIO_ONLY_EPUB],
    ['malformed media overlay book', AUDIOBOOK_MALFORMED_EPUB],
  ];

  for (const [label, filePath] of fixtures) {
    test(`${label} imports and opens in the reader`, async ({ openBook }) => {
      const reader = await openBook(filePath);
      await expect(reader.foliateView).toBeAttached();
      await expect(reader.viewer).toBeVisible();
    });
  }
});

test.describe('audio instrumentation', () => {
  test('records seeks and rate changes on non-looping audio only', async ({ page }) => {
    await installAudioInstrumentation(page);
    await page.goto('/');

    await page.evaluate(() => {
      const audio = new Audio();
      audio.currentTime = 3.5;
      audio.playbackRate = 1.75;
      void audio.currentTime; // sampled read → tracked as last audio time
      const looped = new Audio();
      looped.loop = true;
      looped.currentTime = 9; // looping elements must be ignored
      looped.playbackRate = 2;
    });

    expect(await recordedSeeks(page)).toEqual([3.5]);
    expect(await recordedRates(page)).toEqual([1.75]);
    // With no media attached, currentTime reads back the pending seek position.
    expect(await lastAudioTime(page)).toBe(3.5);
  });
});
