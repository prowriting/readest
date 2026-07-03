import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import {
  installAudioInstrumentation,
  lastAudioTime,
  recordedSeeks,
} from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_MO_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';
import { LibraryPage } from '../pages/LibraryPage';

/**
 * Phase 1 contract: core audiobook playback. A media-overlay EPUB gets an
 * audio badge in the library, opens with a mini player, plays with visible
 * read-along highlighting, pauses/resumes without restarting, and never
 * loses its listening position across a reload.
 */

/** Poll the instrumented live audio time until it exceeds `seconds`. */
async function expectAudioTimeAbove(page: Page, seconds: number, timeout = 10_000): Promise<void> {
  await expect.poll(() => lastAudioTime(page), { timeout }).toBeGreaterThan(seconds);
}

test.describe('audiobook core playback', () => {
  test('audiobook gets an audio badge on its library cover', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(AUDIOBOOK_MO_EPUB);
    await expect(library.bookCards()).toHaveCount(1);
    await expect(library.bookCards().first().locator('[aria-label="Audiobook"]')).toBeVisible();
  });

  test('opening an audiobook shows the mini player with the book title', async ({ openBook }) => {
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(reader.page);
    await expect(player.miniBar).toBeVisible();
    await expect(player.miniBar).toContainText('MO Sentences');
    await expect(player.playButton).toBeVisible();
  });

  test('play starts audio within the latency budget and highlights the active sentence', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    const before = Date.now();
    await player.playButton.click();
    await expectAudioTimeAbove(page, 0.05, 5_000);
    expect(Date.now() - before).toBeLessThan(5_000);

    // Read-along: the SMIL active class appears on the first sentence.
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('Sentence one of chapter 1');
  });

  test('pause halts audio and resume continues without restarting', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await expectAudioTimeAbove(page, 0.3);
    await player.pauseButton.click();
    await expect(player.playButton).toBeVisible();

    const pausedAt = await lastAudioTime(page);
    await page.waitForTimeout(600);
    expect(await lastAudioTime(page)).toBeCloseTo(pausedAt, 1);

    const seeksBeforeResume = (await recordedSeeks(page)).length;
    await player.playButton.click();
    await expectAudioTimeAbove(page, pausedAt + 0.2);
    // Resume must continue the same audio element, not re-seek from anywhere.
    expect((await recordedSeeks(page)).length).toBe(seeksBeforeResume);
  });

  test('full player expands from and collapses to the mini bar', async ({ openBook }) => {
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(reader.page);

    await player.expandButton.click();
    await expect(player.fullPlayer).toBeVisible();
    await player.collapseButton.click();
    await expect(player.fullPlayer).not.toBeVisible();
    await expect(player.miniBar).toBeVisible();
  });

  test('listening position survives a reload', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    // Listen into the second sentence (clips are 1.5s each), then pause to save.
    await player.playButton.click();
    await expectAudioTimeAbove(page, 1.8);
    await player.pauseButton.click();
    const pausedAt = await lastAudioTime(page);

    await page.reload();
    await reader.waitForReady();
    await expect(player.playButton).toBeVisible();
    await player.playButton.click();

    // Restored playback seeks near the saved offset instead of starting over.
    await expect
      .poll(
        async () => {
          const seeks = await recordedSeeks(page);
          return seeks.some((s) => s > pausedAt - 1.6 && s <= pausedAt + 0.1);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await expectAudioTimeAbove(page, pausedAt - 1.6);
  });
});
