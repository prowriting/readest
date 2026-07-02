import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoverBook } from '@/services/catalog';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_m, name) => String(options[name] ?? ''));
  },
}));

const {
  acquireCatalogBook,
  navigateToReader,
  dispatch,
  fetchCatalogBook,
  queueUpload,
  authState,
  settingsState,
} = vi.hoisted(() => ({
  acquireCatalogBook: vi.fn(),
  navigateToReader: vi.fn(),
  dispatch: vi.fn(),
  fetchCatalogBook: vi.fn(),
  queueUpload: vi.fn(),
  authState: { user: null as { id: string } | null },
  settingsState: { settings: { autoUpload: true } },
}));
vi.mock('@/services/catalogAcquire', () => ({
  acquireCatalogBook: (...args: unknown[]) => acquireCatalogBook(...args),
}));
vi.mock('@/services/catalog', () => ({
  fetchCatalogBook: (...args: unknown[]) => fetchCatalogBook(...args),
  parseDiscoverBookId: (id: string) => {
    const i = id.indexOf(':');
    return i > 0 ? { source: id.slice(0, i), sourceId: id.slice(i + 1) } : null;
  },
}));
vi.mock('@/utils/nav', () => ({ navigateToReader }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { saveLibraryBooks: vi.fn() } }),
}));
vi.mock('@/store/libraryStore', async () => {
  const { create } = await import('zustand');
  return { useLibraryStore: create(() => ({ library: [], setLibrary: vi.fn() })) };
});
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role='dialog'>{children}</div> : null,
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => settingsState }));
vi.mock('@/services/transferManager', () => ({ transferManager: { queueUpload } }));

import CatalogBookDetail from '@/app/discover/components/CatalogBookDetail';

const book: DiscoverBook = {
  id: 'gutenberg:1661',
  title: 'The Adventures of Sherlock Holmes',
  authors: ['Doyle, Arthur Conan'],
  cover_url: 'https://x/cover.jpg',
  categories: [{ id: 'mystery', name: 'Mystery' }],
  rating_average: 4.5,
  rating_count: 1652,
  is_free: true,
};

describe('CatalogBookDetail', () => {
  beforeEach(() => {
    authState.user = { id: 'u1' };
    settingsState.settings = { autoUpload: true };
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the book details, authors and rating when present', () => {
    render(<CatalogBookDetail book={book} onClose={vi.fn()} />);
    expect(screen.getByText('The Adventures of Sherlock Holmes')).toBeTruthy();
    expect(screen.getByText('Doyle, Arthur Conan')).toBeTruthy();
    expect(screen.getByText('4.5')).toBeTruthy();
    expect(screen.getByText('Mystery')).toBeTruthy();
  });

  it('resolves the book by id and adds it to the library', async () => {
    const full = { source: 'gutenberg', sourceId: '1661', formats: [] };
    fetchCatalogBook.mockResolvedValueOnce(full);
    acquireCatalogBook.mockResolvedValueOnce({ hash: 'abc', title: book.title });

    render(<CatalogBookDetail book={book} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Library' }));

    await waitFor(() => expect(fetchCatalogBook).toHaveBeenCalledWith('gutenberg', '1661'));
    await waitFor(() => expect(acquireCatalogBook.mock.calls[0]![0]).toBe(full));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'success' })),
    );
  });

  it('downloads then opens the reader on "Read now"', async () => {
    fetchCatalogBook.mockResolvedValueOnce({ source: 'gutenberg', sourceId: '1661', formats: [] });
    acquireCatalogBook.mockResolvedValueOnce({ hash: 'xyz', title: book.title });

    render(<CatalogBookDetail book={book} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Read now' }));

    await waitFor(() => expect(navigateToReader).toHaveBeenCalledWith(expect.anything(), ['xyz']));
  });

  it('queues a cloud upload for the acquired book when logged in with autoUpload on', async () => {
    const imported = { hash: 'abc', title: book.title, uploadedAt: null };
    fetchCatalogBook.mockResolvedValueOnce({ source: 'gutenberg', sourceId: '1661', formats: [] });
    acquireCatalogBook.mockResolvedValueOnce(imported);

    render(<CatalogBookDetail book={book} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Library' }));

    await waitFor(() => expect(queueUpload).toHaveBeenCalledWith(imported));
  });

  it('does not upload when the user is logged out', async () => {
    authState.user = null;
    fetchCatalogBook.mockResolvedValueOnce({ source: 'gutenberg', sourceId: '1661', formats: [] });
    acquireCatalogBook.mockResolvedValueOnce({ hash: 'abc', title: book.title, uploadedAt: null });

    render(<CatalogBookDetail book={book} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Library' }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'success' })),
    );
    expect(queueUpload).not.toHaveBeenCalled();
  });

  it('does not upload when autoUpload is disabled', async () => {
    settingsState.settings = { autoUpload: false };
    fetchCatalogBook.mockResolvedValueOnce({ source: 'gutenberg', sourceId: '1661', formats: [] });
    acquireCatalogBook.mockResolvedValueOnce({ hash: 'abc', title: book.title, uploadedAt: null });

    render(<CatalogBookDetail book={book} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Library' }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'success' })),
    );
    expect(queueUpload).not.toHaveBeenCalled();
  });

  it('surfaces an error if the download fails', async () => {
    fetchCatalogBook.mockResolvedValueOnce({ source: 'gutenberg', sourceId: '1661', formats: [] });
    acquireCatalogBook.mockRejectedValueOnce(new Error('boom'));

    render(<CatalogBookDetail book={book} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Library' }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'error' })),
    );
  });
});
