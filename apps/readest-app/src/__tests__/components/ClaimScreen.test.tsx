import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_m, name) => String(options[name] ?? ''));
  },
}));

const { fetchBookByCode, dispatch, FakeBookCodeError } = vi.hoisted(() => {
  class FakeBookCodeError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { fetchBookByCode: vi.fn(), dispatch: vi.fn(), FakeBookCodeError };
});
vi.mock('@/services/bookCode', () => ({
  fetchBookByCode,
  BookCodeError: FakeBookCodeError,
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch },
}));

import ClaimScreen from '@/app/claim/components/ClaimScreen';

const codeInput = () => screen.getByLabelText('Claim code') as HTMLInputElement;
const claimButton = () => screen.getByRole('button', { name: 'Claim book' });

describe('ClaimScreen', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('explains claiming and shows the 7-character code field and button', () => {
    render(<ClaimScreen />);
    expect(screen.getByRole('heading', { name: 'Claim a book' })).toBeTruthy();
    expect(screen.getByText(/code an author sent/i)).toBeTruthy();
    expect(codeInput().getAttribute('placeholder')).toBe('FBC83A2');
    expect(claimButton()).toBeTruthy();
  });

  it('auto-uppercases, accepts the server claim alphabet, and caps at 7 characters', () => {
    render(<ClaimScreen />);
    fireEvent.change(codeInput(), { target: { value: 'fb-c8!3a2xyz' } });
    expect(codeInput().value).toBe('FBC83A2');
  });

  it('rejects an invalid-format code inline without calling the server', () => {
    render(<ClaimScreen />);
    fireEvent.change(codeInput(), { target: { value: 'ABC' } });
    fireEvent.click(claimButton());

    expect(fetchBookByCode).not.toHaveBeenCalled();
    expect(screen.getByText(/7 letters or numbers/i)).toBeTruthy();
  });

  it('redeems a valid code and hands the found book to the existing dialog', async () => {
    const result = { downloadRef: 'ref', book: { title: 'Gifted', author: 'Author' } };
    fetchBookByCode.mockResolvedValueOnce(result);

    render(<ClaimScreen />);
    fireEvent.change(codeInput(), { target: { value: 'fbc83a2' } });
    fireEvent.click(claimButton());

    await waitFor(() => expect(fetchBookByCode).toHaveBeenCalledWith('FBC83A2'));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith('book-code-found', { result }));
  });

  it('shows a "not found" error for an unknown code', async () => {
    fetchBookByCode.mockRejectedValueOnce(new FakeBookCodeError(404, 'nope'));

    render(<ClaimScreen />);
    fireEvent.change(codeInput(), { target: { value: 'ABCDEFG' } });
    fireEvent.click(claimButton());

    expect(await screen.findByText(/wasn't found|not found/i)).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('shows an "already claimed" error for a used code', async () => {
    fetchBookByCode.mockRejectedValueOnce(new FakeBookCodeError(409, 'used'));

    render(<ClaimScreen />);
    fireEvent.change(codeInput(), { target: { value: 'ABCDEFG' } });
    fireEvent.click(claimButton());

    expect(await screen.findByText(/already been claimed/i)).toBeTruthy();
  });
});
