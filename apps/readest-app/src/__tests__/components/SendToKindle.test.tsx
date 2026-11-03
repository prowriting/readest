import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSendToKindle } from '@/hooks/useSendToKindle';
import SendToKindleDialog from '@/components/SendToKindleDialog';
import SelectModeActions from '@/app/library/components/SelectModeActions';
import type { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({
  appService: { isMobileApp: true, isIOSApp: true, isAndroidApp: false, saveFile: vi.fn() },
  shareKindleFile: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks.appService }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/kindle', async (original) => ({
  ...(await original<typeof import('@/services/kindle')>()),
  shareKindleFile: mocks.shareKindleFile,
}));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: mocks.dispatch } }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => undefined }));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));

function Harness({ load }: { load: () => Promise<File | null> }) {
  const kindle = useSendToKindle();
  return (
    <>
      <button onClick={() => kindle.sendToKindle(load)}>Send</button>
      <SendToKindleDialog file={kindle.file} onClose={kindle.close} />
    </>
  );
}
const file = new File(['watermark'], 'Book.epub', { type: 'application/epub+zip' });

describe('Kindle handoff', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appService.isMobileApp = true;
    mocks.appService.isIOSApp = true;
    mocks.shareKindleFile.mockResolvedValue(undefined);
  });

  it('blocks repeated taps during preparation and does not announce delivery on dismissal', async () => {
    let finish: ((file: File) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<File>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Harness load={load} />);
    fireEvent.click(screen.getByText('Send'));
    fireEvent.click(screen.getByText('Send'));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => finish?.(file));
    expect(mocks.shareKindleFile).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('allows retry after a share failure', async () => {
    mocks.shareKindleFile.mockRejectedValueOnce(new Error('Share failed'));
    const load = vi.fn().mockResolvedValue(file);
    render(<Harness load={load} />);
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ type: 'error' }),
      ),
    );
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(mocks.shareKindleFile).toHaveBeenCalledTimes(2));
  });

  it('treats native share cancellation as neutral and allows another attempt', async () => {
    mocks.shareKindleFile.mockRejectedValueOnce('Share cancelled');
    render(<Harness load={vi.fn().mockResolvedValue(file)} />);
    fireEvent.click(screen.getByText('Send'));
    await act(async () => {});
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'error' }),
    );
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(mocks.shareKindleFile).toHaveBeenCalledTimes(2));
  });

  it('requires an explicit save and website step on desktop; cancelling the save permits retry', async () => {
    mocks.appService.isMobileApp = false;
    mocks.appService.isIOSApp = false;
    mocks.appService.saveFile.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    // jsdom File lacks arrayBuffer.
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new ArrayBuffer(4),
      configurable: true,
    });
    render(<Harness load={vi.fn().mockResolvedValue(file)} />);
    fireEvent.click(screen.getByText('Send'));
    const open = await screen.findByRole('button', { name: 'Open Send to Kindle' });
    expect(open.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }));
    await waitFor(() => expect(mocks.appService.saveFile).toHaveBeenCalledTimes(1));
    expect(open.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }));
    await waitFor(() => expect(open.hasAttribute('disabled')).toBe(false));
    expect(mocks.shareKindleFile).not.toHaveBeenCalled();
  });
});

describe('library Kindle action', () => {
  afterEach(cleanup);
  const book: Book = {
    hash: 'a'.repeat(32),
    title: 'Book',
    author: 'Author',
    format: 'EPUB',
    createdAt: 1,
    updatedAt: 1,
    downloadedAt: 1,
  };
  const props = {
    safeAreaBottom: 0,
    onOpen: vi.fn(),
    onGroup: vi.fn(),
    onDetails: vi.fn(),
    onStatus: vi.fn(),
    onDelete: vi.fn(),
    onCancel: vi.fn(),
    onSendToKindle: vi.fn(),
  };
  it('offers one eligible selection and hides the action for multiple selections', () => {
    const { rerender } = render(
      <SelectModeActions {...props} selectedBooks={[book.hash]} kindleBook={book} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send to Kindle' }));
    expect(props.onSendToKindle).toHaveBeenCalledTimes(1);
    rerender(
      <SelectModeActions
        {...props}
        selectedBooks={[book.hash, 'b'.repeat(32)]}
        kindleBook={book}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Send to Kindle' })).toBeNull();
  });
  it('disables a cloud-only selection with download guidance', () => {
    render(
      <SelectModeActions
        {...props}
        selectedBooks={[book.hash]}
        kindleBook={{ ...book, downloadedAt: null }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send to Kindle' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText('Download this book first')).toBeTruthy();
  });
});
