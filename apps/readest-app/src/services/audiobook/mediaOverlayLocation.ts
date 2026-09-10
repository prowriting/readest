import type { MediaOverlayLocation, ReadiumLocator } from '@/types/book';
import type {
  MediaOverlayPlaybackManifest,
  MediaOverlayPlaybackSegment,
} from '@/types/mediaOverlay';

const TIME_FRAGMENT = /^t=(?:npt:)?(\d+(?:\.\d+)?)$/;

const isFiniteProgression = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isLocator = (value: unknown): value is ReadiumLocator => {
  if (!value || typeof value !== 'object') return false;
  const locator = value as Partial<ReadiumLocator>;
  if (typeof locator.href !== 'string' || !locator.href.trim()) return false;
  if (typeof locator.type !== 'string' || !locator.type.trim()) return false;
  const locations = locator.locations;
  if (!locations || !Array.isArray(locations.fragments) || !locations.fragments.length)
    return false;
  if (
    !locations.fragments.every((fragment) => typeof fragment === 'string' && fragment.length > 0)
  ) {
    return false;
  }
  if (locations.progression !== undefined && !isFiniteProgression(locations.progression))
    return false;
  return !(
    locations.totalProgression !== undefined && !isFiniteProgression(locations.totalProgression)
  );
};

export const parseMediaFragmentTime = (fragment: string): number | null => {
  const match = TIME_FRAGMENT.exec(fragment);
  if (!match) return null;
  const time = Number(match[1]);
  return Number.isFinite(time) ? time : null;
};

/** Rejects legacy chapter-relative markers as well as malformed v2 locators. */
export const parseMediaOverlayLocation = (value: unknown): MediaOverlayLocation | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const location = value as Partial<MediaOverlayLocation>;
  if (
    location.schemaVersion !== 2 ||
    typeof location.editionId !== 'string' ||
    !location.editionId.trim()
  ) {
    return undefined;
  }
  if (!isLocator(location.locator) || !Number.isFinite(location.updatedAt)) return undefined;
  if (
    !location.locator.locations.fragments.some(
      (fragment) => parseMediaFragmentTime(fragment) !== null,
    )
  ) {
    return undefined;
  }
  if (location.textLocator !== undefined && !isLocator(location.textLocator)) return undefined;
  return location as MediaOverlayLocation;
};

const clampProgression = (value: number): number => Math.max(0, Math.min(1, value));

const formatSeconds = (seconds: number): string =>
  String(Math.round(Math.max(0, seconds) * 1000) / 1000);

const splitTextTarget = (target: string): { href: string; fragment: string } | null => {
  const hashIndex = target.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === target.length - 1) return null;
  return { href: target.slice(0, hashIndex), fragment: target.slice(hashIndex + 1) };
};

const segmentSpan = (segment: MediaOverlayPlaybackSegment): number =>
  Math.max(0, segment.clipEnd - segment.clipBegin);

const effectiveSourceDuration = (
  manifest: MediaOverlayPlaybackManifest,
  segment: MediaOverlayPlaybackSegment,
): number => {
  const declared = segment.sourceDuration;
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Math.max(
    segment.clipEnd,
    ...manifest.sections.flatMap((section) =>
      section.segments
        .filter((candidate) => candidate.source === segment.source)
        .map((candidate) => candidate.clipEnd),
    ),
  );
};

export interface CreateMediaOverlayLocationOptions {
  editionId: string;
  manifest: MediaOverlayPlaybackManifest;
  sectionIndex: number;
  sectionOffset: number;
  title?: string;
  updatedAt?: number;
}

