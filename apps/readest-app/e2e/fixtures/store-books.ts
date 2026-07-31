import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Curated public-domain EPUBs (Standard Ebooks) used only by the store
 * screenshot lane (`e2e/store/`, run via `pnpm store:capture`). Chosen for
 * attractive covers so the library shot looks like a real shelf — Google
 * rejects empty or placeholder screenshots.
 */
export const STORE_EPUBS = [
  'jane-austen_pride-and-prejudice.epub',
  'arthur-conan-doyle_the-adventures-of-sherlock-holmes.epub',
  'mary-shelley_frankenstein.epub',
  'bram-stoker_dracula.epub',
  'herman-melville_moby-dick.epub',
].map((name) => path.join(fixturesDir, 'books/store', name));

/**
 * Media-overlay audiobook of the fictional indie title "The Lantern of Ash
 * Hollow" by Ava Thornbury — same book as the claim-code shot, with an
 * embedded cover — for the shelf and read-along shots. Regenerate with
 * `make-audiobook-fixtures.ts` (built by `buildStoreAudiobookEpub`).
 */
export const STORE_AUDIOBOOK_EPUB = path.join(fixturesDir, 'books/store/lantern-audiobook.epub');

/**
 * Painted cover for the store book — embedded in the audiobook EPUB above and
 * served as the claim-dialog cover, so the claim / shelf / read-along shots all
 * show the same book.
 */
export const STORE_AUDIOBOOK_COVER = path.join(fixturesDir, 'books/store/lantern-cover.jpg');
