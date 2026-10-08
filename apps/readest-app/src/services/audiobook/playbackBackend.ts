import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import {
  createMediaOverlayLocation,
  resolveMediaOverlayLocation,
} from '@/services/audiobook/mediaOverlayLocation';
import { isTauriAppPlatform } from '@/services/environment';
import type { MediaOverlayLocation } from '@/types/book';
import type { MediaOverlayEngine } from '@/types/mediaOverlay';

export type AudiobookPlaybackState =
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'stopped'
  | 'error';

export type AudiobookCommand =
  | { action: 'play'; bookId: string; location?: MediaOverlayLocation; rate?: number }
  | { action: 'startChapter'; bookId: string; chapterIndex: number }
  | { action: 'pause' | 'stop' | 'nextChapter' | 'previousChapter' }
  | { action: 'seekRelative'; offsetMs: number }
  | { action: 'seekToLocator'; location: MediaOverlayLocation }
  | { action: 'setRate'; rate: number }
  | { action: 'setVolume'; volume: number }
  | { action: 'addBookmark' }
  | { action: 'setSleepTimer'; mode: 'duration' | 'endOfChapter'; endsAt?: number }
  | { action: 'cancelSleepTimer' };

export interface AudiobookPlaybackSnapshot {
  sessionId: string;
  sequence: number;
  bookId: string;
  state: AudiobookPlaybackState;
  location?: MediaOverlayLocation;
  chapterIndex: number;
  chapterPositionMs: number;
  chapterDurationMs: number;
  playbackRate: number;
  isBookmarked: boolean;
  sleepTimerEndsAt?: number;
  error?: string;
}

export interface AudiobookSnapshotCursor {
  sessionId: string;
  sequence: number;
}

export const isNewerPlaybackSnapshot = (
  previous: AudiobookSnapshotCursor | null,
  next: AudiobookSnapshotCursor,
  retiredSessionIds: ReadonlySet<string> = new Set(),
): boolean =>
  previous?.sessionId !== next.sessionId
    ? !retiredSessionIds.has(next.sessionId)
    : next.sequence > previous.sequence;

export interface AudiobookPlaybackBackend {
  readonly kind: 'native' | 'web';
  control(command: AudiobookCommand): Promise<AudiobookPlaybackSnapshot | undefined>;
  getSnapshot(): Promise<AudiobookPlaybackSnapshot | undefined>;
  subscribe(
    listener: (snapshot: AudiobookPlaybackSnapshot) => void,
  ): Promise<Pick<PluginListener, 'unregister'> | null>;
}

class NativeAudiobookPlaybackBackend implements AudiobookPlaybackBackend {
  readonly kind = 'native' as const;

  control(command: AudiobookCommand): Promise<AudiobookPlaybackSnapshot> {
    return invoke('plugin:native-tts|control_audiobook_playback', { payload: command });
  }

  getSnapshot(): Promise<AudiobookPlaybackSnapshot> {
    return invoke('plugin:native-tts|get_audiobook_playback_snapshot');
  }

  subscribe(listener: (snapshot: AudiobookPlaybackSnapshot) => void): Promise<PluginListener> {
    return addPluginListener('native-tts', 'audiobook-playback-state', listener);
  }
}

export interface WebAudiobookPlaybackBackendOptions {
  bookId: string;
  engine: MediaOverlayEngine;
}

let webSessionSequence = 0;

class WebAudiobookPlaybackBackend implements AudiobookPlaybackBackend {
  readonly kind = 'web' as const;
  private readonly sessionId = `web-${++webSessionSequence}`;
  private sequence = 0;
  private operationVersion = 0;
  private state: AudiobookPlaybackState = 'stopped';
  private playbackRate = 1;
  private bookmarkedTextTarget: string | undefined;
  private sleepTimerEndsAt: number | undefined;
  private lastLocation: MediaOverlayLocation | undefined;
  private lastError: string | undefined;
  private chapterIndex = -1;
  private chapterPositionMs = 0;
  private chapterDurationMs = 0;
  private readonly listeners = new Set<(snapshot: AudiobookPlaybackSnapshot) => void>();

  constructor(private readonly options?: WebAudiobookPlaybackBackendOptions) {}

  private readonly onHighlight = () => {
    this.state = 'playing';
    this.lastError = undefined;
    void this.captureAndPublish(this.operationVersion);
  };

