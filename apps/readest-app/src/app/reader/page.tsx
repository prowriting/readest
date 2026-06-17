'use client';

import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAppUrlIngress } from '@/hooks/useAppUrlIngress';
import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { useOpenAnnotationLink } from '@/hooks/useOpenAnnotationLink';
import { useOpenShareLink } from '@/hooks/useOpenShareLink';
import { useClipUrlIngress } from '@/hooks/useClipUrlIngress';
import { useOpenWithCode } from '@/hooks/useOpenWithCode';
import { useSettingsStore } from '@/store/settingsStore';
import { tauriHandleSetAlwaysOnTop } from '@/utils/window';
import { BookCodeDialog } from '@/components/BookCodeDialog';
import Reader from './components/Reader';

// This is only used for the Tauri app in the app router
export default function Page() {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();

  useAppUrlIngress();
  useOpenWithBooks();
  useOpenAnnotationLink();
  useOpenShareLink();
  useClipUrlIngress();
  useOpenWithCode();

  useEffect(() => {
    // TODO: re-enable once Bookarc update channel is configured
    const doCheckAppUpdates = async () => {};
    if (appService?.hasWindow && settings.alwaysOnTop) {
      tauriHandleSetAlwaysOnTop(settings.alwaysOnTop);
    }
    doCheckAppUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasUpdater, settings.autoCheckUpdates]);

  return (
    <>
      <Reader />
      <BookCodeDialog />
    </>
  );
}
