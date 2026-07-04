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
  /** Docked audio tray (compact transport bar) shown while an audiobook is open. */
  readonly miniBar: Locator;
  /** Full player controls (a dialog inside the fullscreen player screen). */
  readonly fullPlayer: Locator;
  readonly playButton: Locator;
  readonly pauseButton: Locator;
  /** Expands the tray into the fullscreen player. */
  readonly expandButton: Locator;
  /** Drops the fullscreen player back to the tray. */
  readonly minimizeButton: Locator;
  /** Drag handle on the tray: drag up expands, drag down dismisses. */
  readonly trayHandle: Locator;
  /** Speed chip on the tray; tapping cycles through the presets. */
  readonly traySpeedButton: Locator;
  /** Footer-bar audio toggle that replaces the TTS button for audio books. */
  readonly toolbarAudiobookButton: Locator;
  /** Footer-bar TTS button (present only for books without audio). */
  readonly toolbarSpeakButton: Locator;

  // — transport (full player) —
  readonly skipBackButton: Locator;
  readonly skipForwardButton: Locator;
  readonly prevChapterButton: Locator;
  readonly nextChapterButton: Locator;
  /** Playback speed range input, 0.5–3.0 (inside the overflow panel). */
  readonly speedSlider: Locator;
  /** CHAPTER-scoped position range input, in seconds (PRD §5.1). */
  readonly scrubber: Locator;
  /** Elapsed time in the current chapter. */
  readonly elapsedLabel: Locator;
  /** Remaining time in the current chapter, rendered with a leading '-'. */
  readonly remainingLabel: Locator;
  /** Whole-book "Nh Nm left" line above the scrubber. */
  readonly timeLeftLabel: Locator;
  readonly skipForwardSelect: Locator;
  readonly skipBackSelect: Locator;

  // — read-along (full player settings) —
  readonly readAlongToggle: Locator;
  readonly highlightStyleSelect: Locator;
  /** Shown when the reader navigated away from the playing position. */
  readonly returnToPlayingButton: Locator;

  // — fullscreen player screen —
  /**
   * Fullscreen player surface: the default view for audio-only books and
   * the expanded state for text+audio books (v2 PRD §5.1).
   */
  readonly playerScreen: Locator;
  readonly coverArt: Locator;
  readonly screenBackButton: Locator;

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
    this.minimizeButton = page.getByRole('button', { name: 'Minimize Player', exact: true });
    this.trayHandle = this.miniBar.locator('[data-testid="audiobook-tray-handle"]');
    this.traySpeedButton = this.miniBar.getByRole('button', { name: 'Playback Speed' });
    // Both footer bars (mobile + desktop) render the button; at the e2e
    // desktop viewport only the desktop bar — last in DOM order — is shown.
    this.toolbarAudiobookButton = page
      .locator('.footer-bar')
      .getByRole('button', { name: 'Audiobook', exact: true })
      .last();
    this.toolbarSpeakButton = page
      .locator('.footer-bar')
      .getByRole('button', { name: 'Speak', exact: true })
      .last();

    this.skipBackButton = page.getByRole('button', { name: 'Skip Back', exact: true });
    this.skipForwardButton = page.getByRole('button', { name: 'Skip Forward', exact: true });
    this.prevChapterButton = page.getByRole('button', { name: 'Previous Chapter', exact: true });
    this.nextChapterButton = page.getByRole('button', { name: 'Next Chapter', exact: true });
    this.speedSlider = page.getByRole('slider', { name: 'Playback Speed' });
    this.scrubber = page.getByRole('slider', { name: 'Chapter Position' });
    this.elapsedLabel = page.locator('[aria-label="Elapsed Time"]');
    this.remainingLabel = page.locator('[aria-label="Time Remaining"]');
    this.timeLeftLabel = page.locator('[aria-label="Time Left in Book"]');
    this.skipForwardSelect = page.getByRole('combobox', { name: 'Skip Forward Interval' });
    this.skipBackSelect = page.getByRole('combobox', { name: 'Skip Back Interval' });

    this.readAlongToggle = page.getByRole('checkbox', { name: 'Read Along' });
    this.highlightStyleSelect = page.getByRole('combobox', { name: 'Highlight Style' });
    this.returnToPlayingButton = page.getByRole('button', {
      name: 'Go to Playing Position',
      exact: true,
    });

    this.playerScreen = page.locator('[aria-label="Audiobook Screen"]');
    this.coverArt = this.playerScreen.locator('[aria-label="Audiobook Cover"]');
    this.screenBackButton = this.playerScreen.getByRole('button', {
      name: 'Go to Library',
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

  /** Open the bookmark list (lives in the overflow panel, PRD §5.1 top bar). */
  async openBookmarks(): Promise<void> {
    await this.openSettings();
  }

  /** Open the sleep-timer panel from the top bar. */
  async openSleepTimer(): Promise<void> {
    await this.fullPlayer.getByRole('button', { name: 'Sleep Timer', exact: true }).click();
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
}