  private readonly onPause = () => {
    this.state = 'paused';
    void this.captureAndPublish(this.operationVersion);
  };

  private readonly onEnded = () => {
    this.state = 'ended';
    void this.captureAndPublish(this.operationVersion);
  };

  private readonly onError = (event: Event) => {
    this.state = 'error';
    const detail = (event as CustomEvent<unknown>).detail;
    this.lastError = detail instanceof Error ? detail.message : String(detail ?? 'playback_error');
    void this.captureAndPublish(this.operationVersion);
  };

  private attachEngineListeners(): void {
    const engine = this.options?.engine;
    engine?.addEventListener('highlight', this.onHighlight);
    engine?.addEventListener('pause', this.onPause);
    engine?.addEventListener('ended', this.onEnded);
    engine?.addEventListener('error', this.onError);
  }

  private detachEngineListeners(): void {
    const engine = this.options?.engine;
    engine?.removeEventListener('highlight', this.onHighlight);
    engine?.removeEventListener('pause', this.onPause);
    engine?.removeEventListener('ended', this.onEnded);
    engine?.removeEventListener('error', this.onError);
  }

  private async captureLocation(): Promise<void> {
    const { engine, bookId } = this.options ?? {};
    if (!engine || !bookId || engine.activeSectionIndex < 0) return;
    this.chapterIndex = engine.activeSectionIndex;
    this.chapterPositionMs = Math.round(engine.sectionOffset * 1000);
    this.chapterDurationMs = Math.round(engine.sectionDuration * 1000);
    this.lastLocation = createMediaOverlayLocation({
      editionId: bookId,
      manifest: await engine.exportPlaybackManifest(),
      sectionIndex: engine.activeSectionIndex,
      sectionOffset: engine.sectionOffset,
      updatedAt: Date.now(),
    });
  }

  private snapshot(bookId = this.options?.bookId ?? '', error?: string): AudiobookPlaybackSnapshot {
    const snapshotError = error ?? this.lastError;
    return {
      sessionId: this.sessionId,
      sequence: this.sequence,
      bookId,
      state: snapshotError ? 'error' : this.state,
      ...(this.lastLocation ? { location: this.lastLocation } : {}),
      chapterIndex: this.chapterIndex,
      chapterPositionMs: this.chapterPositionMs,
      chapterDurationMs: this.chapterDurationMs,
      playbackRate: this.playbackRate,
      isBookmarked:
        this.bookmarkedTextTarget !== undefined &&
        this.bookmarkedTextTarget === this.currentTextTarget(),
      ...(this.sleepTimerEndsAt !== undefined ? { sleepTimerEndsAt: this.sleepTimerEndsAt } : {}),
      ...(snapshotError ? { error: snapshotError } : {}),
    };
  }

  private currentTextTarget(): string | undefined {
    const textLocator = this.lastLocation?.textLocator;
    const fragment = textLocator?.locations.fragments[0];
    return textLocator && fragment ? `${textLocator.href}#${fragment}` : undefined;
  }

