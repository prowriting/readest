import { describe, expect, it } from 'vitest';
import { hasMediaOverlay } from '@/utils/audiobook';

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
