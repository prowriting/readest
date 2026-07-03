import { describe, expect, it } from 'vitest';
import { mergeSyncedConfig } from '@/utils/configMerge';
import type { BookConfig } from '@/types/book';

const local: BookConfig = {
  bookHash: 'abc',
  location: 'epubcfi(/6/4!/4/2/1:0)',
  mediaOverlayLocation: { sectionIndex: 0, offset: 3, updatedAt: 100 },
  updatedAt: 1000,
};

describe('mergeSyncedConfig', () => {
  it('adopts a newer remote config, including the listening position', () => {
    const remote: BookConfig = {
      bookHash: 'abc',
      location: 'epubcfi(/6/8!/4/2/1:0)',
      mediaOverlayLocation: { sectionIndex: 2, offset: 1, updatedAt: 1900 },
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

  it('keeps everything local when the local config is newer', () => {
    const remote: BookConfig = {
      bookHash: 'abc',
      location: 'epubcfi(/6/8!)',
      mediaOverlayLocation: { sectionIndex: 2, offset: 1, updatedAt: 400 },
      updatedAt: 500,
    };
    const merged = mergeSyncedConfig(local, remote);
    expect(merged.mediaOverlayLocation).toEqual(local.mediaOverlayLocation);
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
});
