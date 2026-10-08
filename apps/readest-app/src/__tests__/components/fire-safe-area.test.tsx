import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  theme: {
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    statusBarHeight: 24,
    systemUIVisible: true,
  },
  appService: { hasSafeAreaInset: true },
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: state.appService }) }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => state.theme }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));
vi.mock('@/hooks/useLibrary', () => ({ useLibrary: vi.fn() }));
vi.mock('@/app/library/hooks/useBooksSync', () => ({
  useBooksSync: () => ({ pullLibrary: vi.fn() }),
}));
vi.mock('@/components/navigation/BottomTabBar', () => ({ default: () => null }));
vi.mock('@/components/navigation/TopLevelMenuDialogs', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/app/discover/components/DiscoverScreen', () => ({
  default: () => <div data-testid='discover-content' />,
}));
vi.mock('@/app/discover/components/CatalogBookDetail', () => ({ default: () => null }));
vi.mock('@/app/discover/components/SeeAllOverlay', () => ({ default: () => null }));

import AudiobookFullScreen from '@/app/reader/components/audiobook/AudiobookFullScreen';
import DiscoverPage from '@/app/discover/page';

afterEach(cleanup);

it.each([
  { top: 0, visible: true, expected: 36 },
  { top: 44, visible: true, expected: 56 },
  { top: 0, visible: false, expected: 12 },
])('keeps fullscreen controls below the visible status bar: %j', ({ top, visible, expected }) => {
  state.theme.systemUIVisible = visible;
  render(
    <AudiobookFullScreen gridInsets={{ top, right: 0, bottom: 0, left: 0 }}>
      Player controls
    </AudiobookFullScreen>,
  );
  expect(screen.getByLabelText('Audiobook Screen').style.paddingTop).toBe(`${expected}px`);
});

it.each([
  { top: 0, mobile: true, expected: 24 },
  { top: 44, mobile: true, expected: 44 },
  { top: 0, mobile: false, expected: 0 },
])('keeps Discover below the mobile status bar without adding a desktop gap: %j', ({
  top,
  mobile,
  expected,
}) => {
  state.theme.safeAreaInsets.top = top;
  state.appService.hasSafeAreaInset = mobile;
  render(<DiscoverPage />);
  expect(screen.getByTestId('discover-content').parentElement!.style.paddingTop).toBe(
    `${expected}px`,
  );
});
