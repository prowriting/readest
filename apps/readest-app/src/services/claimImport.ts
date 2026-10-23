import type { Book } from '@/types/book';
import { ingestFile, type IngestFileDeps } from '@/services/ingestService';
import { confirmGiftRedemption, type BookCodeResult } from '@/services/bookCode';

export async function importClaimedBook(
  result: BookCodeResult,
  file: File,
  library: Book[],
  setLibrary: (books: Book[]) => void,
  deps: IngestFileDeps,
): Promise<Book | null> {
  const book = await ingestFile({ file, books: library, forceUpload: true }, deps);
  if (!book) return null;
  if (result.book.requestAnalytics) book.analyticsStatus = 'ask';
  setLibrary(library);
  await deps.appService.saveLibraryBooks(library);
  void confirmGiftRedemption(result.downloadRef);
  return book;
}
