'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { PluginListener } from '@tauri-apps/api/core';
import {
  getPlaybackLocationFromCar,
  listenCarPlayIntents,
  pushLibraryToCar,
  pushPlaybackLocationToCar,
  setPendingCarPlayIntent,
} from '@/services/audiobook/carBridge';
import { prepareCarAudiobookLibrary } from '@/services/audiobook/carLibraryPreparation';
import { parseMediaOverlayLocation } from '@/services/audiobook/mediaOverlayLocation';
import { useLibraryStore } from '@/store/libraryStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { serializeConfig } from '@/utils/serializer';
import { DEFAULT_BOOK_SEARCH_CONFIG } from '@/services/constants';
import type { BookConfig } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';

/**
 * App-wide car bridge glue (CarPlay / Android Auto): keeps the native
 * audiobook browse cache in sync with the library and turns head-unit play
 * requests into navigation + a pending intent the playback hook consumes.
 * Every native call no-ops off mobile Tauri, so mounting this globally is
 * free on web and desktop.
 */
const CarBridgeListener: React.FC = () => {
  const router = useRouter();
  const library = useLibraryStore((state) => state.library);
  const libraryLoaded = useLibraryStore((state) => state.libraryLoaded);
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { user } = useAuth();
  const { pushChanges } = useSync();
  const reconcileInFlight = useRef(false);
  const reconcileQueued = useRef(false);
  const pushChangesRef = useRef(pushChanges);
  const cloudSyncedLocationsRef = useRef(new Map<string, number>());

  useEffect(() => {
    pushChangesRef.current = pushChanges;
  }, [pushChanges]);

  useEffect(() => {
    if (libraryLoaded) void pushLibraryToCar(library);
  }, [library, libraryLoaded]);

  useEffect(() => {
    if (libraryLoaded && appService) void prepareCarAudiobookLibrary(appService, library);
  }, [appService, library, libraryLoaded]);

  useEffect(() => {
    if (!libraryLoaded || !appService) return;
    let disposed = false;
    const isDocumentVisible = () => document.visibilityState !== 'hidden';
    const reconcile = async () => {
      if (disposed || !isDocumentVisible()) return;
      if (reconcileInFlight.current) {
        reconcileQueued.current = true;
        return;
      }
      reconcileInFlight.current = true;
      try {
        const syncConfigToCloud = async (config: BookConfig) => {
          if (!user) return;
          const location = parseMediaOverlayLocation(config.mediaOverlayLocation);
          if (!location || location.editionId !== config.bookHash) return;
          const syncKey = `${user.id}:${location.editionId}`;
          if ((cloudSyncedLocationsRef.current.get(syncKey) ?? 0) >= location.updatedAt) return;
          const compressed = JSON.parse(
            serializeConfig(config, settings.globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG),
          ) as BookConfig;
          delete compressed.booknotes;
          if (await pushChangesRef.current({ configs: [compressed] })) {
            cloudSyncedLocationsRef.current.set(syncKey, location.updatedAt);
          }
        };
        for (const book of library) {
          if (!book.hasAudio || book.deletedAt || !book.downloadedAt) continue;
          const parsedNativeLocation = parseMediaOverlayLocation(
            await getPlaybackLocationFromCar(book.hash),
          );
          const nativeLocation =
            parsedNativeLocation?.editionId === book.hash ? parsedNativeLocation : undefined;
          const config = await appService.loadBookConfig(book, settings);
          const parsedLocalLocation = parseMediaOverlayLocation(config.mediaOverlayLocation);
          const localLocation =
            parsedLocalLocation?.editionId === book.hash ? parsedLocalLocation : undefined;
          if (
            localLocation &&
            (!nativeLocation || localLocation.updatedAt > nativeLocation.updatedAt)
          ) {
            await pushPlaybackLocationToCar(localLocation);
            await syncConfigToCloud({
              ...config,
              bookHash: book.hash,
              metaHash: book.metaHash,
              mediaOverlayLocation: localLocation,
              updatedAt: Math.max(config.updatedAt ?? 0, localLocation.updatedAt),
            });
            continue;
          }
          if (!nativeLocation) continue;
          if (localLocation && localLocation.updatedAt >= nativeLocation.updatedAt) {
            await syncConfigToCloud({
              ...config,
              bookHash: book.hash,
              metaHash: book.metaHash,
              mediaOverlayLocation: localLocation,
              updatedAt: Math.max(config.updatedAt ?? 0, localLocation.updatedAt),
            });
            continue;
          }
          const updated: BookConfig = {
            ...config,
            bookHash: book.hash,
            metaHash: book.metaHash,
            mediaOverlayLocation: nativeLocation,
            updatedAt: Math.max(config.updatedAt ?? 0, nativeLocation.updatedAt),
          };
          await appService.saveBookConfig(book, updated, settings);
          const totalProgression = nativeLocation.locator.locations.totalProgression;
          if (typeof totalProgression === 'number' && book.audioDuration) {
            await useLibraryStore.getState().updateBook(envConfig, {
              ...book,
              audioPosition: totalProgression * book.audioDuration,
              updatedAt: updated.updatedAt,
            });
          }
          const openBook = useBookDataStore.getState().getBookData(book.hash);
          if (openBook?.config) {
            useBookDataStore.getState().setConfig(book.hash, {
              mediaOverlayLocation: nativeLocation,
              updatedAt: updated.updatedAt,
            });
          }
          await syncConfigToCloud(updated);
        }
      } catch (error) {
        console.warn('car audiobook location reconciliation failed', error);
      } finally {
        reconcileInFlight.current = false;
        if (!disposed && reconcileQueued.current && isDocumentVisible()) {
          reconcileQueued.current = false;
          void reconcile();
        }
      }
    };
    void reconcile();
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('focus', reconcile);
    return () => {
      disposed = true;
      reconcileQueued.current = false;
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('focus', reconcile);
    };
  }, [appService, envConfig, library, libraryLoaded, settings, user]);

  useEffect(() => {
    let listener: PluginListener | null = null;
    let disposed = false;
    void listenCarPlayIntents((intent) => {
      setPendingCarPlayIntent(intent);
      // An already-open reader for this book reacts immediately; otherwise
      // navigation mounts it and the hook consumes the pending intent.
      eventDispatcher.dispatch('car-audiobook-play', intent);
      navigateToReader(router, [intent.bookId]);
    }).then((l) => {
      if (disposed) void l?.unregister();
      else listener = l;
    });
    return () => {
      disposed = true;
      void listener?.unregister();
    };
  }, [router]);

  return null;
};

export default CarBridgeListener;
