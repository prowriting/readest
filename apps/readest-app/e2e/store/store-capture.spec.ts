import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import { expect, test } from '../fixtures/base';
import { installAudioInstrumentation, lastAudioTime } from '../fixtures/audio-instrumentation';
import { STORE_AUDIOBOOK_EPUB, STORE_EPUBS } from '../fixtures/store-books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';
import { BottomNav } from '../pages/BottomNav';
import { LibraryPage } from '../pages/LibraryPage';

/**
 * Play Store raw-capture lane (run via `pnpm store:capture`, config
 * `playwright.store.config.ts`). Each test drives the app to one listing
 * scene and saves a raw PNG per device project to
 * `scripts/store-assets/captures/<project>/`; the compositor
 * (`scripts/store-assets/compose-store-shots.mjs`) turns those into the
 * final fastlane images. These are captures, not assertions — expects exist
 * only to guarantee the scene is fully loaded before the screenshot.
 */

const capturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/store-assets/captures',
);

/** Freeze the UI (no blinking caret, transitions, or dev-tools badge) for a clean still. */
async function settle(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition: none !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
      }
      nextjs-portal { display: none !important; }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await settle(page);
  const dir = path.join(capturesDir, testInfo.project.name);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage: false });
}

/**
 * Front-matter text that must not appear in a store screenshot — Standard
 * Ebooks imprint/colophon pages are paragraphs too, so length alone cannot
 * tell them apart from the actual book.
 */
const BOILERPLATE = /Standard Ebooks|Project Gutenberg|public domain|copyright|HathiTrust/i;

