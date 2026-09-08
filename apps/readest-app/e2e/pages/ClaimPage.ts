import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The Claim screen (`/claim`) — redeem a 7-character author code.
 */
export class ClaimPage extends BasePage {
  readonly container: Locator;
  readonly heading: Locator;
  readonly codeInput: Locator;
  readonly claimButton: Locator;

  constructor(page: Page) {
    super(page);
    this.container = page.locator('.claim-page');
    this.heading = page.getByRole('heading', { name: 'Claim a book' });
    this.codeInput = page.getByLabel('Claim code');
    this.claimButton = page.getByRole('button', { name: 'Claim book' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/claim');
    await this.container.waitFor({ state: 'visible' });
  }
}
