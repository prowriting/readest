import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The persistent bottom navigation (tab bar + continue-reading strip) shown on
 * the Library, Discover, and Claim screens.
 */
export class BottomNav extends BasePage {
  readonly bar: Locator;
  readonly libraryTab: Locator;
  readonly discoverTab: Locator;
  readonly claimTab: Locator;
  readonly moreButton: Locator;
  readonly settingsMenu: Locator;
  readonly continueReading: Locator;

  constructor(page: Page) {
    super(page);
    this.bar = page.locator('[aria-label="Primary"]');
    this.libraryTab = this.bar.getByRole('button', { name: 'Library', exact: true });
    this.discoverTab = this.bar.getByRole('button', { name: 'Discover', exact: true });
    this.claimTab = this.bar.getByRole('button', { name: 'Claim', exact: true });
    this.moreButton = this.bar.getByRole('button', { name: 'More', exact: true });
    this.settingsMenu = page.locator('.settings-menu');
    this.continueReading = page.getByRole('button', { name: /^Continue reading/ });
  }

  async openMore(): Promise<void> {
    await this.moreButton.click();
  }
}
