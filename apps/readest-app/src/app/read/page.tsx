'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import Spinner from '@/components/Spinner';
import { BookCodeError, fetchBookByCode, downloadGiftBook } from '@/services/bookCode';
import { importClaimedBook } from '@/services/claimImport';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { Book } from '@/types/book';
import { useLibrary } from '@/hooks/useLibrary';

function ReadLoader() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  const _ = useTranslation();
  const { libraryLoaded } = useLibrary();
  const [error, setError] = useState<string | null>(null);
  const opening = useRef<{ key: string; promise: Promise<Book | null> } | null>(null);

  useEffect(() => {
    if (!appService || !libraryLoaded) return;

    const code = searchParams?.get('code');
    const url = searchParams?.get('url');

    if (code) {
      let active = true;
      // Share an opening across effect replays, including auth refreshes and Strict Mode.
      if (opening.current?.key !== code) {
        opening.current = {
          key: code,
          promise: (async () => {
            const result = await fetchBookByCode(code);
            const bytes = await downloadGiftBook(result.downloadRef);
            const file = new File([bytes], `${result.book.title}.epub`, {
              type: 'application/epub+zip',
            });
            const { library, setLibrary } = useLibraryStore.getState();
            return importClaimedBook(result, file, library, setLibrary, {
              appService,
              settings,
              isLoggedIn: !!user,
            });
          })(),
        };
      }
      opening.current.promise
        .then((book) => {
          if (!active) return;
          if (!book) {
            setError(_('Could not open this file'));
            return;
          }
          router.replace(`/reader?ids=${book.hash}`);
        })
        .catch((err: unknown) => {
          if (!active) return;
          const messages: Record<number, string> = {
            202: 'Your copy is being prepared — try again in a moment.',
            404: "That code wasn't found — check for typos",
            409: 'This gift has already been claimed',
            410: 'This gift has expired',
            423: 'This gift is no longer available',
            429: 'Too many attempts — please try again shortly',
          };
          setError(
            _(
              err instanceof BookCodeError
                ? (messages[err.statusCode] ?? 'Something went wrong — please try again')
                : err instanceof Error
                  ? err.message
                  : 'Failed to load book',
            ),
          );
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
  }, [appService, libraryLoaded, router, searchParams, user, settings, _]);

  if (error) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center gap-3'>
        <p className='text-error text-sm'>{error}</p>
        <button className='btn btn-primary btn-sm' onClick={() => window.location.reload()}>
          {_('Try again')}
        </button>
        <a href='/library' className='btn btn-ghost btn-sm'>
          Go to library
        </a>
      </div>
    );
  }

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <Spinner loading />
    </div>
  );
}

export default function ReadPage() {
  return (
    <Suspense>
      <ReadLoader />
    </Suspense>
  );
}
