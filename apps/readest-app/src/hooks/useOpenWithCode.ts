import { useEffect, useRef } from 'react';
import { getCurrent } from '@tauri-apps/plugin-deep-link';
import { isTauriAppPlatform } from '@/services/environment';
import { fetchBookByCode, BookCodeError } from '@/services/bookCode';
import { eventDispatcher } from '@/utils/event';
import { useTranslation } from './useTranslation';

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

const ERROR_MESSAGES: Record<number, string> = {
  404: "That code wasn't found — check for typos",
  409: 'This gift has already been claimed',
  410: 'This gift has expired',
  423: 'This gift is no longer available',
  429: 'Too many attempts — please try again shortly',
};

/**
 * Listens for bookarc://open?code=<code> deep links (warm and cold start)
 * and ?code= web URL parameter, looks up the book via the API, and
 * dispatches 'book-code-found' for BookCodeDialog to display.
 * Shows a toast for error responses.
 */
export function useOpenWithCode() {
  const _ = useTranslation();
  const processing = useRef(false);

  const handleUrl = async (url: string) => {
    const code = extractCode(url);
    if (!code || processing.current) return;
    processing.current = true;
    try {
      const result = await fetchBookByCode(code);
      eventDispatcher.dispatch('book-code-found', { result });
    } catch (err) {
      const statusCode = err instanceof BookCodeError ? err.statusCode : 0;
      const message =
        err instanceof BookCodeError
          ? (ERROR_MESSAGES[err.statusCode] ?? 'Something went wrong — please try again')
          : 'Something went wrong — please try again';
      eventDispatcher.dispatch('book-code-error', { code, statusCode, message: _(message) });
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
        if (first) void handleUrl(first);
      });
    }

    const handler = (event: CustomEvent) => {
      const urls = (event.detail as { urls: string[] }).urls;
      if (urls?.length) void handleUrl(urls[0]!);
    };
    eventDispatcher.on('app-incoming-url', handler);
    return () => eventDispatcher.off('app-incoming-url', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
