import { useCallback, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { shareKindleFile } from '@/services/kindle';
import { eventDispatcher } from '@/utils/event';
import { detectKindle } from '@/utils/bridge';
import type { KindleSource } from '@/services/fireKindle';

export function useSendToKindle() {
  const { appService } = useEnv();
  const _ = useTranslation();
  const pending = useRef(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fireSource, setFireSource] = useState<KindleSource | null>(null);

  const sendToKindle = useCallback(
    async (source: KindleSource) => {
      if (!appService || pending.current) return;
      pending.current = true;
      setIsPreparing(true);
      try {
        const isFire = appService.isAndroidApp && (await detectKindle()).isFire;
        if (isFire && source.format.toUpperCase() === 'EPUB') {
          setFireSource(source);
          return;
        }
        const prepared = await source.loadOriginal();
        if (!prepared) return;
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
        // The Fire modal owns preparation and keeps repeated taps blocked.
        pending.current = false;
        setIsPreparing(false);
      }
    },
    [appService, _],
  );

  return {
    sendToKindle: (source: KindleSource) => {
      if (fireSource || file) return Promise.resolve();
      return sendToKindle(source);
    },
    isPreparing,
    file,
    fireSource,
    close: () => {
      setFile(null);
      setFireSource(null);
    },
  };
}
