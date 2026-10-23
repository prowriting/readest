import { readFile } from 'node:fs/promises';
import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { rememberCloudLogin } from '../fixtures/preferences';
import { ReaderPage } from '../pages/ReaderPage';
import { LibraryPage } from '../pages/LibraryPage';

test.setTimeout(180_000);

for (const rememberedLogin of [false, true]) {
  test(`a guest sample link opens locally with remembered login ${rememberedLogin}`, async ({
    page,
    context,
  }) => {
    const epub = await readFile(SAMPLE_EPUB);
    let confirmed = false;
    await context.route('**/api/claim/redeem', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ code: 'sample1' });
      await route.fulfill({
        json: {
          giftId: 'sample-ref',
          downloadRef: 'sample-ref',
          expiresAt: null,
          book: {
            title: 'Alice’s Adventures in Wonderland',
            author: 'Lewis Carroll',
            coverImageUrl: null,
            description: '',
            format: 'epub',
          },
        },
      });
    });
    await context.route('**/api/claim/download?ref=sample-ref', (route) =>
      route.fulfill({ body: epub, contentType: 'application/epub+zip' }),
    );
    await context.route('**/api/claim/confirm', async (route) => {
      confirmed = true;
      await route.fulfill({ json: { consumed: true } });
    });

    await page.goto('/');
    await page.locator('[aria-label="Your Library"]').waitFor({ state: 'visible' });
    const origin = new URL(page.url()).origin;
    await context.route('**/guest-link-test', (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
        body: `<a href="${origin}/read?code=sample1" target="_blank" rel="noopener noreferrer">Read a sample</a>`,
      }),
    );
    await page.goto('/guest-link-test');
    if (rememberedLogin) {
      await rememberCloudLogin(page);
    }
    const opened = context.waitForEvent('page');
    await page.getByRole('link', { name: 'Read a sample' }).click();
    const readerTab = await opened;
    await new ReaderPage(readerTab).waitForReady();
    await expect(readerTab.getByRole('button', { name: 'Start Reading', exact: true })).toHaveCount(
      0,
    );
    await expect.poll(() => confirmed).toBe(true);
    expect(readerTab.url()).not.toContain('/auth');
    await readerTab.reload();
    await new ReaderPage(readerTab).waitForReady();
    await readerTab.close();
    const openedAgain = context.waitForEvent('page');
    await page.getByRole('link', { name: 'Read a sample' }).click();
    const reopenedReader = await openedAgain;
    await new ReaderPage(reopenedReader).waitForReady();
    const library = new LibraryPage(reopenedReader);
    await library.goto();
    await expect(library.bookCards()).toHaveCount(1);
  });
}
