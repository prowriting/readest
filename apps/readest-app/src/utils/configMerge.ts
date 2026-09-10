import type { BookConfig, MediaOverlayLocation } from '@/types/book';
import type { DBBookConfig } from '@/types/records';
import { parseMediaOverlayLocation } from '@/services/audiobook/mediaOverlayLocation';

const parseStoredMediaOverlayLocation = (value: unknown): MediaOverlayLocation | undefined => {
  if (typeof value !== 'string') return parseMediaOverlayLocation(value);
  try {
    return parseMediaOverlayLocation(JSON.parse(value));
  } catch {
    return undefined;
  }
};

export const selectNewestMediaOverlayLocation = (
  first: unknown,
  second: unknown,
  editionId: string | undefined,
): MediaOverlayLocation | undefined => {
  if (!editionId) return undefined;
  const firstLocation = parseStoredMediaOverlayLocation(first);
  const secondLocation = parseStoredMediaOverlayLocation(second);
  const validFirst = firstLocation?.editionId === editionId ? firstLocation : undefined;
  const validSecond = secondLocation?.editionId === editionId ? secondLocation : undefined;
  return validSecond && (!validFirst || validSecond.updatedAt > validFirst.updatedAt)
    ? validSecond
    : validFirst;
};

const recordTimestamp = (value: string | null | undefined): number => {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export interface DBBookConfigMergeResult {
  record: DBBookConfig;
  shouldUpdate: boolean;
}

/**
 * Applies last-writer-wins to a DB config while treating the nested audio
 * locator as its own independently timestamped register.
 */
export const mergeDBBookConfig = (
  incoming: DBBookConfig,
  server: DBBookConfig,
  now = Date.now(),
): DBBookConfigMergeResult => {
  const editionId = incoming.book_hash || server.book_hash;
  const incomingLocation = parseStoredMediaOverlayLocation(incoming.media_overlay_location);
  const serverLocation = parseStoredMediaOverlayLocation(server.media_overlay_location);
  const validIncoming = incomingLocation?.editionId === editionId ? incomingLocation : undefined;
  const validServer = serverLocation?.editionId === editionId ? serverLocation : undefined;
  const newestLocation = selectNewestMediaOverlayLocation(validIncoming, validServer, editionId);
  const incomingIsNewer =
    recordTimestamp(incoming.deleted_at) > recordTimestamp(server.deleted_at) ||
    recordTimestamp(incoming.updated_at) > recordTimestamp(server.updated_at);
  const incomingLocationIsNewer = Boolean(
    validIncoming && (!validServer || validIncoming.updatedAt > validServer.updatedAt),
  );

  if (!incomingIsNewer && !incomingLocationIsNewer) {
    return { record: server, shouldUpdate: false };
  }

  const record: DBBookConfig = incomingIsNewer ? { ...incoming } : { ...server };
  if (newestLocation) {
    record.media_overlay_location = JSON.stringify(newestLocation);
  } else {
    delete record.media_overlay_location;
  }
  if (!incomingIsNewer && incomingLocationIsNewer) {
    record.updated_at = new Date(
      Math.max(now, recordTimestamp(server.updated_at) + 1, validIncoming!.updatedAt),
    ).toISOString();
  }
  return { record, shouldUpdate: true };
};

/**
 * Merge a synced remote config into the local one, exactly as progress sync
 * has always done it: latest `updatedAt` wins whole-config, but null and
 * undefined remote values never clobber local fields — a peer that predates
 * a field (e.g. the audiobook listening position) must not erase it.
 */
export const mergeSyncedConfig = (
  local: BookConfig,
  remote: BookConfig,
  editionId?: string,
): BookConfig => {
  const definedRemote = Object.fromEntries(
    Object.entries(remote).filter(([, value]) => value !== null && value !== undefined),
  );
  const merged =
    remote.updatedAt >= local.updatedAt
      ? ({ ...local, ...definedRemote } as BookConfig)
      : ({ ...definedRemote, ...local } as BookConfig);
  const expectedEdition = editionId ?? local.bookHash ?? remote.bookHash;
  if (editionId) merged.bookHash = editionId;
  merged.mediaOverlayLocation = selectNewestMediaOverlayLocation(
    local.mediaOverlayLocation,
    remote.mediaOverlayLocation,
    expectedEdition,
  );
  return merged;
};
