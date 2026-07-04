import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import {
  installAudioInstrumentation,
  lastAudioTime,
  recordedRates,
  recordedSeeks,
} from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_MALFORMED_EPUB, AUDIOBOOK_MO_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';

/**
 * Phase 2 contract: transport completeness. Fixture timeline: three chapters
 * of 12s + 12s + 6s (30s total); chapter 2 is split across two audio files.
 */

const activeSectionIndex = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as {
      mediaOverlay?: { activeSectionIndex: number };
    } | null;
    return view?.mediaOverlay?.activeSectionIndex ?? -1;
  });

async function startPlayback(page: Page, player: AudiobookPlayerPage): Promise<void> {
  await player.playButton.click();
  await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.05);
}

test.describe('audiobook transport', () => {
  test('speed slider changes the live playback rate and persists across reopen', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await startPlayback(page, player);
    await player.expandButton.click();
    await player.openSettings();
    await player.speedSlider.fill('1.5');
    await expect.poll(() => recordedRates(page)).toContain(1.5);

    await page.reload();
    await reader.waitForReady();
    await player.expandButton.click();
    await player.openSettings();
    await expect(player.speedSlider).toHaveValue('1.5');
    // The persisted rate is applied when playback starts again.
    await player.playButton.click();
    await expect.poll(() => recordedRates(page), { timeout: 10_000 }).toContain(1.5);
  });

  test('skip buttons seek by the configured intervals from the current position', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    // Configure short intervals first — the fixture is only 30s long.
    await player.expandButton.click();
    await player.openSettings();
    await player.skipForwardSelect.selectOption('10');
    await player.skipBackSelect.selectOption('10');

    await startPlayback(page, player);
    const before = await lastAudioTime(page);

    await player.skipForwardButton.click();
    // Chapter 1 is one audio file, so the seek target is file-local: before+10.
    await expect
      .poll(async () => {
        const seeks = await recordedSeeks(page);
        return seeks.some((s) => Math.abs(s - (before + 10)) < 1.2);
      })
      .toBe(true);

    await player.skipBackButton.click();
    await expect
      .poll(async () => {
        const seeks = await recordedSeeks(page);
        return seeks.some((s) => Math.abs(s - before) < 1.5);
      })
      .toBe(true);
  });

  test('next chapter advances a section; previous restarts mid-chapter and jumps back at a chapter start', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await startPlayback(page, player);
    await player.expandButton.click();

    await player.nextChapterButton.click();
    await expect.poll(() => activeSectionIndex(page)).toBe(1);

    // Let chapter 2 play past the restart threshold, then Previous restarts it.
    await expect.poll(() => lastAudioTime(page), { timeout: 15_000 }).toBeGreaterThan(3.2);
    await player.prevChapterButton.click();
    await expect.poll(() => lastAudioTime(page)).toBeLessThan(3.2);
    expect(await activeSectionIndex(page)).toBe(1);

    // Immediately at the chapter start, Previous goes to the prior chapter.
    await player.prevChapterButton.click();
    await expect.poll(() => activeSectionIndex(page)).toBe(0);
  });

  test('the ebook TOC drives the audio chapter while listening', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await startPlayback(page, player);
    // PRD §5.5: chapter navigation reuses the existing ebook TOC — a chapter
    // jump moves the audio with it.
    await reader.openTocChapter(2);
    await expect.poll(() => activeSectionIndex(page), { timeout: 10_000 }).toBe(2);

    // Playback carries on in the new chapter without pausing.
    await expect(player.pauseButton).toBeVisible();
    const t = await lastAudioTime(page);
    await expect.poll(() => lastAudioTime(page), { timeout: 5_000 }).toBeGreaterThan(t);
  });

  test('the player chapters control opens the ebook TOC', async ({ page, openBook }) => {
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.expandButton.click();
    await expect(player.fullPlayer).toBeVisible();
    await page.getByRole('button', { name: 'Chapters', exact: true }).click();

    // One chapter navigation, not two: the fullscreen player drops to the
    // tray and the existing TOC sidebar takes over.
    await expect(player.playerScreen).toHaveCount(0);
    await expect(player.miniBar).toBeVisible();
    await expect(reader.tocItems.first()).toBeVisible();
  });

  test('chapter scrubber commits within the chapter and time labels stay truthful', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await startPlayback(page, player);
    await player.expandButton.click();

    // PRD §5.1: the scrubber is chapter-scoped — 6 lands 6s into chapter 1
    // (a 12s single-file chapter), not 6s into the book timeline.
    await player.scrubber.fill('6');
    await expect
      .poll(async () => {
        const seeks = await recordedSeeks(page);
        return seeks.some((s) => Math.abs(s - 6) < 1.2);
      })
      .toBe(true);
    expect(await activeSectionIndex(page)).toBe(0);
    await expect(player.elapsedLabel).toContainText(/0:0[6-9]/);
    // The line above the scrubber shows whole-book time left, humanized.
    await expect(player.timeLeftLabel).toContainText(/\d+s left/);

    // Chapter remaining is live, negative-styled, and decreasing.
    const remaining = async () => {
      const text = (await player.remainingLabel.textContent()) ?? '';
      const match = text.match(/-(\d+):(\d{2})/);
      return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
    };
    const first = await remaining();
    expect(Number.isNaN(first)).toBe(false);
    expect(first).toBeLessThanOrEqual(6);
    await expect.poll(remaining, { timeout: 4_000 }).toBeLessThan(first);
  });

  test('running past the last chapter lands in a calm ended state and can restart', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await startPlayback(page, player);
    await player.expandButton.click();
    // Jump to the last chapter, then scrub near its end (chapter 3 is 6s).
    await player.nextChapterButton.click();
    await expect.poll(() => activeSectionIndex(page), { timeout: 10_000 }).toBe(1);
    await player.nextChapterButton.click();
    await expect.poll(() => activeSectionIndex(page), { timeout: 10_000 }).toBe(2);
    await player.scrubber.fill('5');

    // ~1s later the book ends: the player returns to a Play affordance.
    await expect(player.playButton).toBeVisible({ timeout: 15_000 });
    await expect(player.fullPlayer).toContainText('Finished');

    // Restarting plays chapter 1 from the top.
    await player.playButton.click();
    await expect.poll(() => activeSectionIndex(page), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => lastAudioTime(page)).toBeGreaterThan(0.05);
  });

  test('a chapter with missing audio surfaces an error toast and keeps the UI responsive', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MALFORMED_EPUB);
    const player = new AudiobookPlayerPage(page);

    // Chapter 1 is intact and plays.
    await startPlayback(page, player);

    // Jump into chapter 2, whose audio file is missing from the package.
    await player.expandButton.click();
    await player.nextChapterButton.click();

    await expect(page.locator('.toast')).toContainText('audio', { ignoreCase: true });
    // The player did not wedge: play/pause is still operable.
    await expect(player.playButton).toBeVisible();
    await player.playButton.click();
  });
});