/** Whether a substantial (non-boilerplate) prose paragraph is visible in any book frame. */
async function proseVisible(page: Page): Promise<boolean> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const frame of page.frames()) {
    const paragraphs = frame.locator('p');
    const count = await paragraphs.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 10); i += 1) {
      const p = paragraphs.nth(i);
      const text = (await p.textContent().catch(() => '')) ?? '';
      if (text.trim().length < 100 || BOILERPLATE.test(text)) continue;
      const box = await p.boundingBox().catch(() => null);
      // Intersection on both axes — prerendered neighbour pages sit at the
      // same y but outside the viewport horizontally.
      if (
        box &&
        box.width > 120 &&
        box.x < viewport.width &&
        box.x + box.width > 0 &&
        box.y < viewport.height &&
        box.y + box.height > 0
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Page forward from the cover until prose is on screen. */
async function advanceToProse(page: Page): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (await proseVisible(page)) return;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
  }
  throw new Error('never reached a prose page');
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('01 library shelf', async ({ page }, testInfo) => {
  const library = new LibraryPage(page);
  await library.goto();
  await library.importBook(STORE_EPUBS[0]!);
  await expect(library.bookCards()).toHaveCount(1);
  for (let i = 1; i < STORE_EPUBS.length; i += 1) {
    await library.importAnotherBook(STORE_EPUBS[i]!);
    await expect(library.bookCards()).toHaveCount(i + 1);
  }

  // Every cover image must be decoded before the shot.
  await expect
    .poll(
      () =>
        library.bookshelf
          .locator('img')
          .evaluateAll((imgs) =>
            imgs.every(
              (img) =>
                (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
            )
              ? imgs.length
              : -1,
          ),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(STORE_EPUBS.length);

  await expect(new BottomNav(page).bar).toBeVisible();
  // The "Successfully imported" toast auto-dismisses; wait it out.
  await expect(page.getByText(/Successfully imported/)).toBeHidden({ timeout: 15_000 });
  await shoot(page, testInfo, '01-library.png');
});

test('02 reading page', async ({ page, openBook }, testInfo) => {
  await openBook(STORE_EPUBS[0]!);
  await advanceToProse(page);
  await shoot(page, testInfo, '02-reader.png');
});

test('03 annotation popup', async ({ page, openBook }, testInfo) => {
  const reader = await openBook(STORE_EPUBS[2]!);
  // The TOC route selectText() takes is not reachable from the mobile
  // header, so page forward to prose and select in place.
  await advanceToProse(page);
  await reader.selectTextInVisibleSection();
  await expect(reader.annotationPopup).toBeVisible();
  // The concept chips (Useful / Love this / Thought / …) float with the
  // popup; wait for them so the store shot always shows the full toolbar.
  await expect(reader.conceptChips).toBeVisible();
  await expect(reader.conceptChips.getByRole('button', { name: 'Thought' })).toBeVisible();
  await shoot(page, testInfo, '03-annotation.png');
});

test('04 audiobook read-along', async ({ page, openBook }, testInfo) => {
  await installAudioInstrumentation(page);
  const reader = await openBook(STORE_AUDIOBOOK_EPUB);
  const player = new AudiobookPlayerPage(page);
  await player.playButton.click();
  await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.05);
  await expect
    .poll(() => reader.mediaOverlayHighlightText(), { timeout: 10_000 })
    .toContain('Alice was beginning');
  await player.pauseButton.click();
  // The highlight must survive the pause so the still shows read-along.
  await expect.poll(() => reader.mediaOverlayHighlightText()).toContain('Alice was beginning');
  await shoot(page, testInfo, '04-audiobook.png');
});

test('05 discover feed', async ({ page }, testInfo) => {
  // Relative URLs bypass the OPDS cover proxy (`needsProxy` only rewrites
  // http(s) URLs), so the route below can intercept them directly.
  const coverHost = '/store-covers';
  const titles: Array<{ file: string; title: string; author: string }> = [
    { file: STORE_EPUBS[0]!, title: 'Pride and Prejudice', author: 'Jane Austen' },
    {
      file: STORE_EPUBS[1]!,
      title: 'The Adventures of Sherlock Holmes',
      author: 'Arthur Conan Doyle',
    },
    { file: STORE_EPUBS[2]!, title: 'Frankenstein', author: 'Mary Shelley' },
    { file: STORE_EPUBS[3]!, title: 'Dracula', author: 'Bram Stoker' },
    { file: STORE_EPUBS[4]!, title: 'Moby Dick', author: 'Herman Melville' },
  ];

  // Serve each book's real cover (extracted from the EPUB) for the mocked feed.
  const covers = new Map<string, Buffer>();
  titles.forEach(({ file }, i) => {
    const zip = unzipSync(new Uint8Array(readFileSync(file)));
    const entry = Object.keys(zip).find((k) => /cover\.(jpe?g|png)$/i.test(k));
    if (!entry) throw new Error(`no cover image inside ${file}`);
    covers.set(`${coverHost}/${i}.jpg`, Buffer.from(zip[entry]!));
  });
  await page.route(`**${coverHost}/**`, (route) => {
    const body = covers.get(new URL(route.request().url()).pathname);
    if (!body) return route.fulfill({ status: 404 });
    return route.fulfill({ body, contentType: 'image/jpeg' });
  });

  const bookEntry = (i: number) => ({
    id: `store:${i}`,
    title: titles[i]!.title,
    authors: [titles[i]!.author],
    cover_url: `${coverHost}/${i}.jpg`,
    is_free: true,
  });
  const feed = {
    version: 1,
    generated_at: '2026-07-01T00:00:00Z',
    etag: 'store-shots',
    rows: [
      {
        id: 'popular_classics',
        kind: 'popular_classics',
        title: 'Popular Classics',
        query: { sort: 'popular' },
        books: [0, 1, 2, 3, 4].map(bookEntry),
      },
      {
        id: 'popular_in_fiction',
        kind: 'popular_in_category',
        title: 'Popular in Fiction',
        category: { id: 'fiction', name: 'Fiction' },
        query: { topic: 'Fiction', sort: 'popular' },
        books: [3, 0, 4, 1, 2].map(bookEntry),
      },
    ],
  };
  await page.route('**/v1/discover/feed', (route) => route.fulfill({ json: feed }));

  await page.goto('/discover');
  await expect(page.locator('.discover-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Popular Classics' })).toBeVisible();
  // Covers are loading='lazy', so only the on-screen ones ever decode —
  // require enough of them for the first row to look fully populated.
  await expect
    .poll(
      () =>
        page
          .locator('.discover-page img')
          .evaluateAll(
            (imgs) =>
              imgs.filter(
                (img) =>
                  (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
              ).length,
          ),
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(4);
  await shoot(page, testInfo, '05-discover.png');
});

test('06 font and layout settings', async ({ page, openBook }, testInfo) => {
  const reader = await openBook(STORE_EPUBS[0]!);
  await advanceToProse(page);
  await reader.revealHeader();
  await page.getByRole('button', { name: 'Font & Layout' }).first().click();
  await page.locator('[data-tab="Font"]').click();
  await expect(page.locator('[data-setting-id="settings.font.defaultFontSize"]')).toBeVisible();
  await shoot(page, testInfo, '06-settings.png');
});