  private publish(bookId?: string, error?: string): AudiobookPlaybackSnapshot {
    this.sequence += 1;
    const snapshot = this.snapshot(bookId, error);
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  private async captureAndPublish(
    operationVersion: number,
  ): Promise<AudiobookPlaybackSnapshot | undefined> {
    await this.captureLocation();
    if (operationVersion !== this.operationVersion) return undefined;
    return this.publish();
  }

  private manifestUnavailable(bookId: string): AudiobookPlaybackSnapshot {
    this.options?.engine.stop();
    this.state = 'error';
    this.lastError = 'manifest_unavailable';
    this.lastLocation = undefined;
    this.chapterIndex = -1;
    this.chapterPositionMs = 0;
    this.chapterDurationMs = 0;
    this.bookmarkedTextTarget = undefined;
    return this.publish(bookId, 'manifest_unavailable');
  }

  private async navigateChapter(direction: -1 | 1): Promise<void> {
    const engine = this.options?.engine;
    if (!engine || engine.activeSectionIndex < 0) return;
    const sections = (await engine.exportPlaybackManifest()).sections;
    const current = sections.findIndex(
      (section) => section.sectionIndex === engine.activeSectionIndex,
    );
    if (current < 0) return;
    const target = sections[current + direction];
    if (target) {
      await engine.start(target.sectionIndex);
    } else if (direction < 0) {
      await engine.start(sections[current]!.sectionIndex);
    } else {
      await engine.start(Math.max(...sections.map((section) => section.sectionIndex)) + 1);
    }
  }

  async control(command: AudiobookCommand): Promise<AudiobookPlaybackSnapshot> {
    this.operationVersion += 1;
    const { engine, bookId } = this.options ?? {};
    if (
      !engine ||
      !bookId ||
      ('bookId' in command &&
        command.bookId !== bookId &&
        (command.action === 'play' || command.action === 'startChapter'))
    ) {
      return this.manifestUnavailable('bookId' in command ? command.bookId : (bookId ?? ''));
    }

    switch (command.action) {
      case 'play': {
        this.lastError = undefined;
        if (command.rate !== undefined) {
          this.playbackRate = command.rate;
          engine.setRate(command.rate);
        }
        if (command.location) {
          const target = resolveMediaOverlayLocation(
            await engine.exportPlaybackManifest(),
            command.location,
            bookId,
          );
          if (!target) return this.manifestUnavailable(bookId);
          engine.stop();
          await engine.startAtOffset(target.sectionIndex, target.sectionOffset);
        } else if (this.state === 'paused') {
          engine.resume();
        } else {
          const manifest = await engine.exportPlaybackManifest();
          await engine.start(manifest.sections[0]?.sectionIndex ?? 0);
        }
        this.state = 'loading';
        break;
      }
      case 'startChapter':
        this.lastError = undefined;
        await engine.start(command.chapterIndex);
        this.state = 'loading';
        break;
      case 'pause':
        engine.pause();
        this.state = 'paused';
        break;
      case 'stop':
        await this.captureLocation();
        engine.stop();
        this.state = 'stopped';
        return this.publish();
      case 'nextChapter':
        await this.navigateChapter(1);
        break;
      case 'previousChapter':
        await this.navigateChapter(-1);
        break;
      case 'seekRelative':
        await engine.seekRelative(command.offsetMs / 1000);
        break;
      case 'seekToLocator': {
        const target = resolveMediaOverlayLocation(
          await engine.exportPlaybackManifest(),
          command.location,
          bookId,
        );
        if (!target) return this.manifestUnavailable(bookId);
        await engine.startAtOffset(target.sectionIndex, target.sectionOffset);
        break;
      }
      case 'setRate':
        this.playbackRate = command.rate;
        engine.setRate(command.rate);
        break;
      case 'setVolume':
        engine.setVolume(command.volume);
        break;
      case 'addBookmark':
        await this.captureLocation();
        this.bookmarkedTextTarget = this.currentTextTarget();
        return this.publish();
      case 'setSleepTimer':
        this.sleepTimerEndsAt = command.mode === 'duration' ? command.endsAt : undefined;
        break;
      case 'cancelSleepTimer':
        this.sleepTimerEndsAt = undefined;
        engine.setVolume(1);
        break;
    }
    await this.captureLocation();
    return this.publish();
  }

  async getSnapshot(): Promise<AudiobookPlaybackSnapshot> {
    await this.captureLocation();
    return this.snapshot();
  }

  async subscribe(
    listener: (snapshot: AudiobookPlaybackSnapshot) => void,
  ): Promise<Pick<PluginListener, 'unregister'>> {
    if (this.listeners.size === 0) this.attachEngineListeners();
    this.listeners.add(listener);
    return {
      unregister: async () => {
        this.listeners.delete(listener);
        if (this.listeners.size === 0) this.detachEngineListeners();
      },
    };
  }
}

const nativeBackend = new NativeAudiobookPlaybackBackend();
export const createWebAudiobookPlaybackBackend = (
  options: WebAudiobookPlaybackBackendOptions,
): AudiobookPlaybackBackend => new WebAudiobookPlaybackBackend(options);

export const createAudiobookPlaybackBackend = (
  webOptions?: WebAudiobookPlaybackBackendOptions,
): AudiobookPlaybackBackend =>
  // iPadOS can advertise a Macintosh user agent. Playback ownership must use
  // the native platform, otherwise the web and system players can disagree.
  isTauriAppPlatform() && ['android', 'ios'].includes(osType())
    ? nativeBackend
    : new WebAudiobookPlaybackBackend(webOptions);
