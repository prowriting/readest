/**
 * Typed surface of foliate-js's MediaOverlay engine (packages/foliate-js/
 * epub.js) as extended for Bookarc audiobooks. The engine plays EPUB3 Media
 * Overlay SMIL clips and reports position on a per-section "concatenated
 * timeline": seconds from the start of the section across all of its audio
 * files, regardless of each file's own clip clock.
 */
export interface MediaOverlayItem {
  /** Resolved text href including the fragment, e.g. `text/c1.xhtml#s3`. */
  text: string;
  begin: number;
  end: number;
}

export interface MediaOverlayEngine extends EventTarget {
  /** Start playback at the beginning of a section (skips overlay-less sections). */
  start(sectionIndex: number): Promise<void>;
  /** Start playback at an offset (seconds) into a section's audio timeline. */
  startAtOffset(sectionIndex: number, offset: number): Promise<void>;
  /** Seek by a signed number of seconds, crossing files and sections. */
  seekRelative(seconds: number): Promise<void>;
  /**
   * Play the clip whose SMIL text target is `#fragment` in the given
   * section. Resolves false (with playback untouched) when nothing matches.
   */
  playFromText(sectionIndex: number, fragment: string): Promise<boolean>;
  /**
   * Concatenated-timeline offset (seconds) of the clip whose text target is
   * `#fragment`, or null when nothing matches. Never touches playback.
   */
  textOffset(sectionIndex: number, fragment: string): Promise<number | null>;
  pause(): void;
  resume(): void;
  stop(): void;
  prev(): void;
  next(): void;
  prevSection(): void;
  nextSection(): void;
  setVolume(volume: number): void;
  setRate(rate: number): void;
  /** Spine index of the playing section, or -1 when inactive. */
  readonly activeSectionIndex: number;
  /** Seconds elapsed on the current section's concatenated audio timeline. */
  readonly sectionOffset: number;
  /** Total seconds of the current section's concatenated audio timeline. */
  readonly sectionDuration: number;
  /** Live currentTime of the underlying audio element (file-local clock). */
  readonly audioTime: number;
}
