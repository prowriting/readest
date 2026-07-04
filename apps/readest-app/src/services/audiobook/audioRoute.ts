import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';

/**
 * AirPlay / audio-output routing. iOS gets an explicit system route picker
 * (AVRoutePickerView via the native-tts plugin); Android's output switcher
 * already lives in the media notification, and web/desktop route through
 * the OS sound settings — so the in-player button is iOS-only.
 */
export const canShowAudioRoutePicker = (tauriApp: boolean, platform: string): boolean =>
  tauriApp && platform === 'ios';

export const audioRoutePickerAvailable = (): boolean =>
  canShowAudioRoutePicker(isTauriAppPlatform(), getOSPlatform());

export const showAudioRoutePicker = async (): Promise<void> => {
  if (!audioRoutePickerAvailable()) return;
  try {
    await invoke('plugin:native-tts|show_audio_route_picker');
  } catch (error) {
    console.warn('audio route picker failed', error);
  }
};
