import { useEffect, useRef } from 'react';
import { getCurrent } from '@tauri-apps/plugin-deep-link';
import { isTauriAppPlatform } from '@/services/environment';
import { fetchBookByCode } from '@/services/bookCode';
import { eventDispatcher } from '@/utils/event';

// Prevents re-processing on hook remounts (library → reader → library)
let coldStartConsumed = false;
let webCodeConsumed = false;

function extractCode(url: string): string | null {
  try {
    return new URL(url).searchParams.get('code');
  } catch {
    return null;
  }
}

/**
 * Listens for bookarc://open?code=<code> deep links (warm and cold start),
 * looks up the book via the API, and dispatches 'book-code-found' for
 * BookCodeDialog to display.
 */
export function useOpenWithCode() {
  const processing = useRef(false);

  const handleUrl = async (url: string) => {
    const code = extractCode(url);
    if (!code || processing.current) return;
    processing.current = true;
    try {
      const book = await fetchBookByCode(code);
      if (book) {
        eventDispatcher.dispatch('book-code-found', { book });
      }
    } finally {
      processing.current = false;
    }
  };

  useEffect(() => {
    // Web: read ?code= from the page URL once on mount
    if (!isTauriAppPlatform() && !webCodeConsumed) {
      webCodeConsumed = true;
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) void handleUrl(`https://x?code=${code}`);
    }

    if (!isTauriAppPlatform()) return;

    if (!coldStartConsumed) {
      coldStartConsumed = true;
      getCurrent().then((urls) => {
        const first = urls?.[0];
        if (first) handleUrl(first);
      });
    }

    const handler = (event: CustomEvent) => {
      const urls = (event.detail as { urls: string[] }).urls;
      if (urls?.length) handleUrl(urls[0]!);
    };
    eventDispatcher.on('app-incoming-url', handler);
    return () => eventDispatcher.off('app-incoming-url', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
