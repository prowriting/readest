import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
}));

vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
  navigateToDiscover: vi.fn(),
  navigateToClaim: vi.fn(),
}));

vi.mock('@/store/themeStore', async () => {
  const { create } = await import('zustand');
  return {
    useThemeStore: create(() => ({ safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 } })),
  };
});

// Stub the strip and the settings menu so the test focuses on the tab row.
vi.mock('@/components/navigation/ContinueReadingStrip', () => ({
  default: () => <div data-testid='continue-strip' />,
}));
vi.mock('@/app/library/components/SettingsMenu', () => ({
  default: ({ onPullLibrary }: { onPullLibrary: () => void }) => (
    <div data-testid='settings-menu' data-haspull={typeof onPullLibrary === 'function'} />
  ),
}));
// Stub Dropdown so its menu (SettingsMenu) is always present and the toggle is a real button.
vi.mock('@/components/Dropdown', () => ({
  default: ({
    toggleButton,
    children,
    label,
  }: {
    toggleButton: React.ReactNode;
    children: React.ReactNode;
    label: string;
  }) => (
    <div>
      <button type='button' aria-label={label}>
        {toggleButton}
      </button>
      {children}
    </div>
  ),
}));

import BottomTabBar from '@/components/navigation/BottomTabBar';
import { navigateToLibrary, navigateToDiscover, navigateToClaim } from '@/utils/nav';

describe('BottomTabBar', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the four destinations and the continue-reading strip', () => {
    render(<BottomTabBar active='library' onPullLibrary={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discover' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claim' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.getByTestId('continue-strip')).toBeTruthy();
  });

  it('marks only the active destination with aria-current', () => {
    render(<BottomTabBar active='discover' onPullLibrary={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Discover' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBeNull();
  });

  it('navigates to each destination when its tab is tapped', () => {
    render(<BottomTabBar active='library' onPullLibrary={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Discover' }));
    expect(navigateToDiscover).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    expect(navigateToClaim).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(navigateToLibrary).toHaveBeenCalledTimes(1);
  });

  it('opens the existing settings menu from More without navigating', () => {
    render(<BottomTabBar active='library' onPullLibrary={vi.fn()} />);

    const menu = screen.getByTestId('settings-menu');
    expect(menu).toBeTruthy();
    expect(menu.getAttribute('data-haspull')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(navigateToDiscover).not.toHaveBeenCalled();
    expect(navigateToClaim).not.toHaveBeenCalled();
    expect(navigateToLibrary).not.toHaveBeenCalled();
  });
});
