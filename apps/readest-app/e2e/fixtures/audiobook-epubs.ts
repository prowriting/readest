/**
 * Deterministic EPUB3 Media Overlay fixture builders for the audiobook e2e
 * and unit suites. Everything is generated in memory: audio is 8 kHz 8-bit
 * mono PCM WAV (the one format every test browser decodes — Playwright's
 * bundled Chromium has no AAC/M4B codecs), with a distinct tone per clip so
 * seeks are observable by ear in headed runs.
 *
 * Regenerate the committed fixtures with:
 *   node --experimental-strip-types --no-warnings e2e/fixtures/make-audiobook-fixtures.ts
 *
 * Builders must stay deterministic (fixed mtime, no randomness) so committed
 * fixture bytes only change when the spec here changes.
 */
import { zipSync } from 'fflate';
import type { Zippable } from 'fflate';

/**
 * fflate's own strToU8 is off-limits here: under vitest's jsdom environment
 * its TextEncoder output comes from another JS realm, so fflate's internal
 * `instanceof Uint8Array` gate fails and zipSync silently writes directory
 * entries instead of files. Arrays constructed in this module's realm pass.
 * Fixture content is ASCII by design; the guard keeps it that way.
 */
const textToU8 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) throw new Error(`fixture text must stay ASCII, found U+${code.toString(16)}`);
    out[i] = code;
  }
  return out;
};

export interface FixtureEpub {
  name: string;
  bytes: Uint8Array;
}

const SAMPLE_RATE = 8000;
const FIXED_MTIME = new Date('2026-01-01T00:00:00Z');
const ACTIVE_CLASS = '-epub-media-overlay-active';
const PLAYBACK_ACTIVE_CLASS = '-epub-media-overlay-playing';

// ─── WAV synthesis ───────────────────────────────────────────────────────────

const toneFrequency = (clipIndex: number): number => 220 * 2 ** ((clipIndex % 13) / 12);

/** One WAV whose audio is a sequence of tones, one per clip duration. */
const toneWav = (clipSeconds: number[]): Uint8Array => {
  const totalSamples = clipSeconds.reduce((sum, sec) => sum + Math.round(sec * SAMPLE_RATE), 0);
  const samples = new Uint8Array(totalSamples);
  let offset = 0;
  clipSeconds.forEach((seconds, clip) => {
    const count = Math.round(seconds * SAMPLE_RATE);
    const freq = toneFrequency(clip);
    for (let s = 0; s < count; s++) {
      samples[offset + s] = 128 + Math.round(45 * Math.sin((2 * Math.PI * freq * s) / SAMPLE_RATE));
    }
    offset += count;
  });
  const out = new Uint8Array(44 + samples.length);
  const view = new DataView(out.buffer);
  const writeAscii = (off: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[off + i] = text.charCodeAt(i);
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true); // byte rate (8-bit mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, samples.length, true);
  out.set(samples, 44);
  return out;
};

// ─── Document templates ──────────────────────────────────────────────────────

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

const CONTAINER_XML = `${XML_DECL}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

interface ChapterRef {
  /** Chapter slug, e.g. `c1` — used for file names and manifest ids. */
  slug: string;
  label: string;
}

const navXhtml = (title: string, chapters: ChapterRef[]): string =>
  `${XML_DECL}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body>
  <nav epub:type="toc">
    <h1>Contents</h1>
    <ol>
${chapters.map((c) => `      <li><a href="text/${c.slug}.xhtml">${c.label}</a></li>`).join('\n')}
    </ol>
  </nav>
</body>
</html>
`;

const chapterXhtml = (label: string, bodyHtml: string): string =>
  `${XML_DECL}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${label}</title></head>
<body>
  <section epub:type="chapter">
${bodyHtml}
  </section>
</body>
</html>
`;

interface SmilPar {
  /** Fragment id in the chapter document, e.g. `s1`. */
  fragment: string;
  /** Audio file name under OEBPS/audio/, e.g. `c1.wav`. */
  audioFile: string;
  clipBegin: number;
  clipEnd: number;
}

const smilDoc = (slug: string, pars: SmilPar[]): string =>
  `${XML_DECL}<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq-${slug}" epub:textref="../text/${slug}.xhtml" epub:type="chapter">
${pars
  .map(
    (par, i) => `      <par id="${slug}-par${i + 1}">
        <text src="../text/${slug}.xhtml#${par.fragment}"/>
        <audio src="../audio/${par.audioFile}" clipBegin="${par.clipBegin}s" clipEnd="${par.clipEnd}s"/>
      </par>`,
  )
  .join('\n')}
    </seq>
  </body>
</smil>
`;

const formatClock = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}`;
};

interface OpfSpec {
  uuid: string;
  title: string;
  chapters: ChapterRef[];
  audioFiles: string[];
  /** Per-chapter-slug overlay duration in seconds; omitted slugs get no meta. */
  overlayDurations: Record<string, number>;
  /** Total duration meta; omit to model partial authoring. */
  totalDuration?: number;
}

