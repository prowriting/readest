import { describe, expect, it, vi } from 'vitest';
import { prepareCarPlaybackManifest } from '@/services/audiobook/carPlaybackManifest';
import type { MediaOverlayEngine } from '@/types/mediaOverlay';
import type { Book } from '@/types/book';

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
                clipBegin: 1.25,
                clipEnd: 5.5,
                cues: [{ offset: 0.5, text: 'OEBPS/text/c1.xhtml#p1' }],
              },
              {
                source: 'OEBPS/audio/chapter 1.mp3',
                clipBegin: 7,
                clipEnd: 14.25,
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
    const book = {
      hash: 'book-hash',
      format: 'EPUB',
      title: 'Book',
      author: 'Author',
      createdAt: 1,
      updatedAt: 2,
    } as Book;

    const manifest = await prepareCarPlaybackManifest(
      store,
      book,
      engine,
      [{ index: 4, label: 'Chapter One' }],
      4,
    );

    expect(engine.loadAudioSource).toHaveBeenCalledTimes(1);
    expect(written).toEqual(['CarAudio/book-hash/audio-0000.mp3']);
    expect(manifest).toEqual({
      bookId: 'book-hash',
      title: 'Book',
      author: 'Author',
      currentSectionIndex: 4,
      sections: [
        {
          sectionIndex: 4,
          label: 'Chapter One',
          durationMs: 12_000,
          segments: [
            {
              path: '/native/CarAudio/book-hash/audio-0000.mp3',
              clipBeginMs: 1_250,
              clipEndMs: 5_500,
              cues: [{ offsetMs: 500, text: 'OEBPS/text/c1.xhtml#p1' }],
            },
            {
              path: '/native/CarAudio/book-hash/audio-0000.mp3',
              clipBeginMs: 7_000,
              clipEndMs: 14_250,
              cues: [],
            },
          ],
        },
      ],
    });
  });
});
