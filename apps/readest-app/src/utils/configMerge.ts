import type { BookConfig } from '@/types/book';

/**
 * Merge a synced remote config into the local one, exactly as progress sync
 * has always done it: latest `updatedAt` wins whole-config, but null and
 * undefined remote values never clobber local fields — a peer that predates
 * a field (e.g. the audiobook listening position) must not erase it.
 */
export const mergeSyncedConfig = (local: BookConfig, remote: BookConfig): BookConfig => {
  const definedRemote = Object.fromEntries(
    Object.entries(remote).filter(([, value]) => value !== null && value !== undefined),
  );
  return remote.updatedAt >= local.updatedAt
    ? ({ ...local, ...definedRemote } as BookConfig)
    : ({ ...definedRemote, ...local } as BookConfig);
};
