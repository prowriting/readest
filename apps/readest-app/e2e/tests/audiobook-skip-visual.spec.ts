import { expect, test } from '../fixtures/base';
import { installAudioInstrumentation, lastAudioTime } from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_LONG_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';

/**
 * Visual contract for the 30-second skip: everything here is asserted on
 * what the screen shows — the elapsed clock, the scrubber, the chapter
 * title, the read-along highlight, the tray's remaining time — not on
 * engine internals. Fixture: mo-long.epub (80s): chapter 1 is a single
 * 40s audio file so a default +30 stays within one file (the long-chapter
 * shape of real audiobooks); chapters 2/3 are 20s each.
 */

/** Parse the leading clock out of a label like '0:32', '-0:28' or '1:00 left'. */
const clockToSeconds = (text: string): number => {
  const clock = text.match(/\d+(?::\d{2})+/)?.[0];
  if (!clock) return Number.NaN;
  return clock.split(':').reduce((total, part) => total * 60 + Number(part), 0);
};

const visibleElapsed = async (player: AudiobookPlayerPage): Promise<number> =>
  clockToSeconds(await player.elapsedLabel.innerText());

test.describe('skip forward 30s — what the user sees', () => {
  test('advances the elapsed clock and scrubber by 30 seconds while playing', async ({
    page,
    openBook,
  }) => {
    await openBook(AUDIOBOOK_LONG_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await player.expandButton.click();
    await expect(player.fullPlayer).toBeVisible();
    await expect.poll(() => visibleElapsed(player), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

    const before = await visibleElapsed(player);
    await player.skipForwardButton.click();

    await expect
      .poll(() => visibleElapsed(player), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(before + 29);
    expect(await visibleElapsed(player)).toBeLessThanOrEqual(before + 35);
    expect(Number(await player.scrubber.inputValue())).toBeGreaterThanOrEqual(before + 29);
  });

  test('updates the displayed position while paused, without resuming playback', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_LONG_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await player.expandButton.click();
    await expect.poll(() => visibleElapsed(player), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await player.pauseButton.click();
    await expect(player.playButton).toBeVisible();

    const before = await visibleElapsed(player);
    await player.skipForwardButton.click();

    // The clock must reflect the skip even though nothing is playing…
    await expect
      .poll(() => visibleElapsed(player), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(before + 29);
    expect(await visibleElapsed(player)).toBeLessThanOrEqual(before + 31);

    // …and playback must stay paused.
    await expect(player.playButton).toBeVisible();
    const audioTime = await lastAudioTime(page);
    await page.waitForTimeout(700);
    expect(await lastAudioTime(page)).toBeCloseTo(audioTime, 1);
  });

  test('crossing chapter boundaries shows the right chapter title', async ({ page, openBook }) => {
    await openBook(AUDIOBOOK_LONG_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await player.expandButton.click();
    await expect(player.fullPlayer).toContainText('Chapter 1');

    // Late in chapter 1 (0–40s): 18s + 30s = 48s, which is 8s into Chapter 2.
    await player.scrubber.fill('18');
    await expect.poll(() => visibleElapsed(player), { timeout: 5_000 }).toBeGreaterThanOrEqual(17);
    await player.skipForwardButton.click();

    await expect.poll(() => visibleElapsed(player), { timeout: 5_000 }).toBeGreaterThanOrEqual(47);
    await expect(player.fullPlayer).toContainText('Chapter 2');
  });

  test('skipping past the end lands in the finished state', async ({ page, openBook }) => {
    await openBook(AUDIOBOOK_LONG_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await player.expandButton.click();
    await player.scrubber.fill('70');
    await expect.poll(() => visibleElapsed(player), { timeout: 5_000 }).toBeGreaterThanOrEqual(69);

    await player.skipForwardButton.click(); // 70 + 30 = 100 > 80 → book finished
    await expect(player.fullPlayer).toContainText('Finished');
    await expect(player.playButton).toBeVisible();
  });

  test('skipping highlights the new sentence and clears the old one', async ({
    page,
    openBook,
  }) => {
    const reader = await openBook(AUDIOBOOK_LONG_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 10_000 })
      .toContain('Sentence one of chapter 1');

    // +30 within chapter 1's single 40s audio file: the highlight must MOVE,
    // not accumulate — regression: each in-file skip left the previous
    // sentence painted, littering the page with stale highlights.
    await player.miniBar.getByRole('button', { name: 'Skip Forward' }).click();
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toMatch(/Sentence (thirteen|fourteen) of chapter 1/);
    expect(await reader.mediaOverlayHighlightCount()).toBe(1);

    // A second skip crosses chapters (~62s lands in chapter 3, 60–80s) —
    // still exactly one highlight.
    await player.miniBar.getByRole('button', { name: 'Skip Forward' }).click();
    await expect
      .poll(() => reader.mediaOverlayHighlightText(), { timeout: 5_000 })
      .toContain('chapter 3');
    expect(await reader.mediaOverlayHighlightCount()).toBe(1);
  });

  test('the tray remaining time drops by 30 seconds', async ({ page, openBook }) => {
    await openBook(AUDIOBOOK_LONG_EPUB);
    const player = new AudiobookPlayerPage(page);
    const remaining = async () =>
      clockToSeconds(await player.miniBar.getByText(/left/).innerText());

    await player.playButton.click();
    await expect.poll(remaining, { timeout: 10_000 }).toBeLessThanOrEqual(79); // ticking

    const before = await remaining();
    await player.miniBar.getByRole('button', { name: 'Skip Forward' }).click();

    await expect.poll(remaining, { timeout: 5_000 }).toBeLessThanOrEqual(before - 28);
    expect(await remaining()).toBeGreaterThanOrEqual(before - 35);
  });
});
