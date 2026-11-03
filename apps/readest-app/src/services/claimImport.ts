import type { Book } from '@/types/book';
import { ingestFile, type IngestFileDeps } from '@/services/ingestService';
import { confirmGiftRedemption, type BookCodeResult } from '@/services/bookCode';
import { transferManager } from '@/services/transferManager';

export async function importClaimedBook(
  result: BookCodeResult,
  file: File,
  library: Book[],
  setLibrary: (books: Book[]) => void,
  deps: IngestFileDeps,
): Promise<Book | null> {
  // Stage import/dedup changes so failed persistence cannot look like a saved
  // book on retry. Upload only after delivery restrictions are durably stored.
  const pendingLibrary = library.map((book) => ({
    ...book,
    metadata: book.metadata && { ...book.metadata },
  }));
  const book = await ingestFile({ file, books: pendingLibrary }, { ...deps, isLoggedIn: false });
  if (!book) return null;
  if (result.book.appOnlyReading) {
    book.metadata = {
      title: book.title,
      author: book.author,
      language: book.primaryLanguage || '',
      ...book.metadata,
      appOnlyReading: true,
    };
  }
  if (result.book.requestAnalytics) book.analyticsStatus = 'ask';
  await deps.appService.saveLibraryBooks(pendingLibrary);
  setLibrary(pendingLibrary);
  void confirmGiftRedemption(result.downloadRef);
  if (deps.isLoggedIn && !book.uploadedAt) transferManager.queueUpload(book);
  return book;
}
