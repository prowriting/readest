import { useCallback, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { shareKindleFile } from '@/services/kindle';
import { eventDispatcher } from '@/utils/event';
import { detectKindle } from '@/utils/bridge';

export function useSendToKindle() {
  const { appService } = useEnv();
  const _ = useTranslation();
  const pending = useRef(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const sendToKindle = useCallback(
    async (loadFile: () => Promise<File | null>) => {
      if (!appService || pending.current) return;
      pending.current = true;
      setIsPreparing(true);
      try {
        const prepared = await loadFile();
        if (!prepared) return;
        // Fire's built-in Kindle does not handle EPUB shares. Reuse the
        // saved-file web handoff rather than opening a sheet without Kindle.
        const isFire = appService.isAndroidApp && (await detectKindle()).isFire;
        if (appService.isIOSApp || (appService.isAndroidApp && !isFire)) {
          eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('Choose Kindle in the share sheet. If it is hidden, tap More.'),
            timeout: 6000,
          });
          await shareKindleFile(appService, prepared);
          // Dismissal is not proof of delivery. Kindle handles the remaining steps.
        } else {
          setFile(prepared);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled =
          (error instanceof Error && error.name === 'AbortError') ||
          /^share cancel[le]*d$/i.test(message);
        if (!cancelled) {
          console.error('Could not prepare the book for Kindle:', error);
          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: _('Could not prepare the book for Kindle. Please try again.'),
            timeout: 5000,
          });
        }
      } finally {
        pending.current = false;
        setIsPreparing(false);
      }
    },
    [appService, _],
  );

  return { sendToKindle, isPreparing, file, close: () => setFile(null) };
}
