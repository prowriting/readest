'use client';

import clsx from 'clsx';
import { useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTheme } from '@/hooks/useTheme';
import { useLibrary } from '@/hooks/useLibrary';
import { useTranslation } from '@/hooks/useTranslation';
import { useBooksSync } from '@/app/library/hooks/useBooksSync';
import type { DiscoverBook, DiscoverRow } from '@/services/catalog';
import BottomTabBar from '@/components/navigation/BottomTabBar';
import TopLevelMenuDialogs from '@/components/navigation/TopLevelMenuDialogs';
import { Toast } from '@/components/Toast';
import DiscoverScreen from './components/DiscoverScreen';
import CatalogBookDetail from './components/CatalogBookDetail';
import SeeAllOverlay from './components/SeeAllOverlay';

const DiscoverPage = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets: insets } = useThemeStore();
  useTheme({ systemUIVisible: true, appThemeColor: 'base-200' });
  useLibrary();
  const { pullLibrary } = useBooksSync();

  const [selectedBook, setSelectedBook] = useState<DiscoverBook | null>(null);
  const [seeAllRow, setSeeAllRow] = useState<DiscoverRow | null>(null);

  if (!appService || !insets) {
    return <div className={clsx('full-height', !appService?.isLinuxApp && 'bg-base-200')} />;
  }

  return (
    <div
      aria-label={_('Discover books')}
      className='discover-page text-base-content full-height bg-base-200 flex select-none flex-col overflow-hidden'
    >
      {/* DiscoverScreen stays mounted under the overlay so its scroll position is
          preserved when the See-all overlay is dismissed (SA-1). */}
      <div className='min-h-0 flex-1 overflow-y-auto' style={{ paddingTop: `${insets.top}px` }}>
        <DiscoverScreen onOpenBook={setSelectedBook} onSeeAll={setSeeAllRow} />
      </div>
      {/* The See-all overlay is a clean drill-in: the tab bar is hidden while it
          is open and the back arrow is the only exit (SA-4). */}
      {!seeAllRow && <BottomTabBar active='discover' onPullLibrary={pullLibrary} />}

      {seeAllRow && (
        <SeeAllOverlay
          row={seeAllRow}
          onBack={() => setSeeAllRow(null)}
          onOpenBook={setSelectedBook}
        />
      )}

      <CatalogBookDetail book={selectedBook} onClose={() => setSelectedBook(null)} />
      <TopLevelMenuDialogs onPullLibrary={pullLibrary} />
      <Toast />
    </div>
  );
};

export default DiscoverPage;
