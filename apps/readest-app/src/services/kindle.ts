import { shareFile } from '@choochmeque/tauri-plugin-sharekit-api';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { getKindleAvailability } from '@/utils/bookDelivery';
import type { ClosableFile } from '@/utils/file';

export const KINDLE_WEB_URL = 'https://www.amazon.com/sendtokindle';
const MIME_TYPES: Record<string, string> = {
  EPUB: 'application/epub+zip',
  PDF: 'application/pdf',
  TXT: 'text/plain',
};

export function kindleFile(content: BlobPart, title: string, format: string): File {
  const extension = format.toLowerCase();
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Book';
  return new File([content], `${safeTitle}.${extension}`, {
    type: MIME_TYPES[format.toUpperCase()],
  });
}

export async function loadKindleFile(
  appService: Pick<AppService, 'loadBookContent'>,
  book: Book,
): Promise<File> {
  if (getKindleAvailability(book) !== 'ready') throw new Error('Book is not available for Kindle');
  // Load by the stored hash; no claim reference or remote redemption is needed.
  // NativeFile reads lazily and has an empty underlying Blob. Materialize its
  // bytes before renaming; new File([file]) would otherwise produce an empty file.
  const { file } = await appService.loadBookContent(book);
  try {
    return kindleFile(await file.arrayBuffer(), book.title, book.format);
  } finally {
    await (file as Partial<ClosableFile>).close?.();
  }
}

export async function shareKindleFile(
  appService: Pick<AppService, 'createDir' | 'writeFile' | 'resolveFilePath'>,
  file: File,
): Promise<void> {
  const id = crypto.randomUUID();
  const folder = `kindle-${id}`;
  await appService.createDir(folder, 'Temp');
  // Sharekit copies into a flat native cache. A unique basename prevents an
  // earlier file with the same title from being shared instead on iOS.
  const dot = file.name.lastIndexOf('.');
  const name = `${file.name.slice(0, dot)}-${id}${file.name.slice(dot)}`;
  const path = `${folder}/${name}`;
  await appService.writeFile(path, 'Temp', file);
  const absolutePath = await appService.resolveFilePath(path, 'Temp');
  // Keep the temporary copy available: Android recipients may read it after
  // the sheet closes. The OS owns temp cleanup; the library copy is untouched.
  const url = new URL('file:///');
  url.pathname = absolutePath;
  await shareFile(url.href, { mimeType: file.type, title: file.name });
}