const opfDoc = (spec: OpfSpec): string => {
  const durationMetas = Object.entries(spec.overlayDurations)
    .map(
      ([slug, seconds]) =>
        `    <meta property="media:duration" refines="#smil-${slug}">${formatClock(seconds)}</meta>`,
    )
    .join('\n');
  const totalMeta =
    spec.totalDuration === undefined
      ? ''
      : `\n    <meta property="media:duration">${formatClock(spec.totalDuration)}</meta>`;
  const manifest = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    ...spec.chapters.map(
      (c) =>
        `    <item id="chap-${c.slug}" href="text/${c.slug}.xhtml" media-type="application/xhtml+xml" media-overlay="smil-${c.slug}"/>`,
    ),
    ...spec.chapters.map(
      (c) => `    <item id="smil-${c.slug}" href="smil/${c.slug}.smil" media-type="application/smil+xml"/>`,
    ),
    ...spec.audioFiles.map(
      (file, i) => `    <item id="aud-${i + 1}" href="audio/${file}" media-type="audio/wav"/>`,
    ),
  ].join('\n');
  const spine = spec.chapters
    .map((c) => `    <itemref idref="chap-${c.slug}"/>`)
    .join('\n');
  return `${XML_DECL}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${spec.uuid}</dc:identifier>
    <dc:title>${spec.title}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Bookarc E2E</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
${durationMetas}${totalMeta}
    <meta property="media:active-class">${ACTIVE_CLASS}</meta>
    <meta property="media:playback-active-class">${PLAYBACK_ACTIVE_CLASS}</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`;
};

// ─── Packaging ───────────────────────────────────────────────────────────────

/** Zip with the EPUB OCF invariants: `mimetype` first and stored. */
const packEpub = (files: Array<[string, string | Uint8Array]>): Uint8Array => {
  const zippable: Zippable = {
    mimetype: [textToU8('application/epub+zip'), { level: 0, mtime: FIXED_MTIME }],
  };
  for (const [name, data] of files) {
    zippable[name] = [
      typeof data === 'string' ? textToU8(data) : data,
      { level: 9, mtime: FIXED_MTIME },
    ];
  }
  return zipSync(zippable);
};

// ─── Fixture content ─────────────────────────────────────────────────────────

const ORDINALS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

const sentenceText = (chapter: number, index: number): string =>
  `Sentence ${ORDINALS[index]} of chapter ${chapter} narrated aloud for the Bookarc audiobook fixture.`;

const sentenceParagraph = (chapter: number, count: number): string => {
  const spans = Array.from(
    { length: count },
    (_, i) => `<span id="s${i + 1}">${sentenceText(chapter, i)}</span>`,
  );
  return `    <h1>Chapter ${chapter}</h1>\n    <p>${spans.join(' ')}</p>`;
};

const contiguousClips = (
  count: number,
  clipLength: number,
  audioFile: string,
  fragmentPrefix: string,
): SmilPar[] =>
  Array.from({ length: count }, (_, i) => ({
    fragment: `${fragmentPrefix}${i + 1}`,
    audioFile,
    clipBegin: i * clipLength,
    clipEnd: (i + 1) * clipLength,
  }));

export const buildMoSentencesEpub = (): FixtureEpub => {
  const chapters: ChapterRef[] = [
    { slug: 'c1', label: 'Chapter 1' },
    { slug: 'c2', label: 'Chapter 2' },
    { slug: 'c3', label: 'Chapter 3' },
  ];
  const words = [
    'This',
    'final',
    'chapter',
    'highlights',
    'every',
    'single',
    'spoken',
    'word',
    'in',
    'perfect',
    'timing',
    'now',
  ];
  const wordSpans = words.map((word, i) => `<span id="w${i + 1}">${word}</span>`).join(' ');

  // Chapter 2 exercises the multiple-audio-files-per-section path: the first
  // four sentences play from c2a.wav, the rest from c2b.wav, with clip times
  // restarting per file.
  const c2Pars = [
    ...contiguousClips(4, 1.5, 'c2a.wav', 's'),
    ...contiguousClips(4, 1.5, 'c2b.wav', 's').map((par, i) => ({
      ...par,
      fragment: `s${i + 5}`,
    })),
  ];

  const title = 'MO Sentences (Bookarc e2e)';
  const bytes = packEpub([
    ['META-INF/container.xml', CONTAINER_XML],
    [
      'OEBPS/content.opf',
      opfDoc({
        uuid: '3b2a5f04-0000-4000-8000-000000000001',
        title,
        chapters,
        audioFiles: ['c1.wav', 'c2a.wav', 'c2b.wav', 'c3.wav'],
        overlayDurations: { c1: 12, c2: 12, c3: 6 },
        totalDuration: 30,
      }),
    ],
    ['OEBPS/nav.xhtml', navXhtml(title, chapters)],
    ['OEBPS/text/c1.xhtml', chapterXhtml('Chapter 1', sentenceParagraph(1, 8))],
    ['OEBPS/text/c2.xhtml', chapterXhtml('Chapter 2', sentenceParagraph(2, 8))],
    [
      'OEBPS/text/c3.xhtml',
      chapterXhtml('Chapter 3', `    <h1>Chapter 3</h1>\n    <p>${wordSpans}</p>`),
    ],
    ['OEBPS/smil/c1.smil', smilDoc('c1', contiguousClips(8, 1.5, 'c1.wav', 's'))],
    ['OEBPS/smil/c2.smil', smilDoc('c2', c2Pars)],
    ['OEBPS/smil/c3.smil', smilDoc('c3', contiguousClips(12, 0.5, 'c3.wav', 'w'))],
    ['OEBPS/audio/c1.wav', toneWav(Array.from({ length: 8 }, () => 1.5))],
    ['OEBPS/audio/c2a.wav', toneWav(Array.from({ length: 4 }, () => 1.5))],
    ['OEBPS/audio/c2b.wav', toneWav(Array.from({ length: 4 }, () => 1.5))],
    ['OEBPS/audio/c3.wav', toneWav(Array.from({ length: 12 }, () => 0.5))],
  ]);
  return { name: 'mo-sentences.epub', bytes };
};

