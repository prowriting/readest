import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import {
  installAudioInstrumentation,
  lastAudioTime,
  recordedSeeks,
} from '../fixtures/audio-instrumentation';
import {
  installMediaSessionInstrumentation,
  invokeMediaSessionAction,
  mediaSessionMetadata,
  mediaSessionPlaybackState,
  mediaSessionPositions,
} from '../fixtures/media-session-instrumentation';
import { AUDIOBOOK_MO_EPUB } from '../fixtures/books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';

/**
 * Phase 7 contract (web side): the audiobook advertises itself through the
 * Media Session API — metadata, playback state, whole-book position state —
 * and the registered action handlers (what lock screens and headphones
 * trigger) actually drive playback. Fixture: 12+12+6s chapters.
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

test.describe('audiobook media session', () => {
  test('metadata and playback state mirror the player', async ({ page, openBook }) => {
    await installMediaSessionInstrumentation(page);
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);

    await startPlayback(page, player);
    await expect.poll(() => mediaSessionPlaybackState(page), { timeout: 5_000 }).toBe('playing');
    const metadata = await mediaSessionMetadata(page);
    expect(metadata?.title).toContain('MO Sentences');
    expect(metadata?.artist).toContain('Bookarc E2E');
    await expect
      .poll(async () => (await mediaSessionMetadata(page))?.album ?? '', { timeout: 5_000 })
      .toContain('Chapter 1');

    await player.pauseButton.click();
    await expect.poll(() => mediaSessionPlaybackState(page), { timeout: 5_000 }).toBe('paused');
  });

  test('position state advertises the current chapter timeline', async ({ page, openBook }) => {
    await installMediaSessionInstrumentation(page);
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);

    // Chapter-scoped, matching the in-app player (PRD §5.1): chapter 1 of the
    // fixture is 12s.
    await expect
      .poll(
        async () => {
          const positions = await mediaSessionPositions(page);
          const last = positions.at(-1);
          return last && last.duration === 12 && (last.position ?? 0) > 0.2
            ? last.playbackRate
            : null;
        },
        { timeout: 10_000 },
      )
      .toBe(1);

    // The advertised position keeps advancing with playback.
    const count = (await mediaSessionPositions(page)).length;
    await expect
      .poll(async () => (await mediaSessionPositions(page)).length, { timeout: 5_000 })
      .toBeGreaterThan(count);
  });

  test('lock-screen transport controls drive playback', async ({ page, openBook }) => {
    await installMediaSessionInstrumentation(page);
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);

    // Pause / play from the "lock screen".
    expect(await invokeMediaSessionAction(page, 'pause')).toBe(true);
    await expect(player.playButton).toBeVisible({ timeout: 5_000 });
    const frozen = await lastAudioTime(page);
    await page.waitForTimeout(600);
    expect(await lastAudioTime(page)).toBeCloseTo(frozen, 1);

    expect(await invokeMediaSessionAction(page, 'play')).toBe(true);
    await expect.poll(() => lastAudioTime(page), { timeout: 5_000 }).toBeGreaterThan(frozen + 0.2);

    // Seek by the offset the OS hands us.
    const before = await lastAudioTime(page);
    expect(await invokeMediaSessionAction(page, 'seekforward', { seekOffset: 5 })).toBe(true);
    await expect
      .poll(
        async () => {
          const seeks = await recordedSeeks(page);
          return seeks.some((s) => Math.abs(s - (before + 5)) < 1.2);
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    expect(await invokeMediaSessionAction(page, 'seekbackward', { seekOffset: 3 })).toBe(true);
    await expect
      .poll(
        async () => {
          const seeks = await recordedSeeks(page);
          return seeks.some((s) => Math.abs(s - (before + 2)) < 1.5);
        },
        { timeout: 5_000 },
      )
      .toBe(true);
  });

  test('seekto and track controls map to the chapter timeline and chapters', async ({
    page,
    openBook,
  }) => {
    await installMediaSessionInstrumentation(page);
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);

    // seekto is chapter-scoped: 8 lands 8s into chapter 1's single file.
    expect(await invokeMediaSessionAction(page, 'seekto', { seekTime: 8 })).toBe(true);
    await expect
      .poll(
        async () => {
          const seeks = await recordedSeeks(page);
          return seeks.some((s) => Math.abs(s - 8) < 1.2);
        },
        { timeout: 5_000 },
      )
      .toBe(true);
    expect(await activeSectionIndex(page)).toBe(0);

    expect(await invokeMediaSessionAction(page, 'nexttrack')).toBe(true);
    await expect.poll(() => activeSectionIndex(page), { timeout: 5_000 }).toBe(1);

    // At a fresh chapter start, previous jumps to the prior chapter.
    expect(await invokeMediaSessionAction(page, 'previoustrack')).toBe(true);
    await expect.poll(() => activeSectionIndex(page), { timeout: 5_000 }).toBe(0);
  });

  test('finishing the book releases the session', async ({ page, openBook }) => {
    await installMediaSessionInstrumentation(page);
    await installAudioInstrumentation(page);
    await openBook(AUDIOBOOK_MO_EPUB);
    const player = new AudiobookPlayerPage(page);
    await startPlayback(page, player);
    expect(await invokeMediaSessionAction(page, 'pause')).toBe(true);
    await expect(player.playButton).toBeVisible({ timeout: 5_000 });
    expect(await invokeMediaSessionAction(page, 'play')).toBe(true);

    // Run off the end of the book: the session must fully let go so stale
    // lock-screen buttons cannot poke a finished player. The scrubber is
    // chapter-scoped, so reach the end via the last chapter (6s long).
    await player.expandButton.click();
    await player.nextChapterButton.click();
    await expect.poll(() => activeSectionIndex(page), { timeout: 10_000 }).toBe(1);
    await player.nextChapterButton.click();
    await expect.poll(() => activeSectionIndex(page), { timeout: 10_000 }).toBe(2);
    await player.scrubber.fill('5');
    await expect(player.fullPlayer).toContainText('Finished', { timeout: 15_000 });
    await expect.poll(() => invokeMediaSessionAction(page, 'play'), { timeout: 5_000 }).toBe(false);
    await expect.poll(() => mediaSessionPlaybackState(page), { timeout: 5_000 }).toBe('none');
  });
});

test('the system audio-route picker is only offered where the platform provides one', async ({
  page,
  openBook,
}) => {
  await openBook(AUDIOBOOK_MO_EPUB);
  const player = new AudiobookPlayerPage(page);
  await player.expandButton.click();
  await expect(player.fullPlayer).toBeVisible();
  // Web builds route audio via the OS; the AVRoutePickerView button is an
  // iOS-app affordance and must not render here.
  await expect(page.getByRole('button', { name: 'Audio Output', exact: true })).toHaveCount(0);
});
