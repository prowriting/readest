import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSync } from '@/hooks/useSync';
import { debounce } from '@/utils/debounce';
import { useDwellTracking } from './useDwellTracking';
import { AnalyticsStatus } from '@/types/book';
import { SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';

export function useAnalyticsDwells(bookKey: string) {
  const { envConfig } = useEnv();
  const { getBookData } = useBookDataStore();
  const { updateBook } = useLibraryStore();
  const { pushChanges, syncBooks } = useSync(bookKey);

  const bookData = getBookData(bookKey);
  const book = bookData?.book ?? null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, envConfig],
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

  const flushAndPushDwells = useCallback(async () => {
    if (analyticsStatus !== 'collect') return;
    const dwells = flushDwells();
    if (dwells.length === 0) return;
    await pushChanges({ dwells });
  }, [analyticsStatus, flushDwells, pushChanges]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoFlush = useCallback(
    debounce(() => {
      flushAndPushDwells();
    }, SYNC_PROGRESS_INTERVAL_SEC * 1000),
    [],
  );

  // Flush dwells on the same cadence as progress sync, triggered by progress changes.
  useEffect(() => {
    if (!progress?.location || analyticsStatus !== 'collect') return;
    handleAutoFlush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.location]);

  return {
    showConsent,
    onRelocate,
    handleAllow,
    handleDecline,
    flushAndPushDwells,
  };
}
