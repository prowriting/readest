import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Audiobook player surfaces inside the reader.
 *
 * This page object is the aria contract for the player UI: the audiobook
 * phases implement the mini bar and expandable full player against exactly
 * these accessible names. Actions/locators only — assertions stay in specs.
 */
export class AudiobookPlayerPage extends BasePage {
  /** Compact transport bar shown while an audiobook is open. */
  readonly miniBar: Locator;
  /** Expanded full player (a dialog layered over the reader). */
  readonly fullPlayer: Locator;
  readonly playButton: Locator;
  readonly pauseButton: Locator;
  /** Expands the mini bar into the full player. */
  readonly expandButton: Locator;
  /** Collapses the full player back to the mini bar. */
  readonly collapseButton: Locator;

  // — transport (full player) —
  readonly skipBackButton: Locator;
  readonly skipForwardButton: Locator;
  readonly prevChapterButton: Locator;
  readonly nextChapterButton: Locator;
  /** Playback speed range input, 0.5–3.0. */
  readonly speedSlider: Locator;
  /** Whole-book position range input, in seconds. */
  readonly scrubber: Locator;
  readonly elapsedLabel: Locator;
  readonly remainingLabel: Locator;
  readonly skipForwardSelect: Locator;
  readonly skipBackSelect: Locator;

  // — read-along (full player settings) —
  readonly readAlongToggle: Locator;
  readonly highlightStyleSelect: Locator;
  /** Shown when the reader navigated away from the playing position. */
  readonly returnToPlayingButton: Locator;

  // — sleep timer & bookmarks (full player) —
  readonly sleepTimerSelect: Locator;
  readonly sleepTimerRemaining: Locator;
  readonly extendSleepTimerButton: Locator;
  readonly addBookmarkButton: Locator;
  readonly removeBookmarkButton: Locator;
  readonly bookmarkItems: Locator;

  constructor(page: Page) {
    super(page);
    this.miniBar = page.locator('[aria-label="Audiobook Mini Player"]');
    this.fullPlayer = page.getByRole('dialog', { name: 'Audiobook Player' });
    this.playButton = page.getByRole('button', { name: 'Play', exact: true }).first();
    this.pauseButton = page.getByRole('button', { name: 'Pause', exact: true }).first();
    this.expandButton = page.getByRole('button', { name: 'Open Player', exact: true });
    this.collapseButton = page.getByRole('button', { name: 'Close Player', exact: true });

    this.skipBackButton = page.getByRole('button', { name: 'Skip Back', exact: true });
    this.skipForwardButton = page.getByRole('button', { name: 'Skip Forward', exact: true });
    this.prevChapterButton = page.getByRole('button', { name: 'Previous Chapter', exact: true });
    this.nextChapterButton = page.getByRole('button', { name: 'Next Chapter', exact: true });
    this.speedSlider = page.getByRole('slider', { name: 'Playback Speed' });
    this.scrubber = page.getByRole('slider', { name: 'Book Position' });
    this.elapsedLabel = page.locator('[aria-label="Elapsed Time"]');
    this.remainingLabel = page.locator('[aria-label="Time Remaining"]');
    this.skipForwardSelect = page.getByRole('combobox', { name: 'Skip Forward Interval' });
    this.skipBackSelect = page.getByRole('combobox', { name: 'Skip Back Interval' });

    this.readAlongToggle = page.getByRole('checkbox', { name: 'Read Along' });
    this.highlightStyleSelect = page.getByRole('combobox', { name: 'Highlight Style' });
    this.returnToPlayingButton = page.getByRole('button', {
      name: 'Go to Playing Position',
      exact: true,
    });

    this.sleepTimerSelect = page.getByRole('combobox', { name: 'Sleep Timer' });
    this.sleepTimerRemaining = page.locator('[aria-label="Sleep Timer Remaining"]');
    this.extendSleepTimerButton = page.getByRole('button', {
      name: 'Extend Sleep Timer',
      exact: true,
    });
    // Scoped to the player dialog — the reader header has its own bookmark toggle.
    this.addBookmarkButton = this.fullPlayer.getByRole('button', {
      name: 'Add Bookmark',
      exact: true,
    });
    this.removeBookmarkButton = this.fullPlayer.getByRole('button', {
      name: 'Remove Bookmark',
      exact: true,
    });
    this.bookmarkItems = this.fullPlayer.locator('[data-bookmark-item]');
  }

  /** Open the bookmark list of the full player. */
  async openBookmarks(): Promise<void> {
    await this.page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  }

  /** The delete control of the nth bookmark list entry. */
  deleteBookmarkButton(index: number): Locator {
    return this.bookmarkItems.nth(index).getByRole('button', { name: 'Delete Bookmark' });
  }

  /** A highlight color preset in the player settings, by English color name. */
  highlightColorSwatch(name: string): Locator {
    return this.page.getByRole('button', { name: `Highlight Color ${name}`, exact: true });
  }

  /** Open the player-settings section of the full player. */
  async openSettings(): Promise<void> {
    await this.page.getByRole('button', { name: 'Player Settings', exact: true }).click();
  }

  /** Open the chapter list of the full player. */
  async openChapters(): Promise<void> {
    await this.page.getByRole('button', { name: 'Chapters', exact: true }).click();
  }

  /** A chapter entry in the full player's chapter list. */
  chapterItem(label: string): Locator {
    return this.fullPlayer.getByRole('button', { name: label, exact: true });
  }
}
