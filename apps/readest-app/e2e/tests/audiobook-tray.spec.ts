import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import {
  installAudioInstrumentation,
  lastAudioTime,
  recordedRates,
} from '../fixtures/audio-instrumentation';
import { AUDIOBOOK_MO_EPUB, SAMPLE_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';

/**
 * PRD v2 §5.2/§5.3 contract: text+audio books open in the combined view —
 * reader page plus a docked audio tray. The tray collapses (toolbar audio
 * button or swipe-down on its handle) without stopping playback, re-opens
 * from the toolbar, and expands (chevron or swipe-up) into a fullscreen
 * player with cover art whose minimize control drops back to the tray.
 * The footer-bar TTS button is replaced by the audio toggle for audio books.
 */

/** Drag the tray handle vertically by `dy` pixels (negative = up). */
async function dragHandle(page: Page, player: AudiobookPlayerPage, dy: number): Promise<void> {
  const box = await player.trayHandle.boundingBox();
  if (!box) throw new Error('tray handle not visible');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe('audiobook tray & toolbar (combined view)', () => {
  test('a text+audio book opens in the combined view with the tray docked', async ({
    openBook,
  }) => {
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(reader.page);

    await expect(player.miniBar).toBeVisible();
    await expect(player.fullPlayer).not.toBeVisible();
    await expect(player.playerScreen).toHaveCount(0);

    // v2 tray anatomy: remaining time, speed chip, skip, play, expand chevron.
    await expect(player.miniBar).toContainText('left');
    await expect(player.traySpeedButton).toContainText('1×');
    await expect(player.miniBar.getByRole('button', { name: 'Skip Forward' })).toBeVisible();
    await expect(player.expandButton).toBeVisible();
  });

  test('the footer bar swaps the TTS button for an audiobook toggle', async ({ openBook }) => {
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(reader.page);

    await reader.revealFooter();
    await expect(player.toolbarAudiobookButton).toBeVisible();
    await expect(player.toolbarAudiobookButton).toHaveAttribute('aria-pressed', 'true');
    await expect(
      reader.page.locator('.footer-bar').getByRole('button', { name: 'Speak', exact: true }),
    ).toHaveCount(0);
  });

  test('a book without audio keeps the TTS Speak button', async ({ openBook }) => {
    const reader = await openBook(SAMPLE_EPUB);
    const player = new AudiobookPlayerPage(reader.page);

    await reader.revealFooter();
    await expect(player.toolbarSpeakButton).toBeVisible();
    await expect(
      reader.page.locator('.footer-bar').getByRole('button', { name: 'Audiobook', exact: true }),
    ).toHaveCount(0);
    await expect(player.miniBar).toHaveCount(0);
  });

  test('collapsing the tray keeps audio playing and the toolbar re-opens it', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.3);

    await reader.revealFooter();
    await player.toolbarAudiobookButton.click();
    await expect(player.miniBar).not.toBeVisible();

    // Audio continues while the tray is collapsed (v2 §5.3).
    const t1 = await lastAudioTime(page);
    await expect.poll(() => lastAudioTime(page), { timeout: 5_000 }).toBeGreaterThan(t1);

    // The toolbar button reflects state: not pressed, but playing.
    await reader.revealFooter();
    await expect(player.toolbarAudiobookButton).toHaveAttribute('aria-pressed', 'false');
    await expect(player.toolbarAudiobookButton).toHaveAttribute('data-playing', 'true');

    // Re-opening restores the tray without resetting playback or position.
    const t2 = await lastAudioTime(page);
    await player.toolbarAudiobookButton.click();
    await expect(player.miniBar).toBeVisible();
    await expect(player.pauseButton).toBeVisible();
    expect(await lastAudioTime(page)).toBeGreaterThanOrEqual(t2 - 0.2);
  });

  test('dragging the handle down dismisses the tray; dragging up opens the fullscreen player', async ({
    page,
    openBook,
  }) => {
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await dragHandle(page, player, 90);
    await expect(player.miniBar).not.toBeVisible();

    await reader.revealFooter();
    await player.toolbarAudiobookButton.click();
    await expect(player.miniBar).toBeVisible();

    await dragHandle(page, player, -90);
    await expect(player.playerScreen).toBeVisible();
    await expect(player.fullPlayer).toBeVisible();
  });

  test('the close button dismisses the tray without stopping audio; the toolbar re-opens it', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    const reader = await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.3);

    await expect(player.closeButton).toBeVisible();
    await player.closeButton.click();
    await expect(player.miniBar).not.toBeVisible();

    // Audio keeps playing while the tray is dismissed (v2 §5.3).
    const t = await lastAudioTime(page);
    await expect.poll(() => lastAudioTime(page), { timeout: 5_000 }).toBeGreaterThan(t);

    // The footer toggle brings the tray back, still playing.
    await reader.revealFooter();
    await player.toolbarAudiobookButton.click();
    await expect(player.miniBar).toBeVisible();
    await expect(player.pauseButton).toBeVisible();
  });

  test('the chevron expands a fullscreen player with cover art; minimize drops back to the tray', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.2);

    await player.expandButton.click();
    await expect(player.playerScreen).toBeVisible();
    await expect(player.coverArt).toBeVisible();
    await expect(player.scrubber).toBeVisible();

    // Playback survives the expand…
    const t1 = await lastAudioTime(page);
    await expect.poll(() => lastAudioTime(page), { timeout: 5_000 }).toBeGreaterThan(t1);

    await player.minimizeButton.click();
    await expect(player.playerScreen).toHaveCount(0);
    await expect(player.miniBar).toBeVisible();

    // …and the minimize.
    const t2 = await lastAudioTime(page);
    await expect.poll(() => lastAudioTime(page), { timeout: 5_000 }).toBeGreaterThan(t2);
  });

  test('the tray speed chip cycles presets and applies the playback rate', async ({
    page,
    openBook,
  }) => {
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await player.playButton.click();
    await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.05);

    await player.traySpeedButton.click();
    await expect(player.traySpeedButton).toContainText('1.25×');
    await expect.poll(() => recordedRates(page), { timeout: 5_000 }).toContain(1.25);
  });
});
