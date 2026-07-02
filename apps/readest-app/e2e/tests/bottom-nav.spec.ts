import { expect, test } from '../fixtures/base';
import { LibraryPage } from '../pages/LibraryPage';
import { BottomNav } from '../pages/BottomNav';

test.describe('Bottom navigation', () => {
  test('shows the four destinations on the library screen with Library active', async ({
    page,
  }) => {
    const library = new LibraryPage(page);
    await library.goto();

    const nav = new BottomNav(page);
    await expect(nav.bar).toBeVisible();
    await expect(nav.libraryTab).toBeVisible();
    await expect(nav.discoverTab).toBeVisible();
    await expect(nav.claimTab).toBeVisible();
    await expect(nav.moreButton).toBeVisible();

    await expect(nav.libraryTab).toHaveAttribute('aria-current', 'page');
  });

  test('More opens the existing settings menu as a popup', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();

    const nav = new BottomNav(page);
    await expect(nav.settingsMenu).toHaveCount(0);

    await nav.openMore();
    await expect(nav.settingsMenu).toBeVisible();
  });

  test('the separate top-right hamburger is removed from the header', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();

    // The old header settings ("hamburger") trigger is gone; More is the only entry point.
    await expect(page.locator('[aria-label="Settings Menu"]')).toHaveCount(0);
  });

  test('the continue-reading strip is hidden when no book has been opened', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();

    const nav = new BottomNav(page);
    await expect(nav.continueReading).toHaveCount(0);
  });
});
