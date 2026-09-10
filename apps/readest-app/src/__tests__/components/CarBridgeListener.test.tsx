import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaOverlayLocation } from '@/types/book';

const mocks = vi.hoisted(() => {
  const location = {
    schemaVersion: 2 as const,
    editionId: 'edition-1',
    locator: {
      href: 'audio/chapter.mp3',
      type: 'audio/mpeg',
      locations: { fragments: ['t=12'], totalProgression: 0.2 },
    },
    updatedAt: 2000,
  };
  const book = {
    hash: 'edition-1',
    metaHash: 'metadata-match',
    title: 'Book',
    author: 'Author',
    format: 'EPUB',
    hasAudio: true,
    downloadedAt: 1,
    audioDuration: 100,
    updatedAt: 1000,
  };
  const config = { bookHash: book.hash, mediaOverlayLocation: location, updatedAt: 2000 };
  const updateBook = vi.fn(async () => {});
  const libraryState = {
    library: [book],
    libraryLoaded: true,
    updateBook,
  };
  const useLibraryStore = Object.assign(
    (selector: (state: typeof libraryState) => unknown) => selector(libraryState),
    { getState: () => libraryState },
  );
  const bookDataState = {
    getBookData: vi.fn<() => { config: typeof config } | undefined>(() => undefined),
    setConfig: vi.fn(),
  };
  const useBookDataStore = Object.assign(() => bookDataState, {
    getState: () => bookDataState,
  });
  return {
    appService: {
      loadBookConfig: vi.fn(async () => config),
      saveBookConfig: vi.fn(async () => {}),
    },
    book,
    config,
    location,
    getPlaybackLocationFromCar: vi.fn<
      (bookId: string) => Promise<MediaOverlayLocation | undefined>
    >(async () => undefined),
    listenCarPlayIntents: vi.fn(async () => null),
    prepareCarAudiobookLibrary: vi.fn(async () => {}),
    pushChanges: vi.fn(async () => true),
    pushLibraryToCar: vi.fn(async () => {}),
    pushPlaybackLocationToCar: vi.fn(async () => {}),
    updateBook,
    bookDataState,
    useBookDataStore,
    useLibraryStore,
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/services/audiobook/carBridge', () => ({
  getPlaybackLocationFromCar: mocks.getPlaybackLocationFromCar,
  listenCarPlayIntents: mocks.listenCarPlayIntents,
  pushLibraryToCar: mocks.pushLibraryToCar,
  pushPlaybackLocationToCar: mocks.pushPlaybackLocationToCar,
  setPendingCarPlayIntent: vi.fn(),
}));
vi.mock('@/services/audiobook/carLibraryPreparation', () => ({
  prepareCarAudiobookLibrary: mocks.prepareCarAudiobookLibrary,
}));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: mocks.useLibraryStore }));
vi.mock('@/store/bookDataStore', () => ({ useBookDataStore: mocks.useBookDataStore }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: mocks.appService }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/useSync', () => ({ useSync: () => ({ pushChanges: mocks.pushChanges }) }));
vi.mock('@/utils/serializer', () => ({
  serializeConfig: (config: unknown) => JSON.stringify(config),
}));
vi.mock('@/utils/nav', () => ({ navigateToReader: vi.fn() }));

import CarBridgeListener from '@/components/CarBridgeListener';

describe('CarBridgeListener location reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.mediaOverlayLocation = mocks.location;
    mocks.config.updatedAt = mocks.location.updatedAt;
    mocks.bookDataState.getBookData.mockReturnValue(undefined);
    mocks.getPlaybackLocationFromCar.mockResolvedValue(undefined);
    mocks.pushChanges.mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('schedules cloud sync when local progress is newer than native car progress', async () => {
    render(<CarBridgeListener />);

    await waitFor(() =>
      expect(mocks.pushPlaybackLocationToCar).toHaveBeenCalledWith(mocks.location),
    );
    await waitFor(() =>
      expect(mocks.pushChanges).toHaveBeenCalledWith({
        configs: [expect.objectContaining({ mediaOverlayLocation: mocks.location })],
      }),
    );
  });

  it('retries a failed cloud push on the next foreground reconciliation', async () => {
    mocks.getPlaybackLocationFromCar.mockResolvedValue(mocks.location);
    mocks.pushChanges.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<CarBridgeListener />);

    await waitFor(() => expect(mocks.pushChanges).toHaveBeenCalledTimes(1));
    fireEvent.focus(window);
    await waitFor(() => expect(mocks.pushChanges).toHaveBeenCalledTimes(2));
  });

  it('does not repeat a successful cloud push for an unchanged locator', async () => {
    mocks.getPlaybackLocationFromCar.mockResolvedValue(mocks.location);
    render(<CarBridgeListener />);

    await waitFor(() => expect(mocks.pushChanges).toHaveBeenCalledTimes(1));
    fireEvent.focus(window);
    await waitFor(() => expect(mocks.getPlaybackLocationFromCar).toHaveBeenCalledTimes(2));
    expect(mocks.pushChanges).toHaveBeenCalledTimes(1);
  });

  it('persists and syncs newer progress returned by native car playback', async () => {
    const nativeLocation = {
      ...mocks.location,
      locator: {
        ...mocks.location.locator,
        locations: { fragments: ['t=45'], totalProgression: 0.6 },
      },
      updatedAt: 3000,
    };
    mocks.getPlaybackLocationFromCar.mockResolvedValue(nativeLocation);
    render(<CarBridgeListener />);

    await waitFor(() =>
      expect(mocks.appService.saveBookConfig).toHaveBeenCalledWith(
        mocks.book,
        expect.objectContaining({ mediaOverlayLocation: nativeLocation, updatedAt: 3000 }),
        {},
      ),
    );
    expect(mocks.updateBook).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ audioPosition: 60, updatedAt: 3000 }),
    );
    expect(mocks.pushChanges).toHaveBeenCalledWith({
      configs: [expect.objectContaining({ mediaOverlayLocation: nativeLocation })],
    });
  });

  it('does not apply a locator from a different audiobook edition', async () => {
    const foreignLocation = {
      ...mocks.location,
      editionId: 'different-edition',
      updatedAt: 9000,
    };
    mocks.getPlaybackLocationFromCar.mockResolvedValue(foreignLocation);
    mocks.bookDataState.getBookData.mockReturnValue({ config: mocks.config });

    render(<CarBridgeListener />);

    await waitFor(() => expect(mocks.getPlaybackLocationFromCar).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(mocks.pushPlaybackLocationToCar).toHaveBeenCalledWith(mocks.location),
    );
    expect(mocks.appService.saveBookConfig).not.toHaveBeenCalled();
    expect(mocks.bookDataState.setConfig).not.toHaveBeenCalled();
  });

  it('does not let stale native progress move an open reader backwards', async () => {
    const staleNativeLocation = {
      ...mocks.location,
      locator: {
        ...mocks.location.locator,
        locations: { fragments: ['t=3'], totalProgression: 0.03 },
      },
      updatedAt: 1000,
    };
    mocks.getPlaybackLocationFromCar.mockResolvedValue(staleNativeLocation);
    mocks.bookDataState.getBookData.mockReturnValue({ config: mocks.config });

    render(<CarBridgeListener />);

    await waitFor(() =>
      expect(mocks.pushPlaybackLocationToCar).toHaveBeenCalledWith(mocks.location),
    );
    expect(mocks.appService.saveBookConfig).not.toHaveBeenCalled();
    expect(mocks.bookDataState.setConfig).not.toHaveBeenCalled();
  });

  it('rechecks native progress when a foreground event arrives during reconciliation', async () => {
    let resolveFirstRead: ((location: MediaOverlayLocation | undefined) => void) | undefined;
    const firstRead = new Promise<MediaOverlayLocation | undefined>((resolve) => {
      resolveFirstRead = resolve;
    });
    const latestNativeLocation = {
      ...mocks.location,
      locator: {
        ...mocks.location.locator,
        locations: { fragments: ['t=75'], totalProgression: 0.75 },
      },
      updatedAt: 4000,
    };
    mocks.getPlaybackLocationFromCar
      .mockReturnValueOnce(firstRead)
      .mockResolvedValue(latestNativeLocation);

    render(<CarBridgeListener />);
    await waitFor(() => expect(mocks.getPlaybackLocationFromCar).toHaveBeenCalledTimes(1));

    // A rapid disconnect/foreground can occur while the initial app-resume
    // read is still awaiting the native bridge. That event must be queued,
    // otherwise the just-saved final car position is missed until another
    // unrelated focus change.
    fireEvent.focus(window);
    resolveFirstRead?.({ ...mocks.location, updatedAt: 3000 });

    await waitFor(() => expect(mocks.getPlaybackLocationFromCar).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mocks.appService.saveBookConfig).toHaveBeenCalledWith(
        mocks.book,
        expect.objectContaining({ mediaOverlayLocation: latestNativeLocation }),
        {},
      ),
    );
  });

  it('compares against local progress again after a delayed native read completes', async () => {
    let resolveNativeRead: ((location: MediaOverlayLocation | undefined) => void) | undefined;
    mocks.getPlaybackLocationFromCar.mockReturnValueOnce(
      new Promise<MediaOverlayLocation | undefined>((resolve) => {
        resolveNativeRead = resolve;
      }),
    );
    render(<CarBridgeListener />);
    await waitFor(() => expect(mocks.getPlaybackLocationFromCar).toHaveBeenCalledOnce());

    const newerLocalLocation = {
      ...mocks.location,
      locator: {
        ...mocks.location.locator,
        locations: { fragments: ['t=90'], totalProgression: 0.9 },
      },
      updatedAt: 5000,
    };
    mocks.config.mediaOverlayLocation = newerLocalLocation;
    mocks.config.updatedAt = newerLocalLocation.updatedAt;
    resolveNativeRead?.({ ...mocks.location, updatedAt: 3000 });

    await waitFor(() =>
      expect(mocks.pushPlaybackLocationToCar).toHaveBeenCalledWith(newerLocalLocation),
    );
    expect(mocks.appService.saveBookConfig).not.toHaveBeenCalled();
  });
});
