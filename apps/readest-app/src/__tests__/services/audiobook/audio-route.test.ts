import { describe, expect, it, vi } from 'vitest';
import {
  canShowAudioRoutePicker,
  audioRoutePickerAvailable,
} from '@/services/audiobook/audioRoute';

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'ios' }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => 'macos' }));

describe('canShowAudioRoutePicker', () => {
  it('offers audio output selection on an iPad with a Macintosh user agent', () => {
    expect(audioRoutePickerAvailable()).toBe(true);
  });
  it('offers the system route picker only on iOS Tauri builds', () => {
    expect(canShowAudioRoutePicker(true, 'ios')).toBe(true);
  });

  it('stays hidden everywhere else', () => {
    expect(canShowAudioRoutePicker(true, 'android')).toBe(false); // output switcher lives in the notification
    expect(canShowAudioRoutePicker(true, 'macos')).toBe(false);
    expect(canShowAudioRoutePicker(false, 'ios')).toBe(false); // web build on an iPhone
  });
});
