import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibraryEmptyState from '@/app/library/components/LibraryEmptyState';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

const useAuthMock = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

const navigateToLoginMock = vi.fn();
const navigateToDiscoverMock = vi.fn();
const navigateToClaimMock = vi.fn();
const routerStub = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => routerStub,
}));
vi.mock('@/utils/nav', () => ({
  navigateToLogin: (...args: unknown[]) => navigateToLoginMock(...args),
  navigateToDiscover: (...args: unknown[]) => navigateToDiscoverMock(...args),
  navigateToClaim: (...args: unknown[]) => navigateToClaimMock(...args),
}));

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
  navigateToLoginMock.mockReset();
  navigateToDiscoverMock.mockReset();
  navigateToClaimMock.mockReset();
});

describe('LibraryEmptyState', () => {
  it('renders the heading and the three inline action links plus sync when logged out', () => {
    useAuthMock.mockReturnValue({ user: null });
    render(<LibraryEmptyState onImport={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Start your library' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'importing a book' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'discovering a book in our library' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'claim code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in to sync your library' })).toBeTruthy();
  });

  it('leaves no [[token]] markers in the rendered sentence', () => {
    useAuthMock.mockReturnValue({ user: null });
    const { container } = render(<LibraryEmptyState onImport={vi.fn()} />);

    expect(container.textContent).not.toMatch(/\[\[|\]\]/);
  });

  it('hides the sync button when the user is logged in', () => {
    useAuthMock.mockReturnValue({ user: { id: 'stub-user' } });
    render(<LibraryEmptyState onImport={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'importing a book' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in to sync your library' })).toBeNull();
  });

  it('wires each inline link to its action', () => {
    useAuthMock.mockReturnValue({ user: null });
    const handleImport = vi.fn();
    render(<LibraryEmptyState onImport={handleImport} />);

    fireEvent.click(screen.getByRole('button', { name: 'importing a book' }));
    expect(handleImport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'discovering a book in our library' }));
    expect(navigateToDiscoverMock).toHaveBeenCalledWith(routerStub);

    fireEvent.click(screen.getByRole('button', { name: 'claim code' }));
    expect(navigateToClaimMock).toHaveBeenCalledWith(routerStub);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in to sync your library' }));
    expect(navigateToLoginMock).toHaveBeenCalledWith(routerStub);
  });
});
