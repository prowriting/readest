import { describe, expect, it } from 'vitest';
import { evaluateDownloadGate, networkKindFrom } from '@/utils/downloadGate';

describe('evaluateDownloadGate', () => {
  it('always blocks while offline', () => {
    expect(evaluateDownloadGate(false, 'offline')).toEqual({ allowed: false, reason: 'offline' });
    expect(evaluateDownloadGate(true, 'offline')).toEqual({ allowed: false, reason: 'offline' });
  });

  it('blocks cellular only when wifi-only is enabled', () => {
    expect(evaluateDownloadGate(true, 'cellular')).toEqual({ allowed: false, reason: 'wifi-only' });
    expect(evaluateDownloadGate(false, 'cellular')).toEqual({ allowed: true });
  });

  it('allows wifi and ethernet regardless of the preference', () => {
    expect(evaluateDownloadGate(true, 'wifi')).toEqual({ allowed: true });
    expect(evaluateDownloadGate(true, 'ethernet')).toEqual({ allowed: true });
  });

  it('fails open when the network kind cannot be determined', () => {
    expect(evaluateDownloadGate(true, 'unknown')).toEqual({ allowed: true });
  });
});

describe('networkKindFrom', () => {
  const nav = (onLine: boolean, type?: string) =>
    ({ onLine, connection: type ? { type } : undefined }) as unknown as Navigator;

  it('maps the Network Information API types', () => {
    expect(networkKindFrom(nav(true, 'wifi'))).toBe('wifi');
    expect(networkKindFrom(nav(true, 'ethernet'))).toBe('ethernet');
    expect(networkKindFrom(nav(true, 'cellular'))).toBe('cellular');
  });

  it('reports offline from onLine and none', () => {
    expect(networkKindFrom(nav(false, 'wifi'))).toBe('offline');
    expect(networkKindFrom(nav(true, 'none'))).toBe('offline');
  });

  it('is unknown without the connection API', () => {
    expect(networkKindFrom(nav(true))).toBe('unknown');
  });
});
