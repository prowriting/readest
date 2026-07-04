import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  buildAllAudiobookFixtures,
  buildMoAudioOnlyEpub,
  buildMoMalformedEpub,
  buildMoSentencesEpub,
} from '../../../e2e/fixtures/audiobook-epubs';

// ─── Test-side binary/XML helpers (independent of the builder) ───────────────

const readU16 = (b: Uint8Array, off: number): number => b[off]! | (b[off + 1]! << 8);
const readU32 = (b: Uint8Array, off: number): number =>
  (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
const ascii = (b: Uint8Array, off: number, len: number): string =>
  strFromU8(b.subarray(off, off + len));

/** Parse an EPUB/SMIL clock value of the form h:mm:ss(.fff) into seconds. */
const clockToSeconds = (value: string): number => {
  const parts = value.split(':').map((x) => Number.parseFloat(x));
  expect(parts).toHaveLength(3);
  const [h, m, s] = parts as [number, number, number];
  return h * 3600 + m * 60 + s;
};

interface WavInfo {
  format: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  bitsPerSample: number;
  dataBytes: number;
  seconds: number;
}

/** Minimal RIFF walker so WAV expectations don't depend on builder internals. */
const parseWav = (b: Uint8Array): WavInfo => {
  expect(ascii(b, 0, 4)).toBe('RIFF');
  expect(ascii(b, 8, 4)).toBe('WAVE');
  let off = 12;
  let format = -1;
  let channels = -1;
  let sampleRate = -1;
  let byteRate = -1;
  let bitsPerSample = -1;
  let dataBytes = -1;
  while (off + 8 <= b.length) {
    const id = ascii(b, off, 4);
    const size = readU32(b, off + 4);
    if (id === 'fmt ') {
      format = readU16(b, off + 8);
      channels = readU16(b, off + 10);
      sampleRate = readU32(b, off + 12);
      byteRate = readU32(b, off + 16);
      bitsPerSample = readU16(b, off + 22);
    } else if (id === 'data') {
      dataBytes = size;
    }
    off += 8 + size + (size % 2);
  }
  expect(dataBytes).toBeGreaterThan(0);
  expect(byteRate).toBeGreaterThan(0);
  return {
    format,
    channels,
    sampleRate,
    byteRate,
    bitsPerSample,
    dataBytes,
    seconds: dataBytes / byteRate,
  };
};

const parseXml = (u8: Uint8Array): Document =>
  new DOMParser().parseFromString(strFromU8(u8), 'application/xml');

const isWellFormed = (doc: Document): boolean =>
  doc.getElementsByTagName('parsererror').length === 0;

interface ParInfo {
  text: string;
  audio: string;
  clipBegin: number;
  clipEnd: number;
}

/** Extract <par> timing from a SMIL doc; clip values use the plain `1.5s` form. */
const smilPars = (doc: Document): ParInfo[] =>
  Array.from(doc.getElementsByTagName('par')).map((par) => {
    const text = par.getElementsByTagName('text')[0];
    const audio = par.getElementsByTagName('audio')[0];
    expect(text, 'every <par> must have a <text>').toBeDefined();
    expect(audio, 'every <par> must have an <audio>').toBeDefined();
    const clip = (attr: string): number => {
      const raw = audio!.getAttribute(attr);
      expect(raw).toMatch(/^\d+(\.\d+)?s$/);
      return Number.parseFloat(raw!);
    };
    return {
      text: text!.getAttribute('src') ?? '',
      audio: audio!.getAttribute('src') ?? '',
      clipBegin: clip('clipBegin'),
      clipEnd: clip('clipEnd'),
    };
  });

const opfMetaValues = (opf: Document, property: string): Map<string | null, string> => {
  const out = new Map<string | null, string>();
  for (const meta of Array.from(opf.getElementsByTagName('meta'))) {
    if (meta.getAttribute('property') === property) {
      out.set(meta.getAttribute('refines'), meta.textContent ?? '');
    }
  }
  return out;
};

type Zip = Record<string, Uint8Array>;
const entriesOf = (epub: Uint8Array): Zip => unzipSync(epub);
const textOf = (zip: Zip, name: string): string => {
  const entry = zip[name];
  expect(entry, `zip entry ${name} must exist`).toBeDefined();
  return strFromU8(entry!);
};

/** OCF core checks: stored mimetype first, container.xml → OEBPS/content.opf. */
const expectValidContainer = (epub: Uint8Array): Zip => {
  // First local file header must be the uncompressed `mimetype` (EPUB OCF).
  expect(ascii(epub, 0, 4)).toBe('PK\x03\x04');
  expect(readU16(epub, 8)).toBe(0); // compression method: stored
  expect(readU16(epub, 26)).toBe('mimetype'.length);
  expect(ascii(epub, 30, 8)).toBe('mimetype');
  const zip = entriesOf(epub);
  expect(textOf(zip, 'mimetype')).toBe('application/epub+zip');
  expect(textOf(zip, 'META-INF/container.xml')).toContain('full-path="OEBPS/content.opf"');
  const opf = parseXml(zip['OEBPS/content.opf']!);
  expect(isWellFormed(opf)).toBe(true);
  return zip;
};

const spineChapterOverlays = (opf: Document): { href: string; smilHref: string }[] => {
  const items = new Map<string, Element>();
  for (const item of Array.from(opf.getElementsByTagName('item'))) {
    items.set(item.getAttribute('id') ?? '', item);
  }
  return Array.from(opf.getElementsByTagName('itemref')).map((ref) => {
    const chapter = items.get(ref.getAttribute('idref') ?? '');
    expect(chapter, 'spine idref must resolve to a manifest item').toBeDefined();
    const overlayId = chapter!.getAttribute('media-overlay');
    expect(overlayId, 'every spine chapter must declare media-overlay').toBeTruthy();
    const smil = items.get(overlayId!);
    expect(smil, 'media-overlay id must resolve to a manifest item').toBeDefined();
    expect(smil!.getAttribute('media-type')).toBe('application/smil+xml');
    return {
      href: chapter!.getAttribute('href') ?? '',
      smilHref: smil!.getAttribute('href') ?? '',
    };
  });
};

// ─── mo-sentences.epub ───────────────────────────────────────────────────────

describe('buildMoSentencesEpub', () => {
  const { name, bytes } = buildMoSentencesEpub();
  const zip = expectValidContainer(bytes);
  const opf = parseXml(zip['OEBPS/content.opf']!);

  it('is named and shaped like an EPUB3 MO book', () => {
    expect(name).toBe('mo-sentences.epub');
    expect(spineChapterOverlays(opf)).toHaveLength(3);
    expect(Object.keys(zip).sort()).toEqual(
      [
        'mimetype',
        'META-INF/container.xml',
        'OEBPS/content.opf',
        'OEBPS/nav.xhtml',
        'OEBPS/text/c1.xhtml',
        'OEBPS/text/c2.xhtml',
        'OEBPS/text/c3.xhtml',
        'OEBPS/smil/c1.smil',
        'OEBPS/smil/c2.smil',
        'OEBPS/smil/c3.smil',
        'OEBPS/audio/c1.wav',
        'OEBPS/audio/c2a.wav',
        'OEBPS/audio/c2b.wav',
        'OEBPS/audio/c3.wav',
      ].sort(),
    );
  });

  it('chapter 1: eight contiguous sentence clips over a single audio file', () => {
    const pars = smilPars(parseXml(zip['OEBPS/smil/c1.smil']!));
    expect(pars).toHaveLength(8);
    pars.forEach((par, i) => {
      expect(par.text).toBe(`../text/c1.xhtml#s${i + 1}`);
      expect(par.audio).toBe('../audio/c1.wav');
      expect(par.clipBegin).toBeCloseTo(i * 1.5, 5);
      expect(par.clipEnd).toBeCloseTo((i + 1) * 1.5, 5);
    });
  });

  it('chapter 2: sentences split across two audio files with per-file clip times', () => {
    const pars = smilPars(parseXml(zip['OEBPS/smil/c2.smil']!));
    expect(pars).toHaveLength(8);
    for (const [i, par] of pars.entries()) {
      const local = i % 4;
      expect(par.text).toBe(`../text/c2.xhtml#s${i + 1}`);
      expect(par.audio).toBe(i < 4 ? '../audio/c2a.wav' : '../audio/c2b.wav');
      expect(par.clipBegin).toBeCloseTo(local * 1.5, 5);
      expect(par.clipEnd).toBeCloseTo((local + 1) * 1.5, 5);
    }
  });

  it('chapter 3: word-level granularity with twelve half-second clips', () => {
    const pars = smilPars(parseXml(zip['OEBPS/smil/c3.smil']!));
    expect(pars).toHaveLength(12);
    pars.forEach((par, i) => {
      expect(par.text).toBe(`../text/c3.xhtml#w${i + 1}`);
      expect(par.audio).toBe('../audio/c3.wav');
      expect(par.clipBegin).toBeCloseTo(i * 0.5, 5);
      expect(par.clipEnd).toBeCloseTo((i + 1) * 0.5, 5);
    });
  });

  it('every SMIL text fragment id exists in its chapter document', () => {
    for (const chapter of ['c1', 'c2', 'c3']) {
      const xhtml = textOf(zip, `OEBPS/text/${chapter}.xhtml`);
      const pars = smilPars(parseXml(zip[`OEBPS/smil/${chapter}.smil`]!));
      for (const par of pars) {
        const fragment = par.text.split('#')[1]!;
        expect(xhtml, `${chapter}.xhtml must contain id ${fragment}`).toContain(`id="${fragment}"`);
      }
    }
  });

  it('WAV files are 8 kHz 8-bit mono PCM and cover their SMIL clips exactly', () => {
    const lastClipEnd = (smil: string): number => {
      const pars = smilPars(parseXml(zip[smil]!));
      return pars[pars.length - 1]!.clipEnd;
    };
    const expected: [string, number][] = [
      ['OEBPS/audio/c1.wav', lastClipEnd('OEBPS/smil/c1.smil')],
      ['OEBPS/audio/c2a.wav', 6],
      ['OEBPS/audio/c2b.wav', 6],
      ['OEBPS/audio/c3.wav', lastClipEnd('OEBPS/smil/c3.smil')],
    ];
    for (const [file, seconds] of expected) {
      const wav = parseWav(zip[file]!);
      expect(wav.format, `${file} must be PCM`).toBe(1);
      expect(wav.channels).toBe(1);
      expect(wav.sampleRate).toBe(8000);
      expect(wav.bitsPerSample).toBe(8);
      expect(wav.seconds).toBeCloseTo(seconds, 3);
    }
  });

  it('OPF declares per-overlay and total media:duration plus active classes', () => {
    const durations = opfMetaValues(opf, 'media:duration');
    expect(clockToSeconds(durations.get('#smil-c1') ?? '')).toBeCloseTo(12, 3);
    expect(clockToSeconds(durations.get('#smil-c2') ?? '')).toBeCloseTo(12, 3);
    expect(clockToSeconds(durations.get('#smil-c3') ?? '')).toBeCloseTo(6, 3);
    expect(clockToSeconds(durations.get(null) ?? '')).toBeCloseTo(30, 3);
    expect(opfMetaValues(opf, 'media:active-class').get(null)).toBe('-epub-media-overlay-active');
    expect(opfMetaValues(opf, 'media:playback-active-class').get(null)).toBe(
      '-epub-media-overlay-playing',
    );
  });

  it('builds deterministically', () => {
    expect(Buffer.from(buildMoSentencesEpub().bytes).equals(Buffer.from(bytes))).toBe(true);
  });
});

// ─── mo-audio-only.epub ──────────────────────────────────────────────────────

describe('buildMoAudioOnlyEpub', () => {
  const { name, bytes } = buildMoAudioOnlyEpub();
  const zip = expectValidContainer(bytes);
  const opf = parseXml(zip['OEBPS/content.opf']!);

  it('has three title-only chapters, each fully covered by one clip', () => {
    expect(name).toBe('mo-audio-only.epub');
    const chapters = spineChapterOverlays(opf);
    expect(chapters).toHaveLength(3);
    for (const [i, chapter] of chapters.entries()) {
      const xhtml = textOf(zip, `OEBPS/${chapter.href}`);
      expect(xhtml).toContain(`id="t${i + 1}"`);
      expect(xhtml, 'audio-only chapters must not contain prose paragraphs').not.toContain('<p');
      const pars = smilPars(parseXml(zip[`OEBPS/${chapter.smilHref}`]!));
      expect(pars).toHaveLength(1);
      expect(pars[0]!.text.endsWith(`#t${i + 1}`)).toBe(true);
      expect(pars[0]!.clipBegin).toBe(0);
      expect(pars[0]!.clipEnd).toBeCloseTo(10, 5);
      const wav = parseWav(zip[`OEBPS/audio/c${i + 1}.wav`]!);
      expect(wav.seconds).toBeCloseTo(10, 3);
    }
  });

  it('declares 10s per overlay and a 30s total duration', () => {
    const durations = opfMetaValues(opf, 'media:duration');
    for (const chapter of ['c1', 'c2', 'c3']) {
      expect(clockToSeconds(durations.get(`#smil-${chapter}`) ?? '')).toBeCloseTo(10, 3);
    }
    expect(clockToSeconds(durations.get(null) ?? '')).toBeCloseTo(30, 3);
  });
});

// ─── mo-malformed.epub ───────────────────────────────────────────────────────

describe('buildMoMalformedEpub', () => {
  const { name, bytes } = buildMoMalformedEpub();
  const zip = expectValidContainer(bytes);
  const opf = parseXml(zip['OEBPS/content.opf']!);

  it('keeps chapter 1 fully valid so partial playback stays testable', () => {
    expect(name).toBe('mo-malformed.epub');
    expect(spineChapterOverlays(opf)).toHaveLength(3);
    const pars = smilPars(parseXml(zip['OEBPS/smil/c1.smil']!));
    expect(pars).toHaveLength(4);
    const wav = parseWav(zip['OEBPS/audio/c1.wav']!);
    expect(wav.seconds).toBeCloseTo(pars[pars.length - 1]!.clipEnd, 3);
  });

  it('chapter 2 SMIL references an audio file missing from the package', () => {
    const pars = smilPars(parseXml(zip['OEBPS/smil/c2.smil']!));
    expect(pars.length).toBeGreaterThan(0);
    expect(pars[0]!.audio).toBe('../audio/missing.wav');
    expect(zip['OEBPS/audio/missing.wav']).toBeUndefined();
  });

  it('chapter 3 SMIL is not well-formed XML', () => {
    const doc = parseXml(zip['OEBPS/smil/c3.smil']!);
    expect(isWellFormed(doc)).toBe(false);
  });
});

// ─── Cross-cutting budgets ───────────────────────────────────────────────────

describe('buildAllAudiobookFixtures', () => {
  it('returns all four books within the committed size budget', () => {
    const fixtures = buildAllAudiobookFixtures();
    expect(fixtures.map((f) => f.name)).toEqual([
      'mo-sentences.epub',
      'mo-long.epub',
      'mo-audio-only.epub',
      'mo-malformed.epub',
    ]);
    let total = 0;
    for (const fixture of fixtures) {
      expect(fixture.bytes.byteLength, `${fixture.name} exceeds per-book budget`).toBeLessThan(
        120_000,
      );
      total += fixture.bytes.byteLength;
    }
    expect(total, 'combined fixture size must stay small enough to commit').toBeLessThan(300_000);
  });
});
