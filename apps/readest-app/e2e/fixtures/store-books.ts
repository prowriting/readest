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
 * Media-overlay audiobook with real Alice prose and a proper title/author for
 * the read-along shot. Regenerate with `make-audiobook-fixtures.ts` (built by
 * `buildStoreAudiobookEpub` in `audiobook-epubs.ts`).
 */
export const STORE_AUDIOBOOK_EPUB = path.join(fixturesDir, 'books/store/alice-audiobook.epub');