export const createMediaOverlayLocation = ({
  editionId,
  manifest,
  sectionIndex,
  sectionOffset,
  title,
  updatedAt = Date.now(),
}: CreateMediaOverlayLocationOptions): MediaOverlayLocation | undefined => {
  const section = manifest.sections.find((candidate) => candidate.sectionIndex === sectionIndex);
  if (!section?.segments.length) return undefined;

  const clampedOffset = Math.max(0, Math.min(sectionOffset, section.duration));
  let elapsed = 0;
  let segmentIndex = section.segments.length - 1;
  for (let index = 0; index < section.segments.length; index++) {
    const span = segmentSpan(section.segments[index]!);
    if (clampedOffset < elapsed + span || index === section.segments.length - 1) {
      segmentIndex = index;
      break;
    }
    elapsed += span;
  }
  const segment = section.segments[segmentIndex]!;
  const segmentOffset = Math.min(segmentSpan(segment), Math.max(0, clampedOffset - elapsed));
  const sourceTime = segment.clipBegin + segmentOffset;
  const sourceDuration = effectiveSourceDuration(manifest, segment);
  const sectionPosition = manifest.sections.findIndex(
    (candidate) => candidate.sectionIndex === sectionIndex,
  );
  const beforeSection = manifest.sections
    .slice(0, sectionPosition)
    .reduce((sum, candidate) => sum + candidate.duration, 0);
  const totalDuration = manifest.sections.reduce((sum, candidate) => sum + candidate.duration, 0);
  const locations: ReadiumLocator['locations'] = {
    fragments: [`t=${formatSeconds(sourceTime)}`],
    progression: sourceDuration > 0 ? clampProgression(sourceTime / sourceDuration) : 0,
    ...(totalDuration > 0
      ? { totalProgression: clampProgression((beforeSection + clampedOffset) / totalDuration) }
      : {}),
  };

  const cue = segment.cues.reduce<(typeof segment.cues)[number] | undefined>(
    (active, candidate) => (candidate.offset <= segmentOffset ? candidate : active),
    undefined,
  );
  const textTarget = cue && splitTextTarget(cue.text);
  return {
    schemaVersion: 2,
    editionId,
    locator: {
      href: segment.source,
      type: segment.type,
      ...(title ? { title } : {}),
      locations,
    },
    ...(textTarget
      ? {
          textLocator: {
            href: textTarget.href,
            type: 'application/xhtml+xml',
            ...(title ? { title } : {}),
            locations: { fragments: [textTarget.fragment] },
          },
        }
      : {}),
    updatedAt,
  };
};

export interface ResolvedMediaOverlayLocation {
  sectionIndex: number;
  sectionOffset: number;
  segmentIndex: number;
  segmentOffset: number;
  sourceTime: number;
}

export const resolveMediaOverlayLocation = (
  manifest: MediaOverlayPlaybackManifest,
  value: unknown,
  editionId: string,
): ResolvedMediaOverlayLocation | null => {
  const location = parseMediaOverlayLocation(value);
  if (!location || location.editionId !== editionId) return null;
  const sourceTime = location.locator.locations.fragments
    .map(parseMediaFragmentTime)
    .find((time): time is number => time !== null);
  if (sourceTime === undefined) return null;
  const textTarget = location.textLocator
    ? `${location.textLocator.href}#${location.textLocator.locations.fragments[0] ?? ''}`
    : null;

  const matches = manifest.sections.flatMap((section) =>
    section.segments.flatMap((segment, segmentIndex) => {
      if (
        segment.source !== location.locator.href ||
        sourceTime < segment.clipBegin ||
        sourceTime > segment.clipEnd
      ) {
        return [];
      }
      const before = section.segments
        .slice(0, segmentIndex)
        .reduce((sum, candidate) => sum + segmentSpan(candidate), 0);
      const segmentOffset = Math.max(0, sourceTime - segment.clipBegin);
      return [
        {
          sectionIndex: section.sectionIndex,
          sectionOffset: before + segmentOffset,
          segmentIndex,
          segmentOffset,
          sourceTime,
          textMatch: Boolean(textTarget && segment.cues.some((cue) => cue.text === textTarget)),
          exactStart: sourceTime === segment.clipBegin,
        },
      ];
    }),
  );
  const match =
    matches.find((candidate) => candidate.textMatch) ??
    matches.find((candidate) => candidate.exactStart) ??
    matches[0];
  if (!match) return null;
  const { textMatch: _textMatch, exactStart: _exactStart, ...resolved } = match;
  return resolved;
};
