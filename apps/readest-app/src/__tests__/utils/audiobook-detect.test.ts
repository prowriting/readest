import { describe, expect, it } from 'vitest';
import { findTapFragment, hasMediaOverlay } from '@/utils/audiobook';

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
