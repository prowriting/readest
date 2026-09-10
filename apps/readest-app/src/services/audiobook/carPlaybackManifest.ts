import type { Book } from '@/types/book';
import type { MediaOverlayEngine } from '@/types/mediaOverlay';

export interface CarPlaybackCue {
  offsetMs: number;
  text: string;
}

export interface CarPlaybackSegment {
  href: string;
  type: string;
  path: string;
  clipBeginMs: number;
  clipEndMs: number;
  sourceDurationMs: number;
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

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/vnd.wave': 'wav',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
};
const KNOWN_AUDIO_EXTENSIONS = new Set(['aac', 'm4a', 'mp3', 'mp4', 'oga', 'ogg', 'opus', 'wav']);

const sourceExtension = (source: string, type: string): string => {
  const match = source.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i);
  const extension = match?.[1]?.toLowerCase();
  return extension && KNOWN_AUDIO_EXTENSIONS.has(extension)
    ? extension
    : (MIME_EXTENSIONS[type.toLowerCase()] ?? 'audio');
};

const safeDirectoryName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_');

export async function prepareCarPlaybackManifest(
  store: CarPlaybackFileStore,
  book: Book,
  engine: MediaOverlayEngine,
  chapters: CarPlaybackChapter[],
  coverPath?: string,
): Promise<CarPlaybackManifest> {
  const parsed = await engine.exportPlaybackManifest();
  const directory = `CarAudio/${safeDirectoryName(book.hash)}`;
  await store.createDir(directory, 'Data', true);

  const sourcePaths = new Map<string, string>();
  const sources = new Map<string, string>();
  for (const section of parsed.sections) {
    for (const segment of section.segments) sources.set(segment.source, segment.type);
  }
  for (const [index, [source, type]] of [...sources.entries()].entries()) {
    const relativePath = `${directory}/audio-${index.toString().padStart(4, '0')}.${sourceExtension(source, type)}`;
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
    sections: parsed.sections.map((section) => ({
      sectionIndex: section.sectionIndex,
      label: labels.get(section.sectionIndex) ?? `Chapter ${section.sectionIndex + 1}`,
      durationMs: milliseconds(section.duration),
      segments: section.segments.map((segment) => ({
        href: segment.source,
        type: segment.type,
        path: sourcePaths.get(segment.source)!,
        clipBeginMs: milliseconds(segment.clipBegin),
        clipEndMs: milliseconds(segment.clipEnd),
        sourceDurationMs: milliseconds(segment.sourceDuration),
        cues: segment.cues.map((cue) => ({
          offsetMs: milliseconds(cue.offset),
          text: cue.text,
        })),
      })),
    })),
  };
}
