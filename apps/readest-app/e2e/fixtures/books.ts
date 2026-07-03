import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));

/** Synthetic plain-text book — fast, used for basic import coverage. */
export const SAMPLE_TXT = path.join(fixturesDir, 'books/readest-e2e-sample.txt');

/**
 * A real EPUB ("Alice's Adventures in Wonderland") from the unit-test
 * fixtures. Has multiple chapters and substantial prose, so it exercises
 * reading and annotation flows realistically.
 */
export const SAMPLE_EPUB = path.join(
  fixturesDir,
  '../../src/__tests__/fixtures/data/sample-alice.epub',
);

/**
 * Generated EPUB3 Media Overlay audiobooks (see `audiobook-epubs.ts`;
 * regenerate with `make-audiobook-fixtures.ts`). Audio is WAV — the one
 * format Playwright's bundled Chromium is guaranteed to decode.
 */
export const AUDIOBOOK_MO_EPUB = path.join(fixturesDir, 'books/mo-sentences.epub');
/** Title-only chapters, one full-chapter clip each — the audio-only shape. */
export const AUDIOBOOK_AUDIO_ONLY_EPUB = path.join(fixturesDir, 'books/mo-audio-only.epub');
/** Chapter 2 references missing audio; chapter 3 SMIL is not well-formed. */
export const AUDIOBOOK_MALFORMED_EPUB = path.join(fixturesDir, 'books/mo-malformed.epub');
/**
 * AAC-in-MP4 audio — bundled Chromium cannot decode it; only the
 * `chrome-aac` Playwright project (branded Chrome) runs against this.
 */
export const AUDIOBOOK_AAC_EPUB = path.join(fixturesDir, 'books/mo-aac.epub');
