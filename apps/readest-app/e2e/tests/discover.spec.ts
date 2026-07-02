import { expect, test } from '../fixtures/base';
import { BottomNav } from '../pages/BottomNav';

// The .NET catalog API is not part of the web e2e stack, so the Discover network
// boundary is mocked at the request level — this exercises the real client UI
// (feed rendering, See-all drill-in, details) against a controlled contract.
const feed = {
  version: 1,
  generated_at: '2026-06-30T00:00:00Z',
  etag: 'e1',
  rows: [
    {
      id: 'popular_classics',
      kind: 'popular_classics',
      title: 'Popular Classics',
      query: { sort: 'popular' },
      books: [
        {
          id: 'gutenberg:1661',
          title: 'The Adventures of Sherlock Holmes',
          authors: ['Doyle, Arthur Conan'],
          cover_url: '',
          is_free: true,
        },
      ],
    },
    {
      id: 'popular_in_fiction',
      kind: 'popular_in_category',
      title: 'Popular in Fiction',
      category: { id: 'fiction', name: 'Fiction' },
      query: { topic: 'Fiction', sort: 'popular' },
      books: [
        {
          id: 'gutenberg:100',
          title: 'Moby Dick',
          authors: ['Melville'],
          cover_url: '',
          is_free: true,
        },
      ],
    },
  ],
};

const searchResults = {
  results: [
    {
      source: 'gutenberg',
      sourceId: '100',
      title: 'Moby Dick',
      author: 'Herman Melville',
      downloadCount: 999,
      coverUrl: '',
      formats: [{ mimeType: 'application/epub+zip', url: 'https://x/100.epub' }],
    },
    {
      source: 'gutenberg',
      sourceId: '101',
      title: 'Typee',
      author: 'Herman Melville',
      downloadCount: 50,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 50,
};

test.describe('Discover tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/v1/discover/feed', (route) => route.fulfill({ json: feed }));
    await page.route('**/api/catalog/search**', (route) => route.fulfill({ json: searchResults }));
    await page.route('**/api/catalog/books/**', (route) =>
      route.fulfill({ json: searchResults.results[0] }),
    );
  });

  test('renders the server-driven rows with Discover active', async ({ page }) => {
    await page.goto('/discover');

    await expect(page.locator('.discover-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Popular Classics' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open The Adventures of Sherlock Holmes' }),
    ).toBeVisible();
    await expect(new BottomNav(page).discoverTab).toHaveAttribute('aria-current', 'page');
  });

  test('See all drills into a full list; back returns and restores the tab bar', async ({
    page,
  }) => {
    await page.goto('/discover');

    await page.getByRole('button', { name: 'See all in Popular in Fiction' }).click();

    // The overlay lists the full search result (Typee only exists there, not in the
    // feed preview), and the bottom nav is gone while it is open.
    await expect(page.getByRole('button', { name: 'Open Typee' })).toBeVisible();
    await expect(new BottomNav(page).bar).toHaveCount(0);

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Open Typee' })).toHaveCount(0);
    await expect(new BottomNav(page).discoverTab).toBeVisible();
  });

  test('tapping a cover opens the book details with a download action', async ({ page }) => {
    await page.goto('/discover');

    await page.getByRole('button', { name: 'Open The Adventures of Sherlock Holmes' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to Library' })).toBeVisible();
  });
});
