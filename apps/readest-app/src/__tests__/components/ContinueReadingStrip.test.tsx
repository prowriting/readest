import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_m, name) => String(options[name] ?? ''));
  },
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/utils/nav', () => ({
  navigateToReader: vi.fn(),
}));

vi.mock('@/components/BookCover', () => ({
  default: () => <div data-testid='cover' />,
}));

vi.mock('@/store/libraryStore', async () => {
  const { create } = await import('zustand');
  return { useLibraryStore: create(() => ({ visibleLibrary: [] as Book[] })) };
});

vi.mock('@/store/settingsStore', async () => {
  const { create } = await import('zustand');
  return { useSettingsStore: create(() => ({ settings: { lastOpenBooks: [] as string[] } })) };
});

import ContinueReadingStrip from '@/components/navigation/ContinueReadingStrip';
import { navigateToReader } from '@/utils/nav';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

const makeBook = (over: Partial<Book>): Book =>
  ({
    hash: 'h',
    format: 'EPUB',
    title: 'Untitled',
    author: 'Anon',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as Book;

const setState = (lastOpenBooks: string[], visibleLibrary: Book[]) => {
  // The store is mocked at runtime; cast the partial state we inject since the
  // compiler still sees the real (fully-typed) store module.
  useSettingsStore.setState({ settings: { lastOpenBooks } } as never);
  useLibraryStore.setState({ visibleLibrary } as never);
};

describe('ContinueReadingStrip', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setState([], []);
  });

  it('renders nothing when no book has been opened', () => {
    setState([], [makeBook({ hash: 'a', title: 'A' })]);
    const { container } = render(<ContinueReadingStrip />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the most recently opened book that still exists in the library', () => {
    const midnight = makeBook({ hash: 'mid', title: 'The Midnight Library', author: 'Matt Haig' });
    setState(['mid', 'gone'], [midnight]);

    render(<ContinueReadingStrip />);

    expect(screen.getByText('Continue reading')).toBeTruthy();
    expect(screen.getByText('The Midnight Library')).toBeTruthy();
  });

  it('skips lastOpenBooks entries that are no longer in the library', () => {
    const dune = makeBook({ hash: 'dune', title: 'Dune' });
    // 'deleted' is first in recency order but absent from the visible library.
    setState(['deleted', 'dune'], [dune]);

    render(<ContinueReadingStrip />);

    expect(screen.getByText('Dune')).toBeTruthy();
  });

  it('opens the book in the reader when tapped', () => {
    const dune = makeBook({ hash: 'dune', title: 'Dune' });
    setState(['dune'], [dune]);

    render(<ContinueReadingStrip />);
    fireEvent.click(screen.getByRole('button', { name: /continue reading/i }));

    expect(navigateToReader).toHaveBeenCalledTimes(1);
    expect(navigateToReader).toHaveBeenCalledWith(expect.anything(), ['dune']);
  });
});
