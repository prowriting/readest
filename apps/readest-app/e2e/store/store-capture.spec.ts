import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import { expect, test } from '../fixtures/base';
import { installAudioInstrumentation, lastAudioTime } from '../fixtures/audio-instrumentation';
import { STORE_AUDIOBOOK_COVER, STORE_AUDIOBOOK_EPUB, STORE_EPUBS } from '../fixtures/store-books';
import { AudiobookPlayerPage } from '../pages/AudiobookPlayerPage';
import { BottomNav } from '../pages/BottomNav';
import { LibraryPage } from '../pages/LibraryPage';

/**
 * Play Store raw-capture lane (run via `pnpm store:capture`, config
 * `playwright.store.config.ts`). Each test drives the app to one listing
 * scene and saves a raw PNG per device project to
 * `scripts/store-assets/captures/<project>/`; the compositor
 * (`scripts/store-assets/compose-store-shots.mjs`) turns those into the
 * final fastlane images.
 *
 * The narrative follows the store description — books and audiobooks from
 * your favorite authors: claim a book, keep books and audiobooks together,
 * listen with read-along, read anywhere, discover free classics. These are
 * captures, not assertions — expects exist only to guarantee the scene is
 * fully loaded before the screenshot.
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

/** All visible <img> under a locator have decoded (or the given minimum have). */
function decodedCount(locator: ReturnType<Page['locator']>): Promise<number> {
  return locator.evaluateAll(
    (imgs) =>
      imgs.filter(
        (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
      ).length,
  );
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
  // The first section can still be rendering right after the reader mounts.
  await page.waitForTimeout(800);
  for (let i = 0; i < 40; i += 1) {
    if (await proseVisible(page)) {
      // Let the settled page paint before the caller screenshots it.
      await page.waitForTimeout(300);
      return;
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
  }
  throw new Error('never reached a prose page');
}

/** The painted cover shared with the audiobook fixture (STORE_AUDIOBOOK_COVER). */
const CLAIM_COVER_DATA_URI = `data:image/jpeg;base64,${readFileSync(STORE_AUDIOBOOK_COVER).toString('base64')}`;

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('01 claim from author', async ({ page }, testInfo) => {
  // Reveal the Send-to-Kindle / Play Books actions that ship on Android but are
  // platform-hidden on web (see isStoreCapture in environment.ts), so the shot
  // shows the real send options rather than a reconstruction.
  await page.addInitScript(() => {
    (window as unknown as { __STORE_CAPTURE__?: boolean }).__STORE_CAPTURE__ = true;
  });

  // Mock the redeem endpoint so the "We found your book!" dialog renders a
  // book from a named author, with the same painted cover as the shelf shot.
  // (Web dev routes API calls to /api — see environment.ts.)
  await page.route('**/api/claim/redeem', (route) =>
    route.fulfill({
      json: {
        giftId: 'gift_store_01',
        code: 'ABCDEFG',
        book: {
          title: 'The Lantern of Ash Hollow',
          author: 'Ava Thornbury',
          coverImageUrl: CLAIM_COVER_DATA_URI,
          description:
            'A windswept coastal mystery from the bestselling author — a keeper’s daughter, a drowned village, and a light that refuses to go out.',
          format: 'EPUB',
          // appOnlyReading:false so the send/download actions render.
          appOnlyReading: false,
        },
        downloadRef: 'ref_store_01',
        expiresAt: '2026-12-31T00:00:00Z',
      },
    }),
  );

  await page.goto('/claim');
  await expect(page.locator('.claim-page')).toBeVisible();
  await page.getByLabel('Claim code').fill('ABCDEFG');
  await page.getByRole('button', { name: 'Claim book' }).click();

  const dialog = page.locator('#book_code_dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('The Lantern of Ash Hollow')).toBeVisible();
  await expect(dialog.getByText('Ava Thornbury')).toBeVisible();
  await expect.poll(() => decodedCount(dialog.locator('img'))).toBeGreaterThan(0);
  await shoot(page, testInfo, '01-claim.png');
});

test('02 library books and audiobooks', async ({ page }, testInfo) => {
  const library = new LibraryPage(page);
  await library.goto();
  // A shelf of books plus an audiobook, so the headphones badge is on show.
  const shelf = [
    STORE_EPUBS[0]!,
    STORE_EPUBS[1]!,
    STORE_AUDIOBOOK_EPUB,
    STORE_EPUBS[2]!,
    STORE_EPUBS[3]!,
  ];
  await library.importBook(shelf[0]!);
  await expect(library.bookCards()).toHaveCount(1);
  for (let i = 1; i < shelf.length; i += 1) {
    await library.importAnotherBook(shelf[i]!);
    await expect(library.bookCards()).toHaveCount(i + 1);
  }

  // The audiobook badge must be present, and covers decoded, before the shot.
  await expect(page.locator('[aria-label="Audiobook"]').first()).toBeVisible();
  await expect
    .poll(() => decodedCount(library.bookshelf.locator('img')), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(4);
  await expect(new BottomNav(page).bar).toBeVisible();
  // The "Successfully imported" toast auto-dismisses; wait it out.
  await expect(page.getByText(/Successfully imported/)).toBeHidden({ timeout: 15_000 });
  await shoot(page, testInfo, '02-library.png');
});

test('03 audiobook read-along', async ({ page, openBook }, testInfo) => {
  await installAudioInstrumentation(page);
  const reader = await openBook(STORE_AUDIOBOOK_EPUB);
  const player = new AudiobookPlayerPage(page);
  await player.playButton.click();
  await expect.poll(() => lastAudioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.05);
  await expect
    .poll(() => reader.mediaOverlayHighlightText(), { timeout: 10_000 })
    .toContain('The lantern had burned');
  await player.pauseButton.click();
  // The highlight must survive the pause so the still shows read-along.
  await expect.poll(() => reader.mediaOverlayHighlightText()).toContain('The lantern had burned');
  await shoot(page, testInfo, '03-audiobook.png');
});

test('04 reading page', async ({ page, openBook }, testInfo) => {
  await openBook(STORE_EPUBS[0]!);
  // Chapter 1's opening — the recognizable "It is a truth universally
  // acknowledged…" page reads well for "a calm place to read".
  await advanceToProse(page);
  await shoot(page, testInfo, '04-reader.png');
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
    .poll(() => decodedCount(page.locator('.discover-page img')), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(4);
  await shoot(page, testInfo, '05-discover.png');
});
