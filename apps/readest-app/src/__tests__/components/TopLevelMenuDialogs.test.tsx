import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controls the two store flags the component reads via selectors.
const state = vi.hoisted(() => ({ settingsOpen: false, transferOpen: false }));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (s: { isSettingsDialogOpen: boolean }) => unknown) =>
    selector({ isSettingsDialogOpen: state.settingsOpen }),
}));
vi.mock('@/store/transferStore', () => ({
  useTransferStore: (selector: (s: { isTransferQueueOpen: boolean }) => unknown) =>
    selector({ isTransferQueueOpen: state.transferOpen }),
}));

// Stub the heavy child dialogs so the test focuses on which ones get mounted.
vi.mock('@/components/AboutWindow', () => ({
  AboutWindow: () => <div data-testid='about-window' />,
}));
vi.mock('@/app/library/components/MigrateDataWindow', () => ({
  MigrateDataWindow: () => <div data-testid='migrate-window' />,
}));
vi.mock('@/app/library/components/BackupWindow', () => ({
  BackupWindow: ({ onPullLibrary }: { onPullLibrary: unknown }) => (
    <div data-testid='backup-window' data-haspull={typeof onPullLibrary === 'function'} />
  ),
}));
vi.mock('@/app/library/components/TransferQueuePanel', () => ({
  default: () => <div data-testid='transfer-panel' />,
}));
vi.mock('@/components/settings/SettingsDialog', () => ({
  default: ({ bookKey }: { bookKey: string }) => (
    <div data-testid='settings-dialog' data-bookkey={bookKey} />
  ),
}));
vi.mock('@/components/ModalPortal', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import TopLevelMenuDialogs from '@/components/navigation/TopLevelMenuDialogs';

describe('TopLevelMenuDialogs', () => {
  beforeEach(() => {
    state.settingsOpen = false;
    state.transferOpen = false;
  });
  afterEach(cleanup);

  it('always mounts the About, Migrate, and Backup dialogs so menu actions have a target', () => {
    render(<TopLevelMenuDialogs onPullLibrary={vi.fn()} />);
    expect(screen.getByTestId('about-window')).toBeTruthy();
    expect(screen.getByTestId('migrate-window')).toBeTruthy();
    expect(screen.getByTestId('backup-window')).toBeTruthy();
  });

  it('passes onPullLibrary through to the Backup dialog', () => {
    render(<TopLevelMenuDialogs onPullLibrary={vi.fn()} />);
    expect(screen.getByTestId('backup-window').getAttribute('data-haspull')).toBe('true');
  });

  it('renders the Settings dialog only when the store flag is open', () => {
    const { rerender } = render(<TopLevelMenuDialogs onPullLibrary={vi.fn()} />);
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
    state.settingsOpen = true;
    rerender(<TopLevelMenuDialogs onPullLibrary={vi.fn()} />);
    expect(screen.getByTestId('settings-dialog').getAttribute('data-bookkey')).toBe('');
  });

  it('renders the Transfer queue panel only when the store flag is open', () => {
    const { rerender } = render(<TopLevelMenuDialogs onPullLibrary={vi.fn()} />);
    expect(screen.queryByTestId('transfer-panel')).toBeNull();
    state.transferOpen = true;
    rerender(<TopLevelMenuDialogs onPullLibrary={vi.fn()} />);
    expect(screen.getByTestId('transfer-panel')).toBeTruthy();
  });
});
