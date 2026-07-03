/** One downloaded audiobook's on-device footprint. */
export interface LocalAudiobookUsage {
  hash: string;
  title: string;
  sizeBytes: number;
  /** Safe to delete locally (a cloud copy exists to restore from). */
  removable: boolean;
}

export interface AudioStorageSummary {
  totalBytes: number;
  /** Largest first — the order a user frees space in. */
  items: LocalAudiobookUsage[];
}

export const summarizeAudioStorage = (items: LocalAudiobookUsage[]): AudioStorageSummary => ({
  totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
  items: [...items].sort((a, b) => b.sizeBytes - a.sizeBytes),
});
