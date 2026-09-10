import { describe, expect, it } from 'vitest';
import contract from '../../../../src-tauri/plugins/tauri-plugin-native-tts/ios/Tests/PluginTests/Fixtures/audiobook-playback-contract.json';
import {
  type AudiobookCommand,
  createWebAudiobookPlaybackBackend,
} from '@/services/audiobook/playbackBackend';
import type { MediaOverlayPlaybackManifest, MediaOverlayEngine } from '@/types/mediaOverlay';

class ContractMediaOverlayEngine extends EventTarget implements MediaOverlayEngine {
  activeSectionIndex = -1;
  sectionOffset = 0;
  sectionDuration = contract.durationMs / 1000;
  activeAudioSource: string | null = null;
  audioTime = 0;
  audioDuration = contract.durationMs / 1000;
  private rate = 1;
  playbackVolume = 1;

  async start(sectionIndex: number): Promise<void> {
    this.activeSectionIndex = sectionIndex;
    this.sectionOffset = 0;
    this.activeAudioSource = sectionIndex === 0 ? 'audio/chapter.mp3' : 'audio/chapter-2.mp3';
    this.audioTime = 0;
  }

  async startAtOffset(sectionIndex: number, offset: number): Promise<void> {
    await this.start(sectionIndex);
    this.sectionOffset = offset;
    this.audioTime = offset;
  }

  async synchronizeAtOffset(): Promise<boolean> {
    return true;
  }

  async seekRelative(seconds: number): Promise<void> {
    this.sectionOffset = Math.max(0, Math.min(this.sectionDuration, this.sectionOffset + seconds));
    this.audioTime = this.sectionOffset;
  }

  async playFromText(): Promise<boolean> {
    return false;
  }

  async textOffset(): Promise<number | null> {
    return null;
  }

  async exportPlaybackManifest(): Promise<MediaOverlayPlaybackManifest> {
    return {
      sections: [
        {
          sectionIndex: 0,
          duration: this.sectionDuration,
          segments: [
            {
              source: 'audio/chapter.mp3',
              type: 'audio/mpeg',
              clipBegin: 0,
              clipEnd: this.sectionDuration,
              sourceDuration: this.sectionDuration,
              cues: [{ offset: 0, text: 'text/chapter.xhtml#p1' }],
            },
          ],
        },
        {
          sectionIndex: 1,
          duration: this.sectionDuration,
          segments: [
            {
              source: 'audio/chapter-2.mp3',
              type: 'audio/mpeg',
              clipBegin: 0,
              clipEnd: this.sectionDuration,
              sourceDuration: this.sectionDuration,
              cues: [{ offset: 0, text: 'text/chapter-2.xhtml#p1' }],
            },
          ],
        },
      ],
    };
  }

  async loadAudioSource(): Promise<Blob> {
    return new Blob();
  }

  pause(): void {}
  resume(): void {}

  stop(): void {
    this.activeSectionIndex = -1;
    this.sectionOffset = 0;
    this.activeAudioSource = null;
    this.audioTime = 0;
  }

  prev(): void {}
  next(): void {}
  setVolume(volume: number): void {
    this.playbackVolume = volume;
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  get playbackRate(): number {
    return this.rate;
  }
}

interface ContractExpected {
  bookId: string;
  state: string;
  error?: string;
  playbackRate?: number;
  chapterIndex?: number;
  timeSeconds?: number;
  isBookmarked?: boolean;
  sleepTimerEndsAt?: number;
  sleepTimerAbsent?: boolean;
  locationAbsent?: boolean;
  volume?: number;
}

describe('shared audiobook playback contract: web', () => {
  for (const scenario of contract.scenarios) {
    it(scenario.id, async () => {
      const engine = new ContractMediaOverlayEngine();
      const backend = createWebAudiobookPlaybackBackend({
        bookId: contract.availableBookId,
        engine,
      });
      let snapshot = await backend.getSnapshot();
      for (const command of scenario.commands as AudiobookCommand[]) {
        snapshot = await backend.control(command);
      }

      const expected = scenario.expected as ContractExpected;
      expect(snapshot).toMatchObject({
        bookId: expected.bookId,
        state: expected.state,
        ...(expected.error ? { error: expected.error } : {}),
        ...(expected.playbackRate ? { playbackRate: expected.playbackRate } : {}),
        ...(expected.chapterIndex !== undefined ? { chapterIndex: expected.chapterIndex } : {}),
        ...(expected.isBookmarked !== undefined ? { isBookmarked: expected.isBookmarked } : {}),
        ...(expected.sleepTimerEndsAt !== undefined
          ? { sleepTimerEndsAt: expected.sleepTimerEndsAt }
          : {}),
      });
      if (expected.timeSeconds !== undefined) {
        const fragment = snapshot?.location?.locator.locations.fragments[0];
        expect(Number(fragment?.replace(/^t=/, ''))).toBeCloseTo(expected.timeSeconds);
      }
      if (expected.sleepTimerAbsent) expect(snapshot).not.toHaveProperty('sleepTimerEndsAt');
      if (expected.locationAbsent) expect(snapshot).not.toHaveProperty('location');
      if (expected.volume !== undefined) expect(engine.playbackVolume).toBe(expected.volume);
    });
  }
});
