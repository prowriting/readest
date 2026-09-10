import { describe, expect, it } from 'vitest';
import {
  mergeDBBookConfig,
  mergeSyncedConfig,
  selectNewestMediaOverlayLocation,
} from '@/utils/configMerge';
import type { BookConfig } from '@/types/book';
import type { DBBookConfig } from '@/types/records';

const listeningLocation = (editionId: string, updatedAt: number, time: number) => ({
  schemaVersion: 2 as const,
  editionId,
  locator: {
    href: 'audio/chapter.mp3',
    type: 'audio/mpeg',
    locations: { fragments: [`t=${time}`], progression: time / 100 },
  },
  updatedAt,
});

const local: BookConfig = {
  bookHash: 'abc',
  location: 'epubcfi(/6/4!/4/2/1:0)',
  mediaOverlayLocation: listeningLocation('abc', 100, 3),
  updatedAt: 1000,
};

describe('mergeSyncedConfig', () => {
  it('adopts a newer remote config, including the listening position', () => {
    const remote: BookConfig = {
      bookHash: 'abc',
      location: 'epubcfi(/6/8!/4/2/1:0)',
      mediaOverlayLocation: listeningLocation('abc', 1900, 21),
      updatedAt: 2000,
    };
    const merged = mergeSyncedConfig(local, remote);
    expect(merged.mediaOverlayLocation).toEqual(remote.mediaOverlayLocation);
    expect(merged.location).toBe(remote.location);
  });

  it('a newer remote without a listening position never erases the local one', () => {
    const remote: BookConfig = { bookHash: 'abc', location: 'epubcfi(/6/8!)', updatedAt: 2000 };
    const merged = mergeSyncedConfig(local, remote);
    expect(merged.mediaOverlayLocation).toEqual(local.mediaOverlayLocation);
    expect(merged.location).toBe(remote.location);
  });

  it('keeps page state local while independently taking a newer listening marker', () => {
    const remote: BookConfig = {
      bookHash: 'abc',
      location: 'epubcfi(/6/8!)',
      mediaOverlayLocation: listeningLocation('abc', 400, 8),
      updatedAt: 500,
    };
    const merged = mergeSyncedConfig(local, remote);
    expect(merged.mediaOverlayLocation).toEqual(remote.mediaOverlayLocation);
    expect(merged.location).toBe(local.location);
    // Fields only the remote knows still fill local gaps.
    const sparseLocal: BookConfig = { bookHash: 'abc', updatedAt: 3000 };
    expect(mergeSyncedConfig(sparseLocal, remote).mediaOverlayLocation).toEqual(
      remote.mediaOverlayLocation,
    );
  });

  it('null and undefined remote values never clobber local ones', () => {
    const remote = {
      bookHash: 'abc',
      location: null,
      mediaOverlayLocation: undefined,
      updatedAt: 5000,
    } as unknown as BookConfig;
    const merged = mergeSyncedConfig(local, remote);
    expect(merged.location).toBe(local.location);
    expect(merged.mediaOverlayLocation).toEqual(local.mediaOverlayLocation);
  });

  it('merges listening position by its own timestamp, independently of the whole config', () => {
    const remote: BookConfig = {
      bookHash: 'abc',
      location: 'epubcfi(/6/8!)',
      mediaOverlayLocation: listeningLocation('abc', 200, 9),
      updatedAt: 50,
    };
    const merged = mergeSyncedConfig(local, remote);
    expect(merged.location).toBe(local.location);
    expect(merged.mediaOverlayLocation).toEqual(remote.mediaOverlayLocation);
  });

  it('never applies listening progress from another edition', () => {
    const remote: BookConfig = {
      bookHash: 'abc',
      mediaOverlayLocation: listeningLocation('different-edition', 5000, 90),
      updatedAt: 5000,
    };
    expect(mergeSyncedConfig(local, remote).mediaOverlayLocation).toEqual(
      local.mediaOverlayLocation,
    );
  });

  it('uses the explicitly selected edition when a metadata match returns another book hash', () => {
    const localWithoutHash: BookConfig = {
      mediaOverlayLocation: listeningLocation('current-edition', 100, 3),
      updatedAt: 100,
    };
    const metadataMatchedRemote: BookConfig = {
      bookHash: 'other-edition',
      mediaOverlayLocation: listeningLocation('other-edition', 5000, 90),
      updatedAt: 5000,
    };

    const merged = mergeSyncedConfig(localWithoutHash, metadataMatchedRemote, 'current-edition');
    expect(merged.mediaOverlayLocation).toEqual(localWithoutHash.mediaOverlayLocation);
    expect(merged.bookHash).toBe('current-edition');
  });
});

