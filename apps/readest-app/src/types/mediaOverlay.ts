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

export interface MediaOverlayPlaybackCue {
  /** Seconds from the beginning of this audio segment. */
  offset: number;
  /** Resolved EPUB text target, including its fragment. */
  text: string;
}

export interface MediaOverlayPlaybackSegment {
  /** Resolved EPUB entry path. */
  source: string;
  type: string;
  clipBegin: number;
  clipEnd: number;
  /** Effective duration of the referenced audio resource. */
  sourceDuration: number;
  cues: MediaOverlayPlaybackCue[];
}

export interface MediaOverlayPlaybackSection {
  sectionIndex: number;
  duration: number;
  segments: MediaOverlayPlaybackSegment[];
}

export interface MediaOverlayPlaybackManifest {
  sections: MediaOverlayPlaybackSection[];
}

export interface MediaOverlayEngine extends EventTarget {
  /** Start playback at the beginning of a section (skips overlay-less sections). */
  start(sectionIndex: number): Promise<void>;
  /** Start playback at an offset (seconds) into a section's audio timeline. */
  startAtOffset(sectionIndex: number, offset: number): Promise<void>;
  /** Select and highlight a cue without creating or controlling browser audio. */
  synchronizeAtOffset(sectionIndex: number, offset: number): Promise<boolean>;
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
  /** Export the parsed SMIL timeline for a native background player. */
  exportPlaybackManifest(): Promise<MediaOverlayPlaybackManifest>;
  /** Materialize one source returned by exportPlaybackManifest(). */
  loadAudioSource(source: string): Promise<Blob>;
  pause(): void;
  resume(): void;
  stop(): void;
  prev(): void;
  next(): void;
  setVolume(volume: number): void;
  setRate(rate: number): void;
  /** Spine index of the playing section, or -1 when inactive. */
  readonly activeSectionIndex: number;
  /** Seconds elapsed on the current section's concatenated audio timeline. */
  readonly sectionOffset: number;
  /** Total seconds of the current section's concatenated audio timeline. */
  readonly sectionDuration: number;
  /** Publication-relative path of the active audio resource. */
  readonly activeAudioSource: string | null;
  /** Current time on the active audio resource's own clock. */
  readonly audioTime: number;
  /** Duration of the active audio resource, when its metadata is available. */
  readonly audioDuration: number;
}
