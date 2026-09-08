'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { PluginListener } from '@tauri-apps/api/core';
import {
  listenCarPlayIntents,
  pushLibraryToCar,
  setPendingCarPlayIntent,
} from '@/services/audiobook/carBridge';
import { useLibraryStore } from '@/store/libraryStore';
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

  useEffect(() => {
    if (libraryLoaded) void pushLibraryToCar(library);
  }, [library, libraryLoaded]);

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
