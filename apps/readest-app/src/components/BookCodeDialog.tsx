import Image from 'next/image';
import { useEffect, useState } from 'react';
import { MdMenuBook, MdAccessTime, MdArticle } from 'react-icons/md';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { BookCodeResult } from '@/services/bookCode';
import Dialog from './Dialog';

const KINDLE_WEB_URL = 'https://www.amazon.com/sendtokindle';
const PLAY_BOOKS_WEB_URL = 'https://play.google.com/books/uploads';

export const BookCodeDialog = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [isOpen, setIsOpen] = useState(false);
  const [book, setBook] = useState<BookCodeResult | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const handler = (event: CustomEvent) => {
      const book = (event.detail as { book: BookCodeResult }).book;
      setBook(book);
      setIsOpen(true);
    };
    eventDispatcher.on('book-code-found', handler);
    return () => eventDispatcher.off('book-code-found', handler);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    setBook(null);
  };

  const handleStartReading = () => {
    // TODO: download from book.downloadUrl, ingest into library, open reader
    handleClose();
  };

  const handleSaveToLibrary = () => {
    // TODO: download from book.downloadUrl and add to cloud library
    handleClose();
  };

  /** Downloads the EPUB and shares it via the OS native share sheet. */
  const handleShareFile = async (fallbackWebUrl: string) => {
    if (!book) return;

    if (isWebAppPlatform() || !isTauriAppPlatform()) {
      window.open(fallbackWebUrl, '_blank', 'noopener');
      return;
    }

    if (!book.downloadUrl) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Download not available yet'),
        timeout: 2500,
      });
      return;
    }

    setIsBusy(true);
    try {
      const response = await fetch(book.downloadUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const filename = `${book.title}.epub`;
      await appService?.saveFile(filename, bytes, {
        share: true,
        mimeType: 'application/epub+zip',
      });
    } catch (err) {
      console.error('Share failed:', err);
      // Fall back to opening the web service
      void openUrl(fallbackWebUrl);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveToDownloads = async () => {
    if (!book?.downloadUrl) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Download not available yet'),
        timeout: 2500,
      });
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch(book.downloadUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      await appService?.saveFile(`${book.title}.epub`, bytes, {
        mimeType: 'application/epub+zip',
      });
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setIsBusy(false);
    }
  };

  if (!book) return null;

  const wordCount =
    book.words >= 1000
      ? `${Math.round(book.words / 1000)}k ${_('words')}`
      : `${book.words} ${_('words')}`;

  return (
    <Dialog
      id='book_code_dialog'
      isOpen={isOpen}
      title={_('We found your book!')}
      onClose={handleClose}
      boxClassName='sm:!w-[420px] sm:!max-w-screen-sm sm:h-auto'
    >
      {isOpen && (
        <div className='flex flex-col gap-6 pb-8'>
          {/* Book info */}
          <div className='flex gap-4'>
            <div className='bg-base-300 flex h-32 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-md'>
              {book.coverUrl ? (
                <Image
                  src={book.coverUrl}
                  alt={book.title}
                  width={96}
                  height={128}
                  className='h-full w-full object-cover'
                />
              ) : (
                <MdMenuBook className='text-base-content/30' size={40} />
              )}
            </div>
            <div className='flex flex-col justify-center gap-2'>
              <h3 className='text-base-content text-lg font-bold leading-snug'>{book.title}</h3>
              <p className='text-base-content/70 text-sm italic'>{book.author}</p>
              <div className='mt-1 flex flex-col gap-1'>
                <div className='text-base-content/60 flex items-center gap-1.5 text-xs'>
                  <MdMenuBook size={14} />
                  <span>{book.format}</span>
                </div>
                <div className='text-base-content/60 flex items-center gap-1.5 text-xs'>
                  <MdAccessTime size={14} />
                  <span>
                    {book.readingTimeMin}–{book.readingTimeMax} {_('hours')}
                  </span>
                </div>
                <div className='text-base-content/60 flex items-center gap-1.5 text-xs'>
                  <MdArticle size={14} />
                  <span>
                    {book.pages} {_('pages')} ({wordCount})
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className='flex flex-col gap-3'>
            <button
              className='btn btn-primary btn-lg w-full font-bold tracking-wide'
              onClick={handleStartReading}
              disabled={isBusy}
            >
              {_('Start Reading')}
            </button>

            <button
              className='btn btn-outline w-full'
              onClick={handleSaveToLibrary}
              disabled={isBusy}
            >
              {_('Save to My Library')}
            </button>

            {!isWebAppPlatform() && (
              <>
                <button
                  className='btn btn-ghost w-full'
                  onClick={() => handleShareFile(KINDLE_WEB_URL)}
                  disabled={isBusy}
                >
                  {_('Send to Kindle')}
                </button>

                <button
                  className='btn btn-ghost w-full'
                  onClick={() => handleShareFile(PLAY_BOOKS_WEB_URL)}
                  disabled={isBusy}
                >
                  {_('Upload to Play Books')}
                </button>
              </>
            )}

            <button
              className='btn btn-ghost w-full'
              onClick={handleSaveToDownloads}
              disabled={isBusy}
            >
              {_('Save to Downloads')}
            </button>

            <button
              className='btn btn-ghost text-base-content/50 w-full text-sm'
              onClick={handleClose}
              disabled={isBusy}
            >
              {_('Close')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
