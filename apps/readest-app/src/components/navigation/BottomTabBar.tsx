'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { PiBooks, PiCompass, PiGift, PiList } from 'react-icons/pi';

import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { navigateToClaim, navigateToDiscover, navigateToLibrary } from '@/utils/nav';
import Dropdown from '@/components/Dropdown';
import SettingsMenu from '@/app/library/components/SettingsMenu';
import ContinueReadingStrip from './ContinueReadingStrip';

export type TabKey = 'library' | 'discover' | 'claim';

interface BottomTabBarProps {
  active: TabKey;
  /** Library sync action surfaced by the More menu's "Sync Library" item. */
  onPullLibrary: (fullRefresh?: boolean, verbose?: boolean) => void;
}

const tabClass = (active: boolean) =>
  clsx(
    'flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5',
    active ? 'text-primary' : 'text-base-content/60',
  );

const labelClass = (active: boolean) => clsx('text-[10px] leading-none', active && 'font-semibold');

/**
 * Persistent bottom navigation shown on the three top-level screens (Library,
 * Discover, Claim). It stacks a pinned "Continue reading" strip over a row of
 * four equal destinations. "More" is not a screen — it re-triggers the existing
 * settings menu as a popup over the current tab, so the active tab is unchanged.
 */
const BottomTabBar: React.FC<BottomTabBarProps> = ({ active, onPullLibrary }) => {
  const _ = useTranslation();
  const router = useRouter();
  const insets = useThemeStore((s) => s.safeAreaInsets);
  const iconSize = 19;

  return (
    <div
      className='bottom-tab-bar bg-base-200 border-base-300 z-30 w-full border-t'
      role='navigation'
      aria-label={_('Primary')}
      style={{ paddingBottom: `${insets?.bottom ?? 0}px` }}
    >
      <div className='px-2 pt-2'>
        <ContinueReadingStrip />
      </div>
      <div className='flex items-stretch px-1 pb-1 pt-1.5'>
        <button
          type='button'
          aria-label={_('Library')}
          aria-current={active === 'library' ? 'page' : undefined}
          onClick={() => navigateToLibrary(router)}
          className={tabClass(active === 'library')}
        >
          <PiBooks size={iconSize} aria-hidden />
          <span className={labelClass(active === 'library')}>{_('Library')}</span>
        </button>

        <button
          type='button'
          aria-label={_('Discover')}
          aria-current={active === 'discover' ? 'page' : undefined}
          onClick={() => navigateToDiscover(router)}
          className={tabClass(active === 'discover')}
        >
          <PiCompass size={iconSize} aria-hidden />
          <span className={labelClass(active === 'discover')}>{_('Discover')}</span>
        </button>

        <button
          type='button'
          aria-label={_('Claim')}
          aria-current={active === 'claim' ? 'page' : undefined}
          onClick={() => navigateToClaim(router)}
          className={tabClass(active === 'claim')}
        >
          <PiGift size={iconSize} aria-hidden />
          <span className={labelClass(active === 'claim')}>{_('Claim')}</span>
        </button>

        <Dropdown
          label={_('More')}
          className='dropdown-top dropdown-end'
          containerClassName='flex-1 justify-center'
          buttonClassName={tabClass(false)}
          toggleButton={
            <>
              <PiList size={iconSize} aria-hidden />
              <span className={labelClass(false)}>{_('More')}</span>
            </>
          }
        >
          <SettingsMenu onPullLibrary={onPullLibrary} />
        </Dropdown>
      </div>
    </div>
  );
};

export default BottomTabBar;
