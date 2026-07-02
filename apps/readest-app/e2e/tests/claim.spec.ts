import { expect, test } from '../fixtures/base';
import { LibraryPage } from '../pages/LibraryPage';
import { ClaimPage } from '../pages/ClaimPage';
import { BottomNav } from '../pages/BottomNav';

test.describe('Claim tab', () => {
  test('is reachable from the bottom nav and becomes the active tab', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();

    const nav = new BottomNav(page);
    await nav.claimTab.click();

    const claim = new ClaimPage(page);
    await expect(claim.container).toBeVisible();
    await expect(claim.heading).toBeVisible();
    await expect(new BottomNav(page).claimTab).toHaveAttribute('aria-current', 'page');
  });

  test('the code field auto-uppercases, restricts to A–Z, and caps at 7', async ({ page }) => {
    const claim = new ClaimPage(page);
    await claim.goto();

    await claim.codeInput.fill('');
    await claim.codeInput.pressSequentially('ab3c-def ghij');
    await expect(claim.codeInput).toHaveValue('ABCDEFG');
  });

  test('shows an inline error for an invalid-format code', async ({ page }) => {
    const claim = new ClaimPage(page);
    await claim.goto();

    await claim.codeInput.fill('');
    await claim.codeInput.pressSequentially('ABC');
    await claim.claimButton.click();

    await expect(page.locator('#claim-code-error')).toContainText(/7 letters/i);
  });
});
