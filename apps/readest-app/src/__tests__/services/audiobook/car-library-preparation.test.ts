import { describe, expect, it } from 'vitest';
import { buildCarChapters } from '@/services/audiobook/carLibraryPreparation';
import type { BookDoc } from '@/libs/document';

describe('buildCarChapters', () => {
  it('flattens nested TOC entries and falls back for overlay sections not represented in the TOC', () => {
    const bookDoc = {
      toc: [
        {
          label: 'Part One',
          href: 'text/one.xhtml',
          subitems: [{ label: 'Chapter Two', href: 'text/two.xhtml' }],
        },
      ],
      sections: [
        { id: 'text/one.xhtml', mediaOverlay: {} },
        { id: 'text/two.xhtml', mediaOverlay: {} },
        { id: 'text/three.xhtml', mediaOverlay: {} },
      ],
      splitTOCHref: (href: string) => [href],
    } as unknown as BookDoc;

    expect(buildCarChapters(bookDoc)).toEqual([
      { index: 0, label: 'Part One' },
      { index: 1, label: 'Chapter Two' },
      { index: 2, label: 'Chapter 3' },
    ]);
  });
});
