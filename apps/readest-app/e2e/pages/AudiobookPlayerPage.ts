import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Audiobook player surfaces inside the reader.
 *
 * This page object is the aria contract for the player UI: Phase 1 of the
 * audiobooks plan implements the mini bar and expandable full player against
 * exactly these accessible names. Actions/locators only — assertions stay in
 * specs.
 */
export class AudiobookPlayerPage extends BasePage {
  /** Compact transport bar shown while an audiobook is open. */
  readonly miniBar: Locator;
  readonly playButton: Locator;
  readonly pauseButton: Locator;
  /** Expands the mini bar into the full player. */
  readonly expandButton: Locator;
  /** Collapses the full player back to the mini bar. */
  readonly collapseButton: Locator;

  constructor(page: Page) {
    super(page);
    this.miniBar = page.locator('[aria-label="Audiobook Player"]');
    this.playButton = page.getByRole('button', { name: 'Play', exact: true });
    this.pauseButton = page.getByRole('button', { name: 'Pause', exact: true });
    this.expandButton = page.getByRole('button', { name: 'Open Player', exact: true });
    this.collapseButton = page.getByRole('button', { name: 'Close Player', exact: true });
  }
}
