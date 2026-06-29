'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import Spinner from '@/components/Spinner';

const AUTHOR_BASE_URL = process.env['NEXT_PUBLIC_AUTHOR_BASE_URL'] ?? 'https://author.bookarc.app';

interface RedeemResponse {
  downloadRef: string;
}

async function redeemClaimCode(code: string): Promise<string> {
  const res = await fetch(`${AUTHOR_BASE_URL}/v1/claim/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { title?: string };
    throw new Error(err.title ?? `Claim failed (${res.status})`);
  }
  const data = (await res.json()) as RedeemResponse;
  return data.downloadRef;
}

async function confirmClaim(downloadRef: string): Promise<void> {
  await fetch(`${AUTHOR_BASE_URL}/v1/claim/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ downloadRef }),
  });
}

function ReadLoader() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { token } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appService) return;

    const code = searchParams?.get('code');
    const url = searchParams?.get('url');

    if (code && !token) {
      const returnUrl = `/read?code=${encodeURIComponent(code)}`;
      router.replace(`/auth?next=${encodeURIComponent(returnUrl)}`);
      return;
    }

    if (code) {
      const { library } = useLibraryStore.getState();
      redeemClaimCode(code)
        .then(async (downloadRef) => {
          const downloadUrl = `${AUTHOR_BASE_URL}/v1/claim/download?ref=${encodeURIComponent(downloadRef)}`;
          const epubRes = await fetch(downloadUrl);
          if (!epubRes.ok) throw new Error(`Download failed (${epubRes.status})`);
          const blob = await epubRes.blob();
          const file = new File([blob], 'book.epub', { type: 'application/epub+zip' });
          const book = await appService.importBook(file, library, {
            saveBook: true,
            saveCover: true,
          });
          if (!book) throw new Error('Could not open this file');
          confirmClaim(downloadRef).catch(console.error);
          router.replace(`/reader?ids=${book.hash}`);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Failed to load book');
        });
      return;
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
      .then((book) => {
        if (!book) {
          setError('Could not open this file');
          return;
        }
        router.replace(`/reader?ids=${book.hash}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load book');
      });
  }, [appService, router, searchParams, token]);

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
