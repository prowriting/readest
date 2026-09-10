import { describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_OVERLAY_CONFIG } from '@/services/constants';
import { getDefaultViewSettings, type Context } from '@/services/settingsService';
import type { MediaOverlayLocation } from '@/types/book';

describe('media overlay config', () => {
  it('has sane defaults', () => {
    expect(DEFAULT_MEDIA_OVERLAY_CONFIG.moPlaybackRate).toBe(1.0);
    expect(DEFAULT_MEDIA_OVERLAY_CONFIG.moSkipForwardSec).toBe(30);
    expect(DEFAULT_MEDIA_OVERLAY_CONFIG.moSkipBackSec).toBe(15);
    expect(DEFAULT_MEDIA_OVERLAY_CONFIG.moReadAlongEnabled).toBe(true);
    expect(DEFAULT_MEDIA_OVERLAY_CONFIG.moHighlightOptions).toEqual({
      style: 'highlight',
      color: '#facc15',
    });
  });

  it('is part of the default view settings (per-book overrides merge on top)', () => {
    const settings = getDefaultViewSettings({ isMobile: false, isEink: false } as Context);
    expect(settings.moPlaybackRate).toBe(DEFAULT_MEDIA_OVERLAY_CONFIG.moPlaybackRate);
    expect(settings.moSkipForwardSec).toBe(DEFAULT_MEDIA_OVERLAY_CONFIG.moSkipForwardSec);
    expect(settings.moSkipBackSec).toBe(DEFAULT_MEDIA_OVERLAY_CONFIG.moSkipBackSec);
  });

  it('listening locations survive a config JSON round-trip', () => {
    const location: MediaOverlayLocation = {
      schemaVersion: 2,
      editionId: 'book-hash',
      locator: {
        href: 'audio/chapter-03.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=125.5'], progression: 0.5, totalProgression: 0.24 },
      },
      updatedAt: 1751500000000,
    };
    const roundTripped = JSON.parse(JSON.stringify({ mediaOverlayLocation: location })) as {
      mediaOverlayLocation: MediaOverlayLocation;
    };
    expect(roundTripped.mediaOverlayLocation).toEqual(location);
  });
});
