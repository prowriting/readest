'use client';

import React from 'react';

import { useSettingsStore } from '@/store/settingsStore';
import { useTransferStore } from '@/store/transferStore';
import { AboutWindow } from '@/components/AboutWindow';
import ModalPortal from '@/components/ModalPortal';
import SettingsDialog from '@/components/settings/SettingsDialog';
import { MigrateDataWindow } from '@/app/library/components/MigrateDataWindow';
import { BackupWindow } from '@/app/library/components/BackupWindow';
import TransferQueuePanel from '@/app/library/components/TransferQueuePanel';

interface TopLevelMenuDialogsProps {
  onPullLibrary: (fullRefresh?: boolean, verbose?: boolean) => void;
}

/**
 * The dialogs opened from the shared bottom-tab "More" menu (SettingsMenu):
 * Settings, About, Backup & Restore, Change Data Location, and the cloud
 * Transfer queue. The tab bar — and therefore the menu — appears on every
 * top-level screen (Library, Discover, Claim), so these dialogs must be mounted
 * on each of them. Otherwise the menu items fire their store/event actions but
 * there is nothing rendered to react to them and the buttons appear dead.
 */
const TopLevelMenuDialogs: React.FC<TopLevelMenuDialogsProps> = ({ onPullLibrary }) => {
  const isSettingsDialogOpen = useSettingsStore((state) => state.isSettingsDialogOpen);
  const isTransferQueueOpen = useTransferStore((state) => state.isTransferQueueOpen);

  return (
    <>
      <AboutWindow />
      <MigrateDataWindow />
      <BackupWindow onPullLibrary={onPullLibrary} />
      {isTransferQueueOpen && (
        <ModalPortal>
          <TransferQueuePanel />
        </ModalPortal>
      )}
      {isSettingsDialogOpen && <SettingsDialog bookKey={''} />}
    </>
  );
};

export default TopLevelMenuDialogs;
