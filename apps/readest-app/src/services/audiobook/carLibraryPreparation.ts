import { DocumentLoader, type BookDoc, type TOCItem } from '@/libs/document';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import {
  isCarBridgeAvailable,
  prepareAndPushCarPlayback,
  pushChaptersToCar,
  type BridgeChapter,
} from './carBridge';

const preparedEditions = new Set<string>();
const preparationTasks = new Map<string, Promise<void>>();

export const buildCarChapters = (bookDoc: BookDoc): BridgeChapter[] => {
  const sections = bookDoc.sections ?? [];
  const labels = new Map<number, string>();
  const visit = (items: TOCItem[]) => {
    for (const item of items) {
      if (item.href) {
        const [sectionId] = bookDoc.splitTOCHref(item.href);
        const index = sections.findIndex(
          (section) => section.id === sectionId || section.href === sectionId,
        );
        if (index >= 0 && sections[index]?.mediaOverlay && !labels.has(index)) {
          labels.set(index, item.label);
        }
      }
      if (item.subitems?.length) visit(item.subitems);
    }
  };
  visit(bookDoc.toc ?? []);
  for (let index = 0; index < sections.length; index++) {
    if (sections[index]?.mediaOverlay && !labels.has(index))
      labels.set(index, `Chapter ${index + 1}`);
  }
  return [...labels.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, label]) => ({ index, label }));
};

const prepareOne = async (appService: AppService, book: Book): Promise<void> => {
  const { file } = await appService.loadBookContent(book);
  const { book: bookDoc } = await new DocumentLoader(file).open();
  const engine = bookDoc.getMediaOverlay?.();
  if (!engine) return;
  const chapters = buildCarChapters(bookDoc);
  await pushChaptersToCar({ bookId: book.hash, chapters });
  if (await prepareAndPushCarPlayback(appService, book, engine, chapters)) {
    preparedEditions.add(book.hash);
  }
};

/** Sequentially prepares every locally downloaded audiobook for cold car playback. */
export const prepareCarAudiobookLibrary = async (
  appService: AppService,
  books: Book[],
): Promise<void> => {
  if (!isCarBridgeAvailable()) return;
  for (const book of books) {
    if (!book.hasAudio || book.deletedAt || !book.downloadedAt || preparedEditions.has(book.hash)) {
      continue;
    }
    let task = preparationTasks.get(book.hash);
    if (!task) {
      task = prepareOne(appService, book)
        .catch((error) =>
          console.warn('car audiobook background preparation failed', book.hash, error),
        )
        .finally(() => preparationTasks.delete(book.hash));
      preparationTasks.set(book.hash, task);
    }
    await task;
  }
};
