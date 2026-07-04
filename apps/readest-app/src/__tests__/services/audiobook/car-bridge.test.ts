import { describe, expect, it } from 'vitest';
import { buildBridgeChapters, buildBridgeLibrary } from '@/services/audiobook/carBridge';
import type { Book } from '@/types/book';

const book = (over: Partial<Book>): Book =>
  ({
    hash: 'h',
    format: 'EPUB',
    title: 'T',
    author: 'A',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as Book;

describe('buildBridgeLibrary', () => {
  it('exposes only audiobooks, most recently used first', () => {
    const books = [
      book({ hash: 'text', title: 'Text Book', updatedAt: 900 }),
      book({ hash: 'old', title: 'Old Audio', hasAudio: true, audioDuration: 60, updatedAt: 100 }),
      book({ hash: 'new', title: 'New Audio', hasAudio: true, audioDuration: 30, updatedAt: 500 }),
      book({ hash: 'gone', title: 'Deleted', hasAudio: true, deletedAt: 50, updatedAt: 999 }),
    ];
    const bridge = buildBridgeLibrary(books);
    expect(bridge.map((b) => b.id)).toEqual(['new', 'old']);
    expect(bridge[0]).toEqual({ id: 'new', title: 'New Audio', author: 'A', durationSec: 30 });
  });

  it('defaults unknown durations to zero', () => {
    const bridge = buildBridgeLibrary([book({ hash: 'x', hasAudio: true })]);
    expect(bridge[0]?.durationSec).toBe(0);
  });

  it('is empty for a library without audiobooks', () => {
    expect(buildBridgeLibrary([book({ hash: 'a' })])).toEqual([]);
  });
});

describe('buildBridgeChapters', () => {
  it('maps chapter labels with their spine indexes and flags the playing one', () => {
    const payload = buildBridgeChapters(
      'book1',
      [
        { label: 'Chapter 1', sectionIndex: 0 },
        { label: 'Chapter 2', sectionIndex: 1 },
      ],
      1,
    );
    expect(payload).toEqual({
      bookId: 'book1',
      currentIndex: 1,
      chapters: [
        { index: 0, label: 'Chapter 1' },
        { index: 1, label: 'Chapter 2' },
      ],
    });
  });

  it('omits currentIndex when nothing is playing', () => {
    const payload = buildBridgeChapters('book1', [], -1);
    expect(payload.currentIndex).toBeUndefined();
    expect(payload.chapters).toEqual([]);
  });
});
