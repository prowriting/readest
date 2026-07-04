import { expect, test } from '../fixtures/base';
import { installAudioInstrumentation, lastAudioTime } from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_LONG_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';

/**
 * Visual contract for the 30-second skip: everything here is asserted on
 * what the screen shows — the elapsed clock, the scrubber, the chapter
 * title, the tray's remaining time — not on engine internals. Fixture:
 * mo-long.epub, 3×20s chapters (60s), so a default +30s lands mid-book.
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

    // Late in chapter 1: 18s + 30s = 48s, which is 8s into Chapter 3.
    await player.scrubber.fill('18');
    await expect.poll(() => visibleElapsed(player), { timeout: 5_000 }).toBeGreaterThanOrEqual(17);
    await player.skipForwardButton.click();

    await expect.poll(() => visibleElapsed(player), { timeout: 5_000 }).toBeGreaterThanOrEqual(47);
    await expect(player.fullPlayer).toContainText('Chapter 3');
  });

  test('skipping past the end lands in the finished state', async ({ page, openBook }) => {
    await openBook(AUDIOBOOK_LONG_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await player.expandButton.click();
    await player.scrubber.fill('50');
    await expect.poll(() => visibleElapsed(player), { timeout: 5_000 }).toBeGreaterThanOrEqual(49);

    await player.skipForwardButton.click(); // 50 + 30 = 80 > 60 → book finished
    await expect(player.fullPlayer).toContainText('Finished');
    await expect(player.playButton).toBeVisible();
  });

  test('the tray remaining time drops by 30 seconds', async ({ page, openBook }) => {
    await openBook(AUDIOBOOK_LONG_EPUB);
    const player = new AudiobookPlayerPage(page);
    const remaining = async () =>
      clockToSeconds(await player.miniBar.getByText(/left/).innerText());

    await player.playButton.click();
    await expect.poll(remaining, { timeout: 10_000 }).toBeLessThanOrEqual(59); // ticking

    const before = await remaining();
    await player.miniBar.getByRole('button', { name: 'Skip Forward' }).click();

    await expect.poll(remaining, { timeout: 5_000 }).toBeLessThanOrEqual(before - 28);
    expect(await remaining()).toBeGreaterThanOrEqual(before - 35);
  });
});
