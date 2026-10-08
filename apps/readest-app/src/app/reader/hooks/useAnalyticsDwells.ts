import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSync } from '@/hooks/useSync';
import { debounce } from '@/utils/debounce';
import { useDwellTracking } from './useDwellTracking';
import { AnalyticsStatus, DwellRecord } from '@/types/book';
import { SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';
import { useWindowActiveChanged } from './useWindowActiveChanged';

export function useAnalyticsDwells(bookKey: string) {
  const { envConfig } = useEnv();
  const { getBookData } = useBookDataStore();
  const { updateBook, library } = useLibraryStore();
  const { pushChanges, syncBooks } = useSync(bookKey);

  const bookData = getBookData(bookKey);
  // Consent changes are persisted in the library; the reader's loaded book
  // remains a snapshot and may still carry its original 'ask' status.
  const book =
    library.find((entry) => entry.hash === bookData?.book?.hash) ?? bookData?.book ?? null;
  const analyticsStatus = book?.analyticsStatus ?? 'none';
  const progress = useReaderStore((s) => s.getProgress(bookKey));

  // Show the modal once per session for 'ask' — tracks whether the user has
  // been prompted in this session so we don't re-show after they dismiss.
  const promptedRef = useRef(false);
  const [showConsent, setShowConsent] = useState(analyticsStatus === 'ask' && !promptedRef.current);

  const { onRelocate, flushDwells } = useDwellTracking(
    book?.hash ?? '',
    analyticsStatus as AnalyticsStatus,
  );

  const setAnalyticsStatus = useCallback(
    async (status: AnalyticsStatus) => {
      if (!book) return;
      const updatedBook = { ...book, analyticsStatus: status, updatedAt: Date.now() };
      await updateBook(envConfig, updatedBook);
      await syncBooks([updatedBook], 'push');
    },
    [book, envConfig, updateBook, syncBooks],
  );

  const handleAllow = useCallback(async () => {
    promptedRef.current = true;
    setShowConsent(false);
    await setAnalyticsStatus('collect');
  }, [setAnalyticsStatus]);

  const handleDecline = useCallback(async () => {
    promptedRef.current = true;
    setShowConsent(false);
    await setAnalyticsStatus('denied');
  }, [setAnalyticsStatus]);

  const pendingDwells = useRef<DwellRecord[]>([]);
  const pushingDwells = useRef(false);
  const finalizingDwells = useRef(false);
  const flushAndPushDwells = useCallback(
    async (includeCurrent = false): Promise<void> => {
      if (analyticsStatus !== 'collect') return;
      if (includeCurrent) finalizingDwells.current = true;
      pendingDwells.current.push(...flushDwells(includeCurrent));
      if (pushingDwells.current || pendingDwells.current.length === 0) return;
      pushingDwells.current = true;
      const batch = [...pendingDwells.current];
      let succeeded = false;
      try {
        succeeded = (await pushChanges({ dwells: batch })) !== false;
        if (succeeded) {
          pendingDwells.current.splice(0, batch.length);
        }
      } finally {
        pushingDwells.current = false;
        if (succeeded && finalizingDwells.current && pendingDwells.current.length > 0) {
          void flushRef.current(true);
        }
      }
    },
    [analyticsStatus, flushDwells, pushChanges],
  );

  const flushRef = useRef(flushAndPushDwells);
  useEffect(() => {
    flushRef.current = flushAndPushDwells;
  }, [flushAndPushDwells]);

  const handleAutoFlush = useMemo(
    () => debounce(() => flushRef.current(), SYNC_PROGRESS_INTERVAL_SEC * 1000),
    [],
  );

  useWindowActiveChanged(
    useCallback((active) => {
      if (!active) void flushRef.current(true);
    }, []),
  );

  useEffect(
    () => () => {
      handleAutoFlush.cancel();
      void flushRef.current(true);
    },
    [handleAutoFlush],
  );

  // Flush dwells on the same cadence as progress sync, triggered by progress changes.
  useEffect(() => {
    if (!progress?.location || analyticsStatus !== 'collect') return;
    handleAutoFlush();
  }, [progress?.location, analyticsStatus, handleAutoFlush]);

  return {
    showConsent,
    onRelocate,
    handleAllow,
    handleDecline,
    flushAndPushDwells,
  };
}
