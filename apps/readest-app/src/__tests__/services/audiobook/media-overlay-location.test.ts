import { describe, expect, it } from 'vitest';
import {
  createMediaOverlayLocation,
  parseMediaOverlayLocation,
  resolveMediaOverlayLocation,
} from '@/services/audiobook/mediaOverlayLocation';
import type { MediaOverlayPlaybackManifest } from '@/types/mediaOverlay';

const manifest: MediaOverlayPlaybackManifest = {
  sections: [
    {
      sectionIndex: 2,
      duration: 15,
      segments: [
        {
          source: 'OEBPS/audio/shared.mp3',
          type: 'audio/mpeg',
          clipBegin: 10,
          clipEnd: 20,
          sourceDuration: 100,
          cues: [
            { offset: 0, text: 'OEBPS/text/c2.xhtml#p1' },
            { offset: 5, text: 'OEBPS/text/c2.xhtml#p2' },
          ],
        },
        {
          source: 'OEBPS/audio/tail.m4a',
          type: 'audio/mp4',
          clipBegin: 30,
          clipEnd: 35,
          sourceDuration: 50,
          cues: [{ offset: 0, text: 'OEBPS/text/c2.xhtml#p3' }],
        },
      ],
    },
    {
      sectionIndex: 3,
      duration: 5,
      segments: [
        {
          source: 'OEBPS/audio/shared.mp3',
          type: 'audio/mpeg',
          clipBegin: 50,
          clipEnd: 55,
          sourceDuration: 100,
          cues: [{ offset: 0, text: 'OEBPS/text/c3.xhtml#p1' }],
        },
      ],
    },
  ],
};

describe('Readium media overlay locations', () => {
  it('uses the underlying resource clock and records paired text and total progress', () => {
    const location = createMediaOverlayLocation({
      editionId: 'edition-1',
      manifest,
      sectionIndex: 2,
      sectionOffset: 6,
      title: 'Chapter 2',
      updatedAt: 123,
    });

    expect(location).toEqual({
      schemaVersion: 2,
      editionId: 'edition-1',
      locator: {
        href: 'OEBPS/audio/shared.mp3',
        type: 'audio/mpeg',
        title: 'Chapter 2',
        locations: {
          fragments: ['t=16'],
          progression: 0.16,
          totalProgression: 0.3,
        },
      },
      textLocator: {
        href: 'OEBPS/text/c2.xhtml',
        type: 'application/xhtml+xml',
        title: 'Chapter 2',
        locations: { fragments: ['p2'] },
      },
      updatedAt: 123,
    });
  });

  it('resolves repeated audio resources with the timestamp and paired text target', () => {
    const location = createMediaOverlayLocation({
      editionId: 'edition-1',
      manifest,
      sectionIndex: 3,
      sectionOffset: 2,
      title: 'Chapter 3',
      updatedAt: 456,
    });

    expect(resolveMediaOverlayLocation(manifest, location, 'edition-1')).toEqual({
      sectionIndex: 3,
      sectionOffset: 2,
      segmentIndex: 0,
      segmentOffset: 2,
      sourceTime: 52,
    });
    expect(resolveMediaOverlayLocation(manifest, location, 'other-edition')).toBeNull();
  });

  it('crosses audio-file and chapter boundaries without storing a chapter offset', () => {
    const secondFile = createMediaOverlayLocation({
      editionId: 'edition-1',
      manifest,
      sectionIndex: 2,
      sectionOffset: 12,
      updatedAt: 500,
    });
    expect(secondFile?.locator.href).toBe('OEBPS/audio/tail.m4a');
    expect(secondFile?.locator.locations.fragments).toEqual(['t=32']);
    expect(resolveMediaOverlayLocation(manifest, secondFile, 'edition-1')?.sectionOffset).toBe(12);

    const nextChapter = createMediaOverlayLocation({
      editionId: 'edition-1',
      manifest,
      sectionIndex: 3,
      sectionOffset: 0,
      updatedAt: 501,
    });
    expect(nextChapter?.locator.locations.fragments).toEqual(['t=50']);
    expect(nextChapter?.locator.locations.totalProgression).toBe(0.75);
  });

  it('is independent of playback speed because it stores the resource clock', () => {
    const atNormalSpeed = createMediaOverlayLocation({
      editionId: 'edition-1',
      manifest,
      sectionIndex: 2,
      sectionOffset: 4,
      updatedAt: 600,
    });
    const afterRateChange = createMediaOverlayLocation({
      editionId: 'edition-1',
      manifest,
      sectionIndex: 2,
      sectionOffset: 4,
      updatedAt: 601,
    });

    expect(afterRateChange?.locator.locations.fragments).toEqual(
      atNormalSpeed?.locator.locations.fragments,
    );
  });

  it('resolves a shared clip boundary to the segment that starts at that timestamp', () => {
    const boundaryManifest: MediaOverlayPlaybackManifest = {
      sections: [
        {
          sectionIndex: 0,
          duration: 20,
          segments: [
            {
              source: 'audio/shared.mp3',
              type: 'audio/mpeg',
              clipBegin: 0,
              clipEnd: 10,
              sourceDuration: 20,
              cues: [],
            },
            {
              source: 'audio/shared.mp3',
              type: 'audio/mpeg',
              clipBegin: 10,
              clipEnd: 20,
              sourceDuration: 20,
              cues: [],
            },
          ],
        },
      ],
    };
    const location = {
      schemaVersion: 2,
      editionId: 'edition-1',
      locator: {
        href: 'audio/shared.mp3',
        type: 'audio/mpeg',
        locations: { fragments: ['t=10'] },
      },
      updatedAt: 700,
    } as const;

    expect(resolveMediaOverlayLocation(boundaryManifest, location, 'edition-1')).toMatchObject({
      segmentIndex: 1,
      segmentOffset: 0,
      sectionOffset: 10,
    });
  });

  it('rejects legacy chapter offsets and malformed or wrong-edition locators', () => {
    expect(parseMediaOverlayLocation({ sectionIndex: 2, offset: 7, updatedAt: 1 })).toBeUndefined();
    expect(
      parseMediaOverlayLocation({
        schemaVersion: 2,
        editionId: 'edition-1',
        locator: {
          href: 'audio.mp3',
          type: 'audio/mpeg',
          locations: { fragments: ['not-a-time'], progression: 0.5 },
        },
        updatedAt: 1,
      }),
    ).toBeUndefined();
    expect(
      parseMediaOverlayLocation({
        schemaVersion: 2,
        editionId: '',
        locator: {
          href: 'audio.mp3',
          type: 'audio/mpeg',
          locations: { fragments: ['t=1'] },
        },
        updatedAt: 1,
      }),
    ).toBeUndefined();
    expect(
      parseMediaOverlayLocation({
        schemaVersion: 2,
        editionId: 'edition-1',
        locator: {
          href: 'audio.mp3',
          type: 'audio/mpeg',
          locations: { fragments: ['t=1'] },
        },
        updatedAt: Number.NaN,
      }),
    ).toBeUndefined();
    expect(() =>
      parseMediaOverlayLocation({
        schemaVersion: 2,
        editionId: 42,
        locator: {
          href: 'audio.mp3',
          type: 'audio/mpeg',
          locations: { fragments: ['t=1'] },
        },
        updatedAt: 1,
      }),
    ).not.toThrow();
    expect(
      parseMediaOverlayLocation({
        schemaVersion: 2,
        editionId: 'edition-1',
        locator: {
          href: '   ',
          type: 'audio/mpeg',
          locations: { fragments: ['t=1'] },
        },
        updatedAt: 1,
      }),
    ).toBeUndefined();
  });
});
