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
  detectKindle: vi.fn(),
  prepareFireKindleFile: vi.fn(),
  sendToKindleApp: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks.appService }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/kindle', async (original) => ({
  ...(await original<typeof import('@/services/kindle')>()),
  shareKindleFile: mocks.shareKindleFile,
}));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: mocks.dispatch } }));
vi.mock('@/utils/bridge', () => ({
  detectKindle: mocks.detectKindle,
  sendToKindleApp: mocks.sendToKindleApp,
}));
vi.mock('@/services/fireKindle', () => ({ prepareFireKindleFile: mocks.prepareFireKindleFile }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => undefined }));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));

function Harness({ load }: { load: () => Promise<File | null> }) {
  const kindle = useSendToKindle();
  return (
    <>
      <button
        onClick={() =>
          kindle.sendToKindle({ id: 'book', title: 'Book', format: 'EPUB', loadOriginal: load })
        }
      >
        Send
      </button>
      <SendToKindleDialog file={kindle.file} source={kindle.fireSource} onClose={kindle.close} />
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
    mocks.appService.isAndroidApp = false;
    mocks.detectKindle.mockResolvedValue({ isFire: false, hasKindle: true, hasKindleFs: false });
    mocks.shareKindleFile.mockResolvedValue(undefined);
  });

  it('explains upload for an imported Fire book before reading any bytes', async () => {
    mocks.appService.isIOSApp = false;
    mocks.appService.isAndroidApp = true;
    mocks.detectKindle.mockResolvedValue({ isFire: true, hasKindle: true, hasKindleFs: false });
    const load = vi.fn().mockResolvedValue(file);
    render(<Harness load={load} />);
    fireEvent.click(screen.getByText('Send'));
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(load).not.toHaveBeenCalled();
    expect(mocks.shareKindleFile).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('retains native file sharing on non-Fire Android devices', async () => {
    mocks.appService.isIOSApp = false;
    mocks.appService.isAndroidApp = true;
    render(<Harness load={vi.fn().mockResolvedValue(file)} />);
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(mocks.shareKindleFile).toHaveBeenCalledWith(mocks.appService, file));
    expect(screen.queryByRole('button', { name: 'Save file' })).toBeNull();
  });

  it('can retry a cancelled Books folder picker and reports saving separately from delivery', async () => {
    mocks.prepareFireKindleFile.mockResolvedValue({
      path: '/data/book.mobi',
      exportKey: 'key',
      fileSha256: 'digest',
    });
    mocks.sendToKindleApp
      .mockResolvedValueOnce({ cancelled: true })
      .mockResolvedValueOnce({ cancelled: false, kindleOpened: true });
    const loadOriginal = vi.fn();
    render(
      <SendToKindleDialog
        file={null}
        source={{
          id: 'gift',
          title: 'Gift',
          format: 'EPUB',
          delivery: { receipt: 'receipt', sourceSha256: 'digest' },
          loadOriginal,
        }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save to Books' }));
    await waitFor(() => expect(mocks.sendToKindleApp).toHaveBeenCalledOnce());
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save to Books' }));
    expect((await screen.findByRole('status')).textContent).toContain('File saved to Books.');
    expect(loadOriginal).not.toHaveBeenCalled();
    expect(mocks.sendToKindleApp).toHaveBeenLastCalledWith(
      '/data/book.mobi',
      'Gift',
      'key',
      'digest',
    );
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
