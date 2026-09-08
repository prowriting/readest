import type { Book } from '@/types/book';
import type { MediaOverlayEngine } from '@/types/mediaOverlay';

export interface CarPlaybackCue {
  offsetMs: number;
  text: string;
}

export interface CarPlaybackSegment {
  path: string;
  clipBeginMs: number;
  clipEndMs: number;
  cues: CarPlaybackCue[];
}

export interface CarPlaybackSection {
  sectionIndex: number;
  label: string;
  durationMs: number;
  segments: CarPlaybackSegment[];
}

/** Shared playback contract consumed by Android Auto and Apple CarPlay. */
export interface CarPlaybackManifest {
  bookId: string;
  title: string;
  author: string;
  coverPath?: string;
  currentSectionIndex?: number;
  sections: CarPlaybackSection[];
}

export interface CarPlaybackChapter {
  index: number;
  label: string;
}

interface CarPlaybackFileStore {
  createDir(path: string, base: 'Data', recursive?: boolean): Promise<void>;
  exists(path: string, base: 'Data'): Promise<boolean>;
  writeFile(path: string, base: 'Data', content: ArrayBuffer | File): Promise<void>;
  resolveFilePath(path: string, base: 'Data'): Promise<string>;
}

const milliseconds = (seconds: number): number => Math.max(0, Math.round(seconds * 1000));

const sourceExtension = (source: string): string => {
  const match = source.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i);
  return match?.[1]?.toLowerCase() ?? 'audio';
};

const safeDirectoryName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_');

export async function prepareCarPlaybackManifest(
  store: CarPlaybackFileStore,
  book: Book,
  engine: MediaOverlayEngine,
  chapters: CarPlaybackChapter[],
  currentSectionIndex: number,
  coverPath?: string,
): Promise<CarPlaybackManifest> {
  const parsed = await engine.exportPlaybackManifest();
  const directory = `CarAudio/${safeDirectoryName(book.hash)}`;
  await store.createDir(directory, 'Data', true);

  const sourcePaths = new Map<string, string>();
  const sources = [
    ...new Set(
      parsed.sections.flatMap((section) => section.segments.map((segment) => segment.source)),
    ),
  ];
  for (const [index, source] of sources.entries()) {
    const relativePath = `${directory}/audio-${index.toString().padStart(4, '0')}.${sourceExtension(source)}`;
    if (!(await store.exists(relativePath, 'Data'))) {
      const audio = await engine.loadAudioSource(source);
      await store.writeFile(relativePath, 'Data', await audio.arrayBuffer());
    }
    sourcePaths.set(source, await store.resolveFilePath(relativePath, 'Data'));
  }

  const labels = new Map(chapters.map((chapter) => [chapter.index, chapter.label]));
  return {
    bookId: book.hash,
    title: book.title,
    author: book.author,
    ...(coverPath ? { coverPath } : {}),
    ...(currentSectionIndex >= 0 ? { currentSectionIndex } : {}),
    sections: parsed.sections.map((section) => ({
      sectionIndex: section.sectionIndex,
      label: labels.get(section.sectionIndex) ?? `Chapter ${section.sectionIndex + 1}`,
      durationMs: milliseconds(section.duration),
      segments: section.segments.map((segment) => ({
        path: sourcePaths.get(segment.source)!,
        clipBeginMs: milliseconds(segment.clipBegin),
        clipEndMs: milliseconds(segment.clipEnd),
        cues: segment.cues.map((cue) => ({
          offsetMs: milliseconds(cue.offset),
          text: cue.text,
        })),
      })),
    })),
  };
}
