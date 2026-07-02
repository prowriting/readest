'use client';

import clsx from 'clsx';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTheme } from '@/hooks/useTheme';
import { useLibrary } from '@/hooks/useLibrary';
import { useTranslation } from '@/hooks/useTranslation';
import { useBooksSync } from '@/app/library/hooks/useBooksSync';
import BottomTabBar from '@/components/navigation/BottomTabBar';
import TopLevelMenuDialogs from '@/components/navigation/TopLevelMenuDialogs';
import { BookCodeDialog } from '@/components/BookCodeDialog';
import { Toast } from '@/components/Toast';
import ClaimScreen from './components/ClaimScreen';

const ClaimPage = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets: insets } = useThemeStore();
  useTheme({ systemUIVisible: true, appThemeColor: 'base-200' });
  // Ensure settings + library are loaded so a successful claim can be persisted
  // and synced even when the user opens /claim directly.
  useLibrary();
  const { pullLibrary } = useBooksSync();

  if (!appService || !insets) {
    return <div className={clsx('full-height', !appService?.isLinuxApp && 'bg-base-200')} />;
  }

  return (
    <div
      aria-label={_('Claim a book')}
      className='claim-page text-base-content full-height bg-base-200 flex select-none flex-col overflow-hidden'
    >
      <div className='min-h-0 flex-1 overflow-y-auto' style={{ paddingTop: `${insets.top}px` }}>
        <ClaimScreen />
      </div>
      <BottomTabBar active='claim' onPullLibrary={pullLibrary} />
      <BookCodeDialog />
      <TopLevelMenuDialogs onPullLibrary={pullLibrary} />
      <Toast />
    </div>
  );
};

export default ClaimPage;
