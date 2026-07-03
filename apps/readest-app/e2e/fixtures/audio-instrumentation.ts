import type { Page } from '@playwright/test';

/**
 * Audio elements created with `new Audio()` (as foliate-js's MediaOverlay
 * does) never enter the DOM, so locators cannot observe them. These helpers
 * intercept `HTMLMediaElement.prototype` so specs can assert on seeks,
 * playback-rate changes, and the most recently read `currentTime`.
 *
 * Looping elements are ignored: the TTS layer keeps the mobile audio channel
 * alive with a looped silent clip, which would otherwise pollute recordings.
 *
 * Call {@link installAudioInstrumentation} BEFORE the first navigation —
 * init scripts only apply to documents created after registration.
 */

interface InstrumentedWindow {
  __audioSeeks: number[];
  __audioRates: number[];
  __audioVolumes: number[];
  __audioLastTime: number;
}

export async function installAudioInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tracked = window as unknown as InstrumentedWindow;
    tracked.__audioSeeks = [];
    tracked.__audioRates = [];
    tracked.__audioVolumes = [];
    tracked.__audioLastTime = -1;

    const timeDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    if (timeDesc?.get && timeDesc.set) {
      const nativeGet = timeDesc.get;
      const nativeSet = timeDesc.set;
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        get(this: HTMLMediaElement): number {
          const value = nativeGet.call(this) as number;
          if (this instanceof HTMLAudioElement && !this.loop) tracked.__audioLastTime = value;
          return value;
        },
        set(this: HTMLMediaElement, value: number) {
          if (this instanceof HTMLAudioElement && !this.loop) tracked.__audioSeeks.push(value);
          nativeSet.call(this, value);
        },
        configurable: true,
      });
    }

    const volumeDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
    if (volumeDesc?.get && volumeDesc.set) {
      const nativeGet = volumeDesc.get;
      const nativeSet = volumeDesc.set;
      Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
        get(this: HTMLMediaElement): number {
          return nativeGet.call(this) as number;
        },
        set(this: HTMLMediaElement, value: number) {
          if (this instanceof HTMLAudioElement && !this.loop) tracked.__audioVolumes.push(value);
          nativeSet.call(this, value);
        },
        configurable: true,
      });
    }

    const rateDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
    if (rateDesc?.get && rateDesc.set) {
      const nativeGet = rateDesc.get;
      const nativeSet = rateDesc.set;
      Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        get(this: HTMLMediaElement): number {
          return nativeGet.call(this) as number;
        },
        set(this: HTMLMediaElement, value: number) {
          if (this instanceof HTMLAudioElement && !this.loop) tracked.__audioRates.push(value);
          nativeSet.call(this, value);
        },
        configurable: true,
      });
    }
  });
}

/** Every `currentTime` assignment on non-looping audio, in order. */
export async function recordedSeeks(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as InstrumentedWindow).__audioSeeks ?? []);
}

/** Every `volume` assignment on non-looping audio, in order. */
export async function recordedVolumes(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as InstrumentedWindow).__audioVolumes ?? []);
}

/** Every `playbackRate` assignment on non-looping audio, in order. */
export async function recordedRates(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as InstrumentedWindow).__audioRates ?? []);
}

/**
 * The most recently *read* `currentTime` of a non-looping audio element, or
 * -1 if none was read yet. Playback engines poll currentTime on `timeupdate`,
 * so during playback this tracks the live audio position.
 */
export async function lastAudioTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as InstrumentedWindow).__audioLastTime ?? -1);
}
