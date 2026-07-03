import { expect, test } from '../fixtures/base';
import { installAudioInstrumentation, lastAudioTime } from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_MO_EPUB, SAMPLE_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';
import { LibraryPage } from '../pages/LibraryPage';

/**
 * Phase 6 contract: library & continuity. The continue strip adapts to
 * audiobooks with a listening label and time-left, and the library can
 * filter down to audiobooks. Fixture: 30s total (12+12+6).
 */

test.describe('continue listening', () => {
  test('the strip shows listening progress and survives a reload', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    // Listen into the second sentence, then pause (position saved).
    await player.playButton.click();
    await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(2.2);
    await player.pauseButton.click();

    const library = new LibraryPage(page);
    await library.goto();
    const strip = page.getByRole('button', { name: /Continue listening/ });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('MO Sentences');
    // ~27s of the 30s book remain.
    await expect(strip).toContainText(/0:2[0-9] left/);

    // The denormalized position survives a full app reload.
    await page.reload();
    await expect(strip).toBeVisible();
    await expect(strip).toContainText(/0:2[0-9] left/);

    await strip.click();
    await page.waitForURL(/\/reader/);
  });

  test('text books keep the reading label', async ({ page, openBook }) => {
    await openBook(SAMPLE_EPUB);
    const library = new LibraryPage(page);
    await library.goto();
    const strip = page.getByRole('button', { name: /Continue reading/ });
    await expect(strip).toBeVisible();
    await expect(strip).not.toContainText(/left/);
  });
});

test.describe('audiobook library filter', () => {
  test('filters the bookshelf down to audiobooks and back', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(SAMPLE_EPUB);
    await expect(library.bookCards()).toHaveCount(1);
    await library.importAnotherBook(AUDIOBOOK_MO_EPUB);
    await expect(library.bookCards()).toHaveCount(2);

    await library.toggleAudiobooksOnly();
    await expect(library.bookCards()).toHaveCount(1);
    await expect(library.bookCards().first().locator('[aria-label="Audiobook"]')).toBeVisible();

    await library.toggleAudiobooksOnly();
    await expect(library.bookCards()).toHaveCount(2);
  });
});
