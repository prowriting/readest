/**
 * Regenerates the committed audiobook e2e fixtures in e2e/fixtures/books/.
 *
 * Usage (from apps/readest-app):
 *   node --experimental-strip-types --no-warnings e2e/fixtures/make-audiobook-fixtures.ts
 *
 * Output is deterministic — bytes only change when audiobook-epubs.ts changes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAllAudiobookFixtures,
  buildMoAacEpub,
  buildMoAudioOnlyEpub,
} from './audiobook-epubs.ts';
import { unzipSync } from 'fflate';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'books');
mkdirSync(outDir, { recursive: true });

let total = 0;
const emit = (name: string, bytes: Uint8Array) => {
  writeFileSync(path.join(outDir, name), bytes);
  total += bytes.byteLength;
  console.log(`${name}: ${(bytes.byteLength / 1024).toFixed(1)} KiB`);
};

for (const { name, bytes } of buildAllAudiobookFixtures()) emit(name, bytes);

// AAC variant: reuse the audio-only book's WAVs and transcode with the
// system encoder (afconvert ships with macOS). Skipped where unavailable —
// the committed mo-aac.epub only changes when a maintainer regenerates it.
try {
  const wavZip = unzipSync(buildMoAudioOnlyEpub().bytes);
  const work = mkdtempSync(path.join(tmpdir(), 'bookarc-aac-'));
  const m4a = {} as Record<'c1' | 'c2', Uint8Array>;
  for (const slug of ['c1', 'c2'] as const) {
    const wavPath = path.join(work, `${slug}.wav`);
    const m4aPath = path.join(work, `${slug}.m4a`);
    writeFileSync(wavPath, wavZip[`OEBPS/audio/${slug}.wav`]!);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', wavPath, m4aPath]);
    m4a[slug] = new Uint8Array(readFileSync(m4aPath));
  }
  rmSync(work, { recursive: true, force: true });
  const aac = buildMoAacEpub(m4a);
  emit(aac.name, aac.bytes);
} catch (error) {
  console.warn('skipping mo-aac.epub (no usable AAC encoder):', (error as Error).message);
}

console.log(`total: ${(total / 1024).toFixed(1)} KiB`);
