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
