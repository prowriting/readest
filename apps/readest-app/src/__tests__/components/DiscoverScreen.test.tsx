import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoverBook, DiscoverRow } from '@/services/catalog';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_m, name) => String(options[name] ?? ''));
  },
}));

const useDiscoverMock = vi.fn();
vi.mock('@/hooks/useDiscover', () => ({
  useDiscover: () => useDiscoverMock(),
}));

import DiscoverScreen from '@/app/discover/components/DiscoverScreen';

const book: DiscoverBook = {
  id: 'gutenberg:2',
  title: 'Great Novel',
  authors: ['Eliot, George'],
  cover_url: 'https://x/2.jpg',
  is_free: true,
};
const row: DiscoverRow = {
  id: 'popular_classics',
  kind: 'popular_classics',
  title: 'Free classics',
  query: { sort: 'popular' },
  books: [book],
};

describe('DiscoverScreen', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders server rows with covers, titles, authors and a See all link', () => {
    useDiscoverMock.mockReturnValue({ rows: [row], status: 'fresh', reload: vi.fn() });
    render(<DiscoverScreen onOpenBook={vi.fn()} onSeeAll={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Free classics' })).toBeTruthy();
    expect(screen.getByText('Great Novel')).toBeTruthy();
    expect(screen.getByText('Eliot, George')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'See all in Free classics' })).toBeTruthy();
  });

  it('shows the "updated" freshness state when content is fresh', () => {
    useDiscoverMock.mockReturnValue({ rows: [row], status: 'fresh', reload: vi.fn() });
    render(<DiscoverScreen onOpenBook={vi.fn()} onSeeAll={vi.fn()} />);
    expect(screen.getByText(/updated just now/i)).toBeTruthy();
  });

  it('shows the "saved picks" freshness state when content is cached', () => {
    useDiscoverMock.mockReturnValue({ rows: [row], status: 'cached', reload: vi.fn() });
    render(<DiscoverScreen onOpenBook={vi.fn()} onSeeAll={vi.fn()} />);
    expect(screen.getByText(/saved picks/i)).toBeTruthy();
  });

  it('opens the book details when a cover is tapped', () => {
    const onOpenBook = vi.fn();
    useDiscoverMock.mockReturnValue({ rows: [row], status: 'fresh', reload: vi.fn() });
    render(<DiscoverScreen onOpenBook={onOpenBook} onSeeAll={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Great Novel' }));
    expect(onOpenBook).toHaveBeenCalledWith(book);
  });

  it('triggers See all for the row', () => {
    const onSeeAll = vi.fn();
    useDiscoverMock.mockReturnValue({ rows: [row], status: 'fresh', reload: vi.fn() });
    render(<DiscoverScreen onOpenBook={vi.fn()} onSeeAll={onSeeAll} />);

    fireEvent.click(screen.getByRole('button', { name: 'See all in Free classics' }));
    expect(onSeeAll).toHaveBeenCalledWith(row);
  });

  it('offers a retry from the empty state', () => {
    const reload = vi.fn();
    useDiscoverMock.mockReturnValue({ rows: [], status: 'empty', reload });
    render(<DiscoverScreen onOpenBook={vi.fn()} onSeeAll={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(reload).toHaveBeenCalled();
  });
});
