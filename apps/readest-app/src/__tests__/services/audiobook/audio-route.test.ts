import { describe, expect, it } from 'vitest';
import { canShowAudioRoutePicker } from '@/services/audiobook/audioRoute';

describe('canShowAudioRoutePicker', () => {
  it('offers the system route picker only on iOS Tauri builds', () => {
    expect(canShowAudioRoutePicker(true, 'ios')).toBe(true);
  });

  it('stays hidden everywhere else', () => {
    expect(canShowAudioRoutePicker(true, 'android')).toBe(false); // output switcher lives in the notification
    expect(canShowAudioRoutePicker(true, 'macos')).toBe(false);
    expect(canShowAudioRoutePicker(false, 'ios')).toBe(false); // web build on an iPhone
  });
});