export const buildMoAudioOnlyEpub = (): FixtureEpub => {
  const chapters: ChapterRef[] = [
    { slug: 'c1', label: 'Chapter 1' },
    { slug: 'c2', label: 'Chapter 2' },
    { slug: 'c3', label: 'Chapter 3' },
  ];
  const title = 'MO Audio Only (Bookarc e2e)';
  const files: Array<[string, string | Uint8Array]> = [
    ['META-INF/container.xml', CONTAINER_XML],
    [
      'OEBPS/content.opf',
      opfDoc({
        uuid: '3b2a5f04-0000-4000-8000-000000000002',
        title,
        chapters,
        audioFiles: ['c1.wav', 'c2.wav', 'c3.wav'],
        overlayDurations: { c1: 10, c2: 10, c3: 10 },
        totalDuration: 30,
      }),
    ],
    ['OEBPS/nav.xhtml', navXhtml(title, chapters)],
  ];
  chapters.forEach((chapter, i) => {
    const n = i + 1;
    files.push(
      [
        `OEBPS/text/${chapter.slug}.xhtml`,
        chapterXhtml(chapter.label, `    <h1 id="t${n}">${chapter.label}</h1>`),
      ],
      [
        `OEBPS/smil/${chapter.slug}.smil`,
        smilDoc(chapter.slug, [
          { fragment: `t${n}`, audioFile: `${chapter.slug}.wav`, clipBegin: 0, clipEnd: 10 },
        ]),
      ],
      [`OEBPS/audio/${chapter.slug}.wav`, toneWav(Array.from({ length: 5 }, () => 2))],
    );
  });
  return { name: 'mo-audio-only.epub', bytes: packEpub(files) };
};

export const buildMoMalformedEpub = (): FixtureEpub => {
  const chapters: ChapterRef[] = [
    { slug: 'c1', label: 'Chapter 1' },
    { slug: 'c2', label: 'Chapter 2' },
    { slug: 'c3', label: 'Chapter 3' },
  ];
  const title = 'MO Malformed (Bookarc e2e)';
  // Chapter 3's SMIL is intentionally truncated mid-document: not well-formed.
  const brokenSmil = `${XML_DECL}<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body>
    <seq id="seq-c3">
      <par id="c3-par1">
        <text src="../text/c3.xhtml#s1"/>
        <audio src="../audio/c1.wav" clipBegin="0s" clipEnd="1.5s"/>
`;
  const bytes = packEpub([
    ['META-INF/container.xml', CONTAINER_XML],
    [
      'OEBPS/content.opf',
      opfDoc({
        uuid: '3b2a5f04-0000-4000-8000-000000000003',
        title,
        chapters,
        audioFiles: ['c1.wav'],
        // Partial authoring on purpose: only chapter 1 declares a duration.
        overlayDurations: { c1: 6 },
      }),
    ],
    ['OEBPS/nav.xhtml', navXhtml(title, chapters)],
    ['OEBPS/text/c1.xhtml', chapterXhtml('Chapter 1', sentenceParagraph(1, 4))],
    ['OEBPS/text/c2.xhtml', chapterXhtml('Chapter 2', sentenceParagraph(2, 2))],
    ['OEBPS/text/c3.xhtml', chapterXhtml('Chapter 3', sentenceParagraph(3, 2))],
    ['OEBPS/smil/c1.smil', smilDoc('c1', contiguousClips(4, 1.5, 'c1.wav', 's'))],
    // Chapter 2 references audio that is absent from the package.
    ['OEBPS/smil/c2.smil', smilDoc('c2', contiguousClips(2, 1.5, 'missing.wav', 's'))],
    ['OEBPS/smil/c3.smil', brokenSmil],
    ['OEBPS/audio/c1.wav', toneWav(Array.from({ length: 4 }, () => 1.5))],
  ]);
  return { name: 'mo-malformed.epub', bytes };
};

export const buildAllAudiobookFixtures = (): FixtureEpub[] => [
  buildMoSentencesEpub(),
  buildMoAudioOnlyEpub(),
  buildMoMalformedEpub(),
];
