'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import Spinner from '@/components/Spinner';
import { BookCodeDialog } from '@/components/BookCodeDialog';
import { fetchBookByCode } from '@/services/bookCode';
import { eventDispatcher } from '@/utils/event';
import { useLibrary } from '@/hooks/useLibrary';

function ReadLoader() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { token } = useAuth();
  const { libraryLoaded } = useLibrary();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appService || !libraryLoaded) return;

    const code = searchParams?.get('code');
    const url = searchParams?.get('url');

    if (code && !token) {
      const returnUrl = `/read?code=${encodeURIComponent(code)}`;
      router.replace(`/auth?next=${encodeURIComponent(returnUrl)}`);
      return;
    }

    if (code) {
      // Use the normal claim flow so library persistence and analytics consent
      // are identical for browser links and manually entered claim codes.
      let active = true;
      fetchBookByCode(code)
        .then((result) => {
          if (active) eventDispatcher.dispatch('book-code-found', { result });
        })
        .catch((err: unknown) => {
          if (active) setError(err instanceof Error ? err.message : 'Failed to load book');
        });
      return () => {
        active = false;
      };
    }

    if (!url) {
      setError('No EPUB URL provided');
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setError('Invalid URL');
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('Invalid URL');
      return;
    }

    const { library } = useLibraryStore.getState();
    appService
      .importBook(url, library, { saveBook: true, saveCover: true })
      .then(async (book) => {
        if (!book) {
          setError('Could not open this file');
          return;
        }
        useLibraryStore.getState().setLibrary(library);
        await appService.saveLibraryBooks(library);
        router.replace(`/reader?ids=${book.hash}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load book');
      });
    return undefined;
  }, [appService, libraryLoaded, router, searchParams, token]);

  if (error) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center gap-3'>
        <p className='text-error text-sm'>{error}</p>
        <a href='/library' className='btn btn-ghost btn-sm'>
          Go to library
        </a>
      </div>
    );
  }

  return (
    <>
      <div className='flex min-h-screen items-center justify-center'>
        <Spinner loading />
      </div>
      <BookCodeDialog />
    </>
  );
}

export default function ReadPage() {
  return (
    <Suspense>
      <ReadLoader />
    </Suspense>
  );
}
