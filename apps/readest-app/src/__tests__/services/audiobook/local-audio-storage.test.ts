import { describe, expect, it } from 'vitest';
import {
  summarizeAudioStorage,
  type LocalAudiobookUsage,
} from '@/services/audiobook/localAudioStorage';

describe('summarizeAudioStorage', () => {
  const entry = (hash: string, title: string, sizeBytes: number): LocalAudiobookUsage => ({
    hash,
    title,
    sizeBytes,
    removable: false,
  });

  it('totals sizes and sorts largest first', () => {
    const summary = summarizeAudioStorage([
      entry('a', 'Small', 10_000),
      entry('b', 'Big', 5_000_000),
      entry('c', 'Mid', 250_000),
    ]);
    expect(summary.totalBytes).toBe(5_260_000);
    expect(summary.items.map((i) => i.title)).toEqual(['Big', 'Mid', 'Small']);
  });

  it('handles an empty device gracefully', () => {
    const summary = summarizeAudioStorage([]);
    expect(summary.totalBytes).toBe(0);
    expect(summary.items).toEqual([]);
  });
});
