import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogBookResult, DiscoverRow } from '@/services/catalog';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_m, name) => String(options[name] ?? ''));
  },
}));

const searchCatalog = vi.fn();
vi.mock('@/services/catalog', () => ({
  searchCatalog: (...args: unknown[]) => searchCatalog(...args),
}));

const themeState = {
  safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  statusBarHeight: 24,
  systemUIVisible: true,
};
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => themeState,
}));

import SeeAllOverlay from '@/app/discover/components/SeeAllOverlay';

const row: DiscoverRow = {
  id: 'popular_in_fiction',
  kind: 'popular_in_category',
  title: 'Popular in Fiction',
  category: { id: 'fiction', name: 'Fiction' },
  query: { topic: 'Fiction', sort: 'popular' },
  books: [],
};

const results: CatalogBookResult[] = [
  {
    source: 'gutenberg',
    sourceId: '100',
    title: 'Moby Dick',
    author: 'Herman Melville',
    description: 'A whale of a tale',
    downloadCount: 999,
    coverUrl: 'https://x/100.jpg',
    formats: [{ mimeType: 'application/epub+zip', url: 'https://x/100.epub' }],
  },
];

describe('SeeAllOverlay', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lists every book in the row by replaying its query', async () => {
    searchCatalog.mockResolvedValue({ results, total: 1, page: 1, pageSize: 50 });

    render(<SeeAllOverlay row={row} onBack={vi.fn()} onOpenBook={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Popular in Fiction' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Moby Dick')).toBeTruthy());
    expect(searchCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'Fiction', sort: 'popular' }),
    );
  });

  it('offsets its header below the status bar via the top safe-area inset', () => {
    searchCatalog.mockResolvedValue({ results, total: 1, page: 1, pageSize: 50 });
    // Android reports a 0 top inset but the status bar still occupies 24px of
    // system UI; the overlay must clear it so the back arrow is not obscured.
    themeState.safeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    themeState.statusBarHeight = 24;
    themeState.systemUIVisible = true;

    const { container } = render(<SeeAllOverlay row={row} onBack={vi.fn()} onOpenBook={vi.fn()} />);

    const overlay = container.firstChild as HTMLElement;
    expect(overlay.style.paddingTop).toBe('24px');
  });

  it('returns to Discover via the back control', () => {
    searchCatalog.mockResolvedValue({ results, total: 1, page: 1, pageSize: 50 });
    const onBack = vi.fn();
    render(<SeeAllOverlay row={row} onBack={onBack} onOpenBook={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('opens a book when its row is tapped', async () => {
    searchCatalog.mockResolvedValue({ results, total: 1, page: 1, pageSize: 50 });
    const onOpenBook = vi.fn();
    render(<SeeAllOverlay row={row} onBack={vi.fn()} onOpenBook={onOpenBook} />);

    await waitFor(() => expect(screen.getByText('Moby Dick')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Open Moby Dick' }));

    expect(onOpenBook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gutenberg:100', description: 'A whale of a tale' }),
    );
  });

  it('filters within the category via the scoped search', async () => {
    searchCatalog.mockResolvedValue({ results, total: 1, page: 1, pageSize: 50 });
    render(<SeeAllOverlay row={row} onBack={vi.fn()} onOpenBook={vi.fn()} />);
    await waitFor(() => expect(searchCatalog).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Search Popular in Fiction'), {
      target: { value: 'moby' },
    });

    await waitFor(() =>
      expect(searchCatalog).toHaveBeenCalledWith(expect.objectContaining({ q: 'moby' })),
    );
  });
});
