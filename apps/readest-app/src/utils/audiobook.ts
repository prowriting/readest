/**
 * Structural view of a parsed book document sufficient to detect EPUB3 Media
 * Overlays: any spine section carrying a SMIL manifest item.
 */
interface SectionsWithOverlays {
  sections?: Array<{ mediaOverlay?: unknown } | undefined>;
}

export const hasMediaOverlay = (bookDoc: SectionsWithOverlays): boolean =>
  bookDoc.sections?.some((section) => Boolean(section?.mediaOverlay)) ?? false;

/**
 * Resolve a tap inside a book section to a SMIL text-target candidate: the
 * nearest ancestor-or-self element carrying an id. Structural ids on
 * body/html never address clips, so they are skipped.
 */
export const findTapFragment = (target: EventTarget | null): string | null => {
  // Taps arrive from section documents that live in other iframes, so the
  // target's prototype chain belongs to another JS realm — `instanceof
  // Element` is always false there. Duck-type via nodeType instead.
  const node = target as (Node & Partial<Element>) | null;
  if (!node || typeof node.nodeType !== 'number') return null;
  let el: Element | null = node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null);
  while (el && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
    if (el.id) return el.id;
    el = el.parentElement;
  }
  return null;
};

/**
 * Innermost element-id assertion of a CFI (e.g. `/2[s3]` → `s3`), or null.
 * Media-overlay text targets always carry ids, and foliate's getCFI embeds
 * them as assertions — so a bookmark's audio position is recoverable from
 * its ordinary CFI with no extra persisted fields. Text/side-bias assertions
 * (attached to character offsets, or containing `;` parameters) are ignored.
 */
export const fragmentFromCfi = (cfi: string): string | null => {
  const matches = [...cfi.matchAll(/\/\d+\[([^\];]+)\]/g)];
  return matches.length ? (matches[matches.length - 1]?.[1] ?? null) : null;
};

interface DetectableSection {
  mediaOverlay?: unknown;
  linear?: string;
  createDocument?: () => Promise<Document>;
}

/** Overlay coverage below this share of the linear spine is a text book. */
const AUDIO_ONLY_MIN_COVERAGE = 0.8;
/** Average body text above this many characters per chapter means real prose. */
const AUDIO_ONLY_MAX_CHARS = 200;
const AUDIO_ONLY_SAMPLE_SECTIONS = 3;

/**
 * Whether a media-overlay book is an audio-only audiobook: overlays cover
 * (nearly) the whole linear spine and the sampled chapters carry only
 * incidental text (titles, track listings) rather than readable prose.
 */
export const detectAudioOnly = async (bookDoc: {
  sections?: Array<DetectableSection | undefined>;
}): Promise<boolean> => {
  const sections = (bookDoc.sections ?? []).filter((s): s is DetectableSection => Boolean(s));
  const linear = sections.filter((s) => s.linear !== 'no');
  if (linear.length === 0) return false;
  const withOverlay = linear.filter((s) => Boolean(s.mediaOverlay));
  if (withOverlay.length / linear.length < AUDIO_ONLY_MIN_COVERAGE) return false;

  const sample = withOverlay.slice(0, AUDIO_ONLY_SAMPLE_SECTIONS);
  let totalChars = 0;
  for (const section of sample) {
    if (!section.createDocument) return false;
    try {
      const doc = await section.createDocument();
      totalChars += (doc.body?.textContent ?? '').trim().length;
    } catch {
      return false;
    }
  }
  return totalChars / sample.length < AUDIO_ONLY_MAX_CHARS;
};
