import { describe, expect, it, vi } from 'vitest';
import { prepareCarPlaybackManifest } from '@/services/audiobook/carPlaybackManifest';
import type { MediaOverlayEngine } from '@/types/mediaOverlay';
import type { Book } from '@/types/book';

const book = {
  hash: 'book-hash',
  format: 'EPUB',
  title: 'Book',
  author: 'Author',
  createdAt: 1,
  updatedAt: 2,
} as Book;

describe('prepareCarPlaybackManifest', () => {
  it('materializes each parsed EPUB audio source once into a reusable native manifest', async () => {
    const engine = {
      exportPlaybackManifest: vi.fn().mockResolvedValue({
        sections: [
          {
            sectionIndex: 4,
            duration: 12,
            segments: [
              {
                source: 'OEBPS/audio/chapter 1.mp3',
                type: 'audio/mpeg',
                clipBegin: 1.25,
                clipEnd: 5.5,
                sourceDuration: 20,
                cues: [{ offset: 0.5, text: 'OEBPS/text/c1.xhtml#p1' }],
              },
              {
                source: 'OEBPS/audio/chapter 1.mp3',
                type: 'audio/mpeg',
                clipBegin: 7,
                clipEnd: 14.25,
                sourceDuration: 20,
                cues: [],
              },
            ],
          },
        ],
      }),
      loadAudioSource: vi.fn().mockResolvedValue(new Blob(['audio'], { type: 'audio/mpeg' })),
    } as unknown as MediaOverlayEngine;
    const written: string[] = [];
    const store = {
      createDir: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
      writeFile: vi.fn(async (path: string) => {
        written.push(path);
      }),
      resolveFilePath: vi.fn(async (path: string) => `/native/${path}`),
    };
    const manifest = await prepareCarPlaybackManifest(store, book, engine, [
      { index: 4, label: 'Chapter One' },
    ]);

    expect(engine.loadAudioSource).toHaveBeenCalledTimes(1);
    expect(written).toEqual(['CarAudio/book-hash/audio-0000.mp3']);
    expect(manifest).toEqual({
      bookId: 'book-hash',
      title: 'Book',
      author: 'Author',
      sections: [
        {
          sectionIndex: 4,
          label: 'Chapter One',
          durationMs: 12_000,
          segments: [
            {
              href: 'OEBPS/audio/chapter 1.mp3',
              type: 'audio/mpeg',
              path: '/native/CarAudio/book-hash/audio-0000.mp3',
              clipBeginMs: 1_250,
              clipEndMs: 5_500,
              sourceDurationMs: 20_000,
              cues: [{ offsetMs: 500, text: 'OEBPS/text/c1.xhtml#p1' }],
            },
            {
              href: 'OEBPS/audio/chapter 1.mp3',
              type: 'audio/mpeg',
              path: '/native/CarAudio/book-hash/audio-0000.mp3',
              clipBeginMs: 7_000,
              clipEndMs: 14_250,
              sourceDurationMs: 20_000,
              cues: [],
            },
          ],
        },
      ],
    });
  });

  it('gives extensionless audio a native-playable extension from its MIME type', async () => {
    const engine = {
      exportPlaybackManifest: vi.fn().mockResolvedValue({
        sections: [
          {
            sectionIndex: 0,
            duration: 2,
            segments: [
              {
                source: 'OEBPS/audio/chapter-one',
                type: 'audio/mpeg',
                clipBegin: 0,
                clipEnd: 2,
                sourceDuration: 2,
                cues: [],
              },
            ],
          },
        ],
      }),
      loadAudioSource: vi.fn().mockResolvedValue(new Blob(['audio'], { type: 'audio/mpeg' })),
    } as unknown as MediaOverlayEngine;
    const store = {
      createDir: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
      writeFile: vi.fn().mockResolvedValue(undefined),
      resolveFilePath: vi.fn(async (path: string) => `/native/${path}`),
    };

    const manifest = await prepareCarPlaybackManifest(
      store,
      { ...book, hash: 'extensionless' },
      engine,
      [{ index: 0, label: 'Chapter One' }],
    );

    expect(store.writeFile).toHaveBeenCalledWith(
      'CarAudio/extensionless/audio-0000.mp3',
      'Data',
      expect.any(ArrayBuffer),
    );
    expect(manifest.sections[0]!.segments[0]!.path).toMatch(/\.mp3$/);
  });
});
