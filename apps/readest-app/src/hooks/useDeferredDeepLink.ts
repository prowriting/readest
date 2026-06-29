import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import { isTauriAppPlatform, getAPIBaseUrl } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';

const DEFERRED_CHECKED_KEY = 'bookarc_deferred_link_checked';

// Runs once per install. Checks the Android install referrer (via
// Google Play) or the iOS server-side fingerprint, then surfaces any
// found claim code as an 'app-incoming-url' event so useOpenWithCode
// can process it normally.
export function useDeferredDeepLink() {
  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (localStorage.getItem(DEFERRED_CHECKED_KEY)) return;
    localStorage.setItem(DEFERRED_CHECKED_KEY, '1');
    void checkDeferredLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

async function checkDeferredLink() {
  let code: string | null = null;

  try {
    const platform = await osType();

    if (platform === 'android') {
      const result = await invoke<{ referrer: string }>(
        'plugin:native-bridge|get_install_referrer',
      );
      if (result.referrer) {
        code = new URLSearchParams(result.referrer).get('claim_code');
      }
    } else if (platform === 'ios') {
      const params = new URLSearchParams();
      const osMatch = navigator.userAgent.match(/OS ([\d_]+)/);
      if (osMatch?.[1]) params.set('osVersion', osMatch[1].replace(/_/g, '.'));
      params.set('screenWidth', String(screen.width));
      params.set('screenHeight', String(screen.height));
      params.set('pixelRatio', String(window.devicePixelRatio));
      params.set('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone);

      const resp = await fetch(`${getAPIBaseUrl()}/deferred-link/resolve?${params}`);
      if (resp.ok) {
        const data = (await resp.json()) as { code?: string };
        code = data.code ?? null;
      }
    }
  } catch {
    // Network or invoke error — silently skip
  }

  if (code) {
    eventDispatcher.dispatch('app-incoming-url', {
      urls: [`bookarc://open?code=${code}`],
    });
  }
}
