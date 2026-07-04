import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import {
  installAudioInstrumentation,
  lastAudioTime,
  recordedSeeks,
} from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_AUDIO_ONLY_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';
import { LibraryPage } from '../pages/LibraryPage';

/**
 * Phase 5 contract: audio-only audiobooks get a player-first screen instead
 * of a paginated near-empty reader. Fixture: three title-only chapters with
 * one 10s full-chapter clip each (30s total, media:duration declared).
 */

const activeSectionIndex = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as {
      mediaOverlay?: { activeSectionIndex: number };
    } | null;
    return view?.mediaOverlay?.activeSectionIndex ?? -1;
  });

test.describe('audio-only audiobooks', () => {
  test('the library shows the audio badge and total duration instead of pages', async ({
    page,
  }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(AUDIOBOOK_AUDIO_ONLY_EPUB);
    await expect(library.bookCards()).toHaveCount(1);
    const card = library.bookCards().first();
    await expect(card.locator('[aria-label="Audiobook"]')).toBeVisible();
    await expect(card).toContainText('0:30');
  });

  test('opening lands on the player screen, not the paginated reader', async ({ openBook }) => {
    const reader = await openBook(AUDIOBOOK_AUDIO_ONLY_EPUB);
    const player = new AudiobookPlayerPage(reader.page);

    await expect(player.playerScreen).toBeVisible();
    await expect(player.playerScreen).toContainText('MO Audio Only');
    // The full transport lives on the screen — no tray while expanded.
    await expect(player.playButton).toBeVisible();
    await expect(player.scrubber).toBeVisible();
    await expect(player.miniBar).toHaveCount(0);
    await expect(player.expandButton).toHaveCount(0);
    // v2 §5: audio-only states are fullscreen ↔ minimized bottom tray.
    await expect(player.minimizeButton).toBeVisible();
  });

  test('minimize drops the fullscreen player to the tray; expanding restores it', async ({
    page,
    openBook,
  }) => {
    await openBook(AUDIOBOOK_AUDIO_ONLY_EPUB);
    const player = new AudiobookPlayerPage(page);

    await expect(player.playerScreen).toBeVisible();
    await player.minimizeButton.click();
    await expect(player.playerScreen).toHaveCount(0);
    await expect(player.miniBar).toBeVisible();

    await player.expandButton.click();
    await expect(player.playerScreen).toBeVisible();
    await expect(player.miniBar).toHaveCount(0);
  });

  test('plays, navigates chapters, scrubs, and restores the position', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_AUDIO_ONLY_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.05);

    await player.nextChapterButton.click();
    await expect.poll(() => activeSectionIndex(page)).toBe(1);

    // Chapter-scoped scrubber (PRD §5.1): 5s into chapter 2's single clip.
    await player.scrubber.fill('5');
    await expect
      .poll(
        async () => {
          const seeks = await recordedSeeks(page);
          return seeks.some((s) => Math.abs(s - 5) < 0.5);
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    await player.pauseButton.click();
    const pausedAt = await lastAudioTime(page);

    await page.reload();
    await reader.waitForReady();
    await expect(player.playerScreen).toBeVisible();
    await player.playButton.click();
    await expect
      .poll(
        async () => {
          const seeks = await recordedSeeks(page);
          return seeks.some((s) => Math.abs(s - pausedAt) < 0.5);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect.poll(() => activeSectionIndex(page), { timeout: 10_000 }).toBe(1);
  });

  test('the screen back control returns to the library', async ({ page, openBook }) => {
    await openBook(AUDIOBOOK_AUDIO_ONLY_EPUB);
    const player = new AudiobookPlayerPage(page);
    await player.screenBackButton.click();
    const library = new LibraryPage(page);
    await expect(library.container).toBeVisible({ timeout: 10_000 });
  });
});
