/**
 * Structural view of a parsed book document sufficient to detect EPUB3 Media
 * Overlays: any spine section carrying a SMIL manifest item.
 */
interface SectionsWithOverlays {
  sections?: Array<{ mediaOverlay?: unknown } | undefined>;
}

export const hasMediaOverlay = (bookDoc: SectionsWithOverlays): boolean =>
  bookDoc.sections?.some((section) => Boolean(section?.mediaOverlay)) ?? false;
