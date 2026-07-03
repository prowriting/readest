import { expect, test } from '../fixtures/base';
import { AUDIOBOOK_MO_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

/**
 * Phase 8 contract: offline & storage. The Audiobook Storage dialog (More
 * menu) reports on-device audiobook usage and hosts the Wi-Fi-only download
 * preference. Removal is guarded: a book with no cloud copy cannot lose its
 * local file from here.
 */

async function openStorageDialog(page: LibraryPage['page']): Promise<void> {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Audiobook Storage' }).click();
  await expect(page.locator('#audiobook_storage_dialog')).toBeVisible();
}

test.describe('audiobook storage dashboard', () => {
  test('lists the downloaded audiobook with its size and a total', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(AUDIOBOOK_MO_EPUB);
    await expect(library.bookCards()).toHaveCount(1);

    await openStorageDialog(page);
    const dialog = page.locator('#audiobook_storage_dialog');
    const row = dialog.locator('[data-storage-item]');
    await expect(row).toHaveCount(1);
    await expect(row.first()).toContainText('MO Sentences');
    // The fixture is ~27 KB on disk.
    await expect(row.first()).toContainText(/\d+(\.\d+)?\s?KB/i);
    await expect(dialog.locator('[aria-label="Total Audio Storage"]')).toContainText(
      /\d+(\.\d+)?\s?KB/i,
    );

    // No cloud copy exists (unauthenticated web session): removing the only
    // copy must be blocked, not silently destructive.
    const remove = row.first().getByRole('button', { name: 'Remove Download' });
    await expect(remove).toBeDisabled();
  });

  test('the Wi-Fi-only preference lives in the dialog and persists', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(AUDIOBOOK_MO_EPUB);
    await expect(library.bookCards()).toHaveCount(1);

    await openStorageDialog(page);
    const toggle = page.getByRole('checkbox', { name: 'Wi-Fi Only Downloads' });
    await expect(toggle).not.toBeChecked();
    await toggle.check();

    await page.reload();
    await expect(library.container).toBeVisible();
    await openStorageDialog(page);
    await expect(page.getByRole('checkbox', { name: 'Wi-Fi Only Downloads' })).toBeChecked();
  });
});
