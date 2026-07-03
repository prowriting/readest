import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import {
  installAudioInstrumentation,
  lastAudioTime,
  recordedSeeks,
  recordedVolumes,
} from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_MO_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';

/**
 * Phase 4 contract: sleep timer and audio bookmarks. Duration timers run on
 * the (fake) page clock; the end-of-chapter timer reacts to the real audio
 * rolling over a section boundary. Fixture: 12s + 12s + 6s chapters with
 * 1.5s sentence clips.
 */

const activeSectionIndex = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as {
      mediaOverlay?: { activeSectionIndex: number };
    } | null;
    return view?.mediaOverlay?.activeSectionIndex ?? -1;
  });

const sectionOffset = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as {
      mediaOverlay?: { sectionOffset: number };
    } | null;
    return view?.mediaOverlay?.sectionOffset ?? -1;
  });

async function startPlayback(page: Page, player: AudiobookPlayerPage): Promise<void> {
  await player.playButton.click();
  await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.05);
}

test.describe('audiobook sleep timer', () => {
  test('a duration timer counts down, fades the volume, and pauses playback', async ({
    page,
    openBook,
  }) => {
    await page.clock.install();
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await player.expandButton.click();
    await player.openSettings();

    await player.sleepTimerSelect.selectOption('15');
    await expect(player.sleepTimerRemaining).toContainText('15:00');

    // Just before expiry the countdown is nearly done and the fade began.
    await page.clock.fastForward('14:55');
    await expect(player.sleepTimerRemaining).toContainText('0:0');
    await expect
      .poll(async () => (await recordedVolumes(page)).some((v) => v > 0 && v < 0.9))
      .toBe(true);

    // Past expiry: paused, and the volume is restored for the next session.
    await page.clock.fastForward('00:10');
    await expect(player.playButton).toBeVisible({ timeout: 5_000 });
    await expect.poll(async () => (await recordedVolumes(page)).at(-1)).toBe(1);
    await expect(player.sleepTimerRemaining).not.toBeVisible();
  });

  test('extend adds time and cancelling keeps playback running', async ({ page, openBook }) => {
    await page.clock.install();
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await player.expandButton.click();
    await player.openSettings();

    await player.sleepTimerSelect.selectOption('5');
    await player.extendSleepTimerButton.click();
    await expect(player.sleepTimerRemaining).toContainText('20:00');

    await player.sleepTimerSelect.selectOption('off');
    await expect(player.sleepTimerRemaining).not.toBeVisible();
    await page.clock.fastForward('21:00');
    // Still playing: no timer fired.
    await expect(player.pauseButton).toBeVisible();
  });

  test('the end-of-chapter timer stops right at the section boundary', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await player.expandButton.click();

    // Park a few seconds before the end of chapter 1 (12s) — comfortably
    // outside the manual-navigation grace window — and arm end-of-chapter.
    await player.scrubber.fill('9');
    await player.openSettings();
    await player.sleepTimerSelect.selectOption('end-of-chapter');

    // The rollover into chapter 2 pauses playback within its first moments.
    await expect(player.playButton).toBeVisible({ timeout: 15_000 });
    expect(await activeSectionIndex(page)).toBe(1);
    expect(await sectionOffset(page)).toBeLessThan(1);

    const frozen = await lastAudioTime(page);
    await page.waitForTimeout(700);
    expect(await lastAudioTime(page)).toBeCloseTo(frozen, 1);
  });
});

test.describe('audiobook bookmarks', () => {
  test('bookmark the playing sentence, jump back to it, and it survives a reload', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('Sentence one of chapter 1');

    // Move to sentence 3 (clip 3.0–4.5s) and bookmark it.
    await reader.clickInBookText('#s3');
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('Sentence three of chapter 1');
    await player.expandButton.click();
    await player.addBookmarkButton.click();
    await player.openBookmarks();
    await expect(player.bookmarkItems).toHaveCount(1);
    await expect(player.bookmarkItems.first()).toContainText('Sentence three');
    await expect(player.bookmarkItems.first()).toContainText('0:03');

    // Listen onwards, then jump back via the bookmark.
    await player.skipForwardButton.click();
    await player.bookmarkItems.first().click();
    await expect
      .poll(
        async () => {
          const seeks = await recordedSeeks(page);
          return seeks.some((s) => Math.abs(s - 3.0) < 0.3);
        },
        { timeout: 5_000 },
      )
      .toBe(true);
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('Sentence three of chapter 1');

    // Bookmarks persist with the book config.
    await page.reload();
    await reader.waitForReady();
    await player.expandButton.click();
    await player.openBookmarks();
    await expect(player.bookmarkItems).toHaveCount(1);

    // And can be removed.
    await player.deleteBookmarkButton(0).click();
    await expect(player.bookmarkItems).toHaveCount(0);
  });

  test('the add control toggles for an already-bookmarked sentence', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('chapter 1');

    await player.expandButton.click();
    await player.addBookmarkButton.click();
    await expect(player.removeBookmarkButton).toBeVisible();
    await player.removeBookmarkButton.click();
    await expect(player.addBookmarkButton).toBeVisible();
    await player.openBookmarks();
    await expect(player.bookmarkItems).toHaveCount(0);
  });
});
