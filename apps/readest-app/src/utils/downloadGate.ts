/**
 * Download gating for large audiobook files: the Wi-Fi-only preference and
 * offline state decide whether a cloud download may start. Pure so every
 * branch is unit-testable; network detection reads the Network Information
 * API where the platform provides it and fails open elsewhere — blocking
 * downloads on a false "cellular" guess would be worse than allowing them.
 */
export type NetworkKind = 'wifi' | 'ethernet' | 'cellular' | 'offline' | 'unknown';

export interface DownloadGateResult {
  allowed: boolean;
  reason?: 'offline' | 'wifi-only';
}

export const evaluateDownloadGate = (
  wifiOnly: boolean,
  network: NetworkKind,
): DownloadGateResult => {
  if (network === 'offline') return { allowed: false, reason: 'offline' };
  if (wifiOnly && network === 'cellular') return { allowed: false, reason: 'wifi-only' };
  return { allowed: true };
};

export const networkKindFrom = (nav: Navigator): NetworkKind => {
  if (nav.onLine === false) return 'offline';
  const connection = (nav as Navigator & { connection?: { type?: string } }).connection;
  switch (connection?.type) {
    case 'wifi':
      return 'wifi';
    case 'ethernet':
      return 'ethernet';
    case 'cellular':
      return 'cellular';
    case 'none':
      return 'offline';
    default:
      return 'unknown';
  }
};
