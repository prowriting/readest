import { describe, expect, it } from 'vitest';
import {
  detectAudioOnly,
  findTapFragment,
  fragmentFromCfi,
  hasMediaOverlay,
} from '@/utils/audiobook';

describe('hasMediaOverlay', () => {
  it('detects a book where any section carries a media overlay', () => {
    const bookDoc = {
      sections: [{}, { mediaOverlay: { href: 'smil/c2.smil' } }],
    };
    expect(hasMediaOverlay(bookDoc)).toBe(true);
  });

  it('rejects a plain ebook with no overlays', () => {
    expect(hasMediaOverlay({ sections: [{}, {}] })).toBe(false);
  });

  it('tolerates missing or empty sections (PDF/CBZ-style documents)', () => {
    expect(hasMediaOverlay({})).toBe(false);
    expect(hasMediaOverlay({ sections: [] })).toBe(false);
    expect(hasMediaOverlay({ sections: [undefined] })).toBe(false);
  });

  it('ignores null overlay markers', () => {
    expect(hasMediaOverlay({ sections: [{ mediaOverlay: null }] })).toBe(false);
  });
});

describe('findTapFragment', () => {
  const buildDoc = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

  it('returns the id of the tapped element itself', () => {
    const doc = buildDoc('<p><span id="s3">Sentence three</span></p>');
    expect(findTapFragment(doc.getElementById('s3'))).toBe('s3');
  });

  it('walks up to the nearest ancestor with an id', () => {
    const doc = buildDoc('<p><span id="s5">Sentence <em>five</em></span></p>');
    expect(findTapFragment(doc.querySelector('em'))).toBe('s5');
  });

  it('returns null when no ancestor carries an id', () => {
    const doc = buildDoc('<p><span>plain text</span></p>');
    expect(findTapFragment(doc.querySelector('span'))).toBe(null);
    expect(findTapFragment(null)).toBe(null);
  });

  it('ignores ids on body and html elements', () => {
    const doc = buildDoc('<body id="book-body"><p>text</p></body>');
    expect(findTapFragment(doc.querySelector('p'))).toBe(null);
  });
});

describe('fragmentFromCfi', () => {
  it('recovers the innermost id assertion from a CFI', () => {
    expect(fragmentFromCfi('epubcfi(/6/8!/4/2[chapter]/2[s3],/1:0,/1:12)')).toBe('s3');
    expect(fragmentFromCfi('epubcfi(/6/12!/4/2/24[w7]/1:0)')).toBe('w7');
  });

  it('returns null when the CFI carries no id assertions', () => {
    expect(fragmentFromCfi('epubcfi(/6/8!/4/2/2/1:0)')).toBe(null);
    expect(fragmentFromCfi('')).toBe(null);
  });

  it('ignores side-bias and text-assertion brackets', () => {
    // Character offsets may carry [text;s=b] style assertions — not element ids.
    expect(fragmentFromCfi('epubcfi(/6/8!/4/2[s5]/1:3[;s=a])')).toBe('s5');
  });
});

describe('detectAudioOnly', () => {
  const section = (text: string, overlay = true, linear?: string) => ({
    mediaOverlay: overlay ? { href: 'x.smil' } : undefined,
    linear,
    createDocument: async () =>
      new DOMParser().parseFromString(`<html><body>${text}</body></html>`, 'text/html'),
  });
  const prose = 'Sentence one of chapter narrated aloud for the fixture. '.repeat(8);

  it('classifies title-only overlay chapters as audio-only', async () => {
    const bookDoc = {
      sections: [
        section('<h1>Chapter 1</h1>'),
        section('<h1>Chapter 2</h1>'),
        section('<h1>Chapter 3</h1>'),
      ],
    };
    expect(await detectAudioOnly(bookDoc)).toBe(true);
  });

  it('classifies prose read-along chapters as text books', async () => {
    const bookDoc = { sections: [section(prose), section(prose), section(prose)] };
    expect(await detectAudioOnly(bookDoc)).toBe(false);
  });

  it('requires overlays on (nearly) the whole spine', async () => {
    const bookDoc = {
      sections: [section('<h1>Intro</h1>'), section(prose, false), section(prose, false)],
    };
    expect(await detectAudioOnly(bookDoc)).toBe(false);
  });

  it('ignores non-linear sections when judging coverage', async () => {
    const bookDoc = {
      sections: [
        section(prose, false, 'no'), // cover page outside the reading order
        section('<h1>Chapter 1</h1>'),
        section('<h1>Chapter 2</h1>'),
      ],
    };
    expect(await detectAudioOnly(bookDoc)).toBe(true);
  });

  it('never throws on empty or unreadable books', async () => {
    expect(await detectAudioOnly({})).toBe(false);
    expect(await detectAudioOnly({ sections: [] })).toBe(false);
    expect(
      await detectAudioOnly({
        sections: [
          {
            mediaOverlay: {},
            createDocument: async () => {
              throw new Error('corrupt');
            },
          },
        ],
      }),
    ).toBe(false);
  });
});
