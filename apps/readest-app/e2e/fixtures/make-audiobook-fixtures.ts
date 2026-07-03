/**
 * Regenerates the committed audiobook e2e fixtures in e2e/fixtures/books/.
 *
 * Usage (from apps/readest-app):
 *   node --experimental-strip-types --no-warnings e2e/fixtures/make-audiobook-fixtures.ts
 *
 * Output is deterministic — bytes only change when audiobook-epubs.ts changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAllAudiobookFixtures } from './audiobook-epubs.ts';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'books');
mkdirSync(outDir, { recursive: true });

let total = 0;
for (const { name, bytes } of buildAllAudiobookFixtures()) {
  writeFileSync(path.join(outDir, name), bytes);
  total += bytes.byteLength;
  console.log(`${name}: ${(bytes.byteLength / 1024).toFixed(1)} KiB`);
}
console.log(`total: ${(total / 1024).toFixed(1)} KiB`);
