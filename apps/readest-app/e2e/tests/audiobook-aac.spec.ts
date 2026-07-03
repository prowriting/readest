import { expect, test } from '../fixtures/base';
import { installAudioInstrumentation, lastAudioTime } from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_AAC_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';

/**
 * Codec-coverage lane (chrome-aac project only): AAC-in-MP4 audio inside an
 * EPUB3 media overlay actually decodes and plays. Bundled Chromium lacks the
 * codec, so the chromium project ignores this spec.
 */
test('an AAC (m4a) audiobook plays', async ({ page, openBook }) => {
  await installAudioInstrumentation(page);
  await openBook(AUDIOBOOK_AAC_EPUB);
  const player = new AudiobookPlayerPage(page);

  // Audio-only shape → player screen; playing proves the AAC decode.
  await expect(player.audioOnlyScreen).toBeVisible();
  await player.playButton.click();
  await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
});
