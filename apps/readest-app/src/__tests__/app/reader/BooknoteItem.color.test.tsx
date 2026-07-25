import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import type { BookNote } from '@/types/book';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';

vi.mock('dayjs', () => ({
  default: () => ({ fromNow: () => 'just now' }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        // Persisted settings from an existing install: no concept slugs here.
        customHighlightColors: { yellow: '#ffff00' },
      },
    },
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => null,
    saveConfig: vi.fn(),
    updateBooknotes: vi.fn(),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getProgress: () => null,
    getView: () => null,
    getViewsById: () => [],
  }),
}));

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({
    setNotebookEditAnnotation: vi.fn(),
    setNotebookVisible: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/app/reader/hooks/useScrollToItem', () => ({
  default: () => ({ isCurrent: false, viewRef: { current: null } }),
}));

import BooknoteItem from '@/app/reader/components/sidebar/BooknoteItem';

const makeNote = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'note-1',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2)',
  text: 'highlighted passage',
  style: 'highlight',
  color: 'useful',
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe('BooknoteItem highlight color', () => {
  it('resolves a concept slug to its hex instead of emitting the slug as a CSS color', () => {
    const { container } = render(<BooknoteItem bookKey='book-1' item={makeNote()} />);
    const span = container.querySelector('.booknote-text') as HTMLElement;
    const bg = span.style.backgroundColor;
    expect(bg).toContain(HIGHLIGHT_COLOR_HEX['useful']!);
    expect(bg).not.toContain('srgb, useful');
  });

  it('still honors user-customized hexes for legacy named colors', () => {
    const { container } = render(
      <BooknoteItem bookKey='book-1' item={makeNote({ color: 'yellow' })} />,
    );
    const span = container.querySelector('.booknote-text') as HTMLElement;
    expect(span.style.backgroundColor).toContain('#ffff00');
  });
});
