import type { Book } from '@/types/book';
import type { BookMetadata } from '@/libs/document';

export const isKindleFormat = (format: string) =>
  ['EPUB', 'PDF', 'TXT'].includes(format.toUpperCase());

export function getKindleAvailability(book?: Book): 'hidden' | 'download' | 'ready' {
  if (
    !book ||
    book.deletedAt ||
    book.isAudioOnly ||
    book.metadata?.appOnlyReading ||
    !isKindleFormat(book.format)
  )
    return 'hidden';
  return book.downloadedAt ? 'ready' : 'download';
}

// Delivery restrictions belong to the saved book, not editable bibliographic metadata.
// Older clients and reparsed files may omit this field, but must not remove it.
export function preserveDeliveryRestrictions(
  previous: BookMetadata | undefined,
  next: BookMetadata | undefined,
  sameContent = true,
): BookMetadata | undefined {
  if (!previous?.appOnlyReading && !(sameContent && previous?.delivery)) return next;
  const metadata = { ...(next ?? previous!) };
  if (!sameContent) delete metadata.delivery;
  return {
    ...metadata,
    ...(previous?.appOnlyReading ? { appOnlyReading: true } : {}),
    ...(sameContent && previous?.delivery ? { delivery: previous.delivery } : {}),
  };
}
