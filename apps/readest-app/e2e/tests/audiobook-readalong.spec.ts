import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import {
  installAudioInstrumentation,
  lastAudioTime,
  recordedSeeks,
} from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_MO_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';

/**
 * Phase 3 contract: the read-along experience. Highlighting follows the
 * audio without fighting the reader, taps seek the audio, and the highlight
 * is configurable. Fixture: chapters 1–2 are sentence-level (1.5s clips),
 * chapter 3 is word-level (0.5s clips).
 */

const activeSectionIndex = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as {
      mediaOverlay?: { activeSectionIndex: number };
    } | null;
    return view?.mediaOverlay?.activeSectionIndex ?? -1;
  });

/** Spine index of the section the reader is currently displaying. */
const readerSectionIndex = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as {
      renderer?: { primaryIndex?: number };
    } | null;
    return view?.renderer?.primaryIndex ?? -1;
  });

async function startPlayback(page: Page, player: AudiobookPlayerPage): Promise<void> {
  await player.playButton.click();
  await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.05);
}

test.describe('audiobook read-along', () => {
  test('the highlight advances across sentences and stays visible', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);

    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('Sentence one of chapter 1');
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('Sentence two of chapter 1');
    expect(await reader.mediaOverlayHighlightVisible()).toBe(true);
  });

  test('the page follows playback across a section boundary', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await player.expandButton.click();

    // Jump near the end of chapter 1 and let playback roll over.
    await player.scrubber.fill('11');
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 15_000 })
      .toContain('Sentence one of chapter 2');
    // The reader followed: the chapter-2 highlight is on-screen.
    await expect.poll(() => reader.mediaOverlayHighlightVisible(), { timeout: 5_000 }).toBe(true);
  });

  test('tapping a later sentence seeks the audio to it', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('Sentence one of chapter 1');

    // Sentence 4's clip spans 4.5–6.0s in c1.wav.
    await reader.clickInBookText('#s4');
    await expect
      .poll(
        async () => {
          const seeks = await recordedSeeks(page);
          return seeks.some((s) => Math.abs(s - 4.5) < 0.3);
        },
        { timeout: 5_000 },
      )
      .toBe(true);
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('Sentence four of chapter 1');
  });

  test('highlight color and style settings restyle the live highlight', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('chapter 1');

    await player.expandButton.click();
    await player.openSettings();

    // Green preset (#4ade80) shows up in the computed background.
    await player.highlightColorSwatch('Green').click();
    await expect
      .poll(() => reader.mediaOverlayHighlightComputed('backgroundColor'), { timeout: 5_000 })
      .toContain('74, 222, 128');

    // Underline style drops the background fill and underlines instead.
    await player.highlightStyleSelect.selectOption('underline');
    await expect
      .poll(() => reader.mediaOverlayHighlightComputed('textDecorationLine'), { timeout: 5_000 })
      .toContain('underline');
    await expect
      .poll(() => reader.mediaOverlayHighlightComputed('backgroundColor'), { timeout: 5_000 })
      .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });

  test('read-along toggle silences highlighting while audio keeps playing', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('chapter 1');

    await player.expandButton.click();
    await player.openSettings();
    await player.readAlongToggle.uncheck();

    // Highlight disappears while the audio clock keeps advancing.
    await expect.poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 }).toBe('');
    const before = await lastAudioTime(page);
    await expect.poll(() => lastAudioTime(page), { timeout: 5_000 }).toBeGreaterThan(before + 0.3);

    await player.readAlongToggle.check();
    await expect.poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 }).not.toBe('');
  });

  test('the word-level chapter highlights individual words', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await player.expandButton.click();
    await player.openChapters();
    await player.chapterItem('Chapter 3').click();
    await expect.poll(() => activeSectionIndex(page)).toBe(2);

    // A single word (no spaces) is highlighted at word granularity.
    await expect
      .poll(
        async () => {
          const text = (await reader.mediaOverlayHighlightText()).trim();
          return text.length > 0 && !text.includes(' ') ? text : '';
        },
        { timeout: 10_000 },
      )
      .not.toBe('');
  });

  test('paging away suspends follow; the return control resumes it', async ({ page, openBook }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('chapter 1');

    // Reader navigates away (user intent) while chapter 1 keeps playing.
    await reader.openSidebar();
    await reader.openTocChapter(2);

    await expect(player.returnToPlayingButton).toBeVisible({ timeout: 5_000 });
    expect(await readerSectionIndex(page)).not.toBe(await activeSectionIndex(page));
    // Two highlight cycles pass without the reader being yanked back to the
    // playing section. (Absolute parking stability is upstream reader
    // behaviour — readest/foliate-js has a nav-drift fix newer than our
    // pinned base — so only the audiobook guarantee is asserted here.)
    await page.waitForTimeout(3_200);
    expect(await readerSectionIndex(page)).not.toBe(await activeSectionIndex(page));
    // Audio never stopped.
    const before = await lastAudioTime(page);
    await expect.poll(() => lastAudioTime(page), { timeout: 5_000 }).toBeGreaterThan(before + 0.3);

    await player.returnToPlayingButton.click();
    await expect
      .poll(async () => readerSectionIndex(page), { timeout: 8_000 })
      .toBe(await activeSectionIndex(page));
    await expect.poll(() => reader.mediaOverlayHighlightVisible(), { timeout: 8_000 }).toBe(true);
    await expect(player.returnToPlayingButton).not.toBeVisible();
  });
});