describe('selectNewestMediaOverlayLocation', () => {
  it('preserves a newer server locator when a newer whole config omits audio progress', () => {
    const server = listeningLocation('abc', 5000, 50);
    expect(selectNewestMediaOverlayLocation(undefined, server, 'abc')).toEqual(server);
  });

  it('allows a newer locator to update independently of an older whole config', () => {
    const incoming = listeningLocation('abc', 6000, 60);
    const server = listeningLocation('abc', 5000, 50);
    expect(selectNewestMediaOverlayLocation(incoming, server, 'abc')).toEqual(incoming);
  });

  it('rejects legacy and metadata-matched positions from another edition', () => {
    const server = listeningLocation('abc', 5000, 50);
    expect(
      selectNewestMediaOverlayLocation(
        { sectionIndex: 2, offset: 10, updatedAt: 9000 },
        server,
        'abc',
      ),
    ).toEqual(server);
    expect(
      selectNewestMediaOverlayLocation(listeningLocation('other', 9000, 90), server, 'abc'),
    ).toEqual(server);
  });
});

describe('mergeDBBookConfig', () => {
  const dbConfig = (
    updatedAt: number,
    mediaOverlayLocation?: ReturnType<typeof listeningLocation>,
  ): DBBookConfig => ({
    user_id: 'user-1',
    book_hash: 'abc',
    location: `page-${updatedAt}`,
    updated_at: new Date(updatedAt).toISOString(),
    ...(mediaOverlayLocation
      ? { media_overlay_location: JSON.stringify(mediaOverlayLocation) }
      : {}),
  });

  it('preserves a newer server locator when a newer whole client config omits it', () => {
    const serverLocation = listeningLocation('abc', 5000, 50);
    const result = mergeDBBookConfig(dbConfig(7000), dbConfig(6000, serverLocation), 8000);

    expect(result.shouldUpdate).toBe(true);
    expect(result.record.location).toBe('page-7000');
    expect(JSON.parse(result.record.media_overlay_location!)).toEqual(serverLocation);
  });

  it('updates only the locator when an older whole config contains newer audio progress', () => {
    const incomingLocation = listeningLocation('abc', 7000, 70);
    const serverLocation = listeningLocation('abc', 5000, 50);
    const result = mergeDBBookConfig(
      dbConfig(4000, incomingLocation),
      dbConfig(6000, serverLocation),
      8000,
    );

    expect(result.shouldUpdate).toBe(true);
    expect(result.record.location).toBe('page-6000');
    expect(JSON.parse(result.record.media_overlay_location!)).toEqual(incomingLocation);
    expect(result.record.updated_at).toBe(new Date(8000).toISOString());
  });

  it('advances the server timestamp when only the locator wins under clock skew', () => {
    const incomingLocation = listeningLocation('abc', 7000, 70);
    const serverLocation = listeningLocation('abc', 5000, 50);
    const result = mergeDBBookConfig(
      dbConfig(4000, incomingLocation),
      dbConfig(10_000, serverLocation),
      8000,
    );

    expect(result.shouldUpdate).toBe(true);
    expect(result.record.updated_at).toBe(new Date(10_001).toISOString());
  });

  it('keeps the server authoritative when neither config nor locator is newer', () => {
    const incomingLocation = listeningLocation('abc', 4000, 40);
    const serverLocation = listeningLocation('abc', 5000, 50);
    const server = dbConfig(6000, serverLocation);
    const result = mergeDBBookConfig(dbConfig(3000, incomingLocation), server, 8000);

    expect(result).toEqual({ record: server, shouldUpdate: false });
  });

  it('ignores malformed serialized and mismatched-edition locators without throwing', () => {
    const incoming = dbConfig(7000, listeningLocation('other-edition', 9000, 90));
    const server = { ...dbConfig(6000), media_overlay_location: '{broken-json' };

    expect(() => mergeDBBookConfig(incoming, server, 8000)).not.toThrow();
    const result = mergeDBBookConfig(incoming, server, 8000);
    expect(result.record.media_overlay_location).toBeUndefined();
  });
});
