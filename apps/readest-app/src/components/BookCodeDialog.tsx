import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdMenuBook, MdCheckCircle, MdErrorOutline } from 'react-icons/md';
import { RiLoader2Line } from 'react-icons/ri';
import { tempDir } from '@tauri-apps/api/path';
import { writeFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isStoreCapture, isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { ingestFile } from '@/services/ingestService';
import {
  BookCodeResult,
  BookCodeError,
  downloadGiftBook,
  confirmGiftRedemption,
} from '@/services/bookCode';
import { detectKindle, sendToKindleApp, type DetectKindleResult } from '@/utils/bridge';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import Dialog from './Dialog';

const KINDLE_WEB_URL = 'https://www.amazon.com/sendtokindle';
const PLAY_BOOKS_WEB_URL = 'https://play.google.com/books/uploads';

type BusyAction = 'reading' | 'saving' | 'kindle' | 'playbooks' | 'downloads' | null;
type CodeError = { code: string; statusCode: number; message: string };

export const BookCodeDialog = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  // library: all books (including deleted) — used for ingestFile dedup
  // visibleLibrary: non-deleted books — used for "already owned" check
  const library = useLibraryStore((s) => s.library);
  const visibleLibrary = useLibraryStore((s) => s.visibleLibrary);
  const setLibrary = useLibraryStore((s) => s.setLibrary);

  const [isOpen, setIsOpen] = useState(false);
  const [result, setResult] = useState<BookCodeResult | null>(null);
  const [codeError, setCodeError] = useState<CodeError | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const kindleRef = useRef<DetectKindleResult | null>(null);

  useEffect(() => {
    if (isTauriAppPlatform() && appService?.isAndroidApp) {
      detectKindle()
        .then((r) => {
          kindleRef.current = r;
        })
        .catch(() => {});
    }
  }, [appService?.isAndroidApp]);

  useEffect(() => {
    const handler = (event: CustomEvent) => {
      const r = (event.detail as { result: BookCodeResult }).result;
      setResult(r);
      setCodeError(null);
      setIsOpen(true);
    };
    const errorHandler = (event: CustomEvent) => {
      const e = event.detail as CodeError;
      setCodeError(e);
      setResult(null);
      setIsOpen(true);
    };
    eventDispatcher.on('book-code-found', handler);
    eventDispatcher.on('book-code-error', errorHandler);
    return () => {
      eventDispatcher.off('book-code-found', handler);
      eventDispatcher.off('book-code-error', errorHandler);
    };
  }, []);

  // Check if this book is already in the library (case-insensitive title + author match)
  const alreadyOwned = useMemo(() => {
    if (!result) return null;
    const title = result.book.title.toLowerCase();
    const author = result.book.author.toLowerCase();
    return (
      visibleLibrary.find(
        (b) => b.title?.toLowerCase() === title && b.author?.toLowerCase() === author,
      ) ?? null
    );
  }, [result, visibleLibrary]);

  const handleClose = () => {
    setIsOpen(false);
    setResult(null);
    setCodeError(null);
    setBusyAction(null);
  };

  const getDownloadedFile = async (): Promise<File | null> => {
    if (!result) return null;
    try {
      const bytes = await downloadGiftBook(result.downloadRef);
      return new File([bytes], `${result.book.title}.epub`, {
        type: 'application/epub+zip',
      });
    } catch (err) {
      const message =
        err instanceof BookCodeError && err.statusCode === 410
          ? _('This gift has expired')
          : _('Download failed — please try again');
      eventDispatcher.dispatch('toast', { type: 'error', message, timeout: 3500 });
      return null;
    }
  };

  const ingestAndConfirm = async (file: File) => {
    const book = await ingestFile(
      { file, books: library, forceUpload: true },
      { appService: appService!, settings, isLoggedIn: !!user },
    );
    if (book) {
      if (result?.book.requestAnalytics) {
        book.analyticsStatus = 'ask';
      }
      setLibrary(library);
      void appService!.saveLibraryBooks(library);
      void confirmGiftRedemption(result!.downloadRef);
    }
    return book;
  };

  const handleStartReading = async () => {
    if (!result) return;
    if (alreadyOwned) {
      navigateToReader(router, [alreadyOwned.hash]);
      handleClose();
      return;
    }
    setBusyAction('reading');
    try {
      const file = await getDownloadedFile();
      if (!file) return;
      const book = await ingestAndConfirm(file);
      if (book) {
        navigateToReader(router, [book.hash]);
        handleClose();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!result) return;
    if (alreadyOwned) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Already in your library'),
        timeout: 2500,
      });
      return;
    }
    setBusyAction('saving');
    try {
      const file = await getDownloadedFile();
      if (!file) return;
      const book = await ingestAndConfirm(file);
      if (book) {
        eventDispatcher.dispatch('toast', {
          type: 'success',
          message: _('Added to your library'),
          timeout: 2500,
        });
        handleClose();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleShareFile = async (action: BusyAction, fallbackWebUrl: string) => {
    if (!result) return;
    if (isWebAppPlatform() || !isTauriAppPlatform()) {
      window.open(fallbackWebUrl, '_blank', 'noopener');
      return;
    }
    setBusyAction(action);
    try {
      const file = await getDownloadedFile();
      if (!file) return;
      const bytes = await file.arrayBuffer();
      await appService?.saveFile(`${result.book.title}.epub`, bytes, {
        share: true,
        mimeType: 'application/epub+zip',
      });
    } catch (err) {
      console.error('Share failed:', err);
      void openUrl(fallbackWebUrl);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendToKindle = async () => {
    if (!result) return;
    const kindle = kindleRef.current;
    const hasNativeKindle = kindle && (kindle.hasKindle || kindle.hasKindleFs || kindle.isFire);
    if (!hasNativeKindle) {
      window.open(KINDLE_WEB_URL, '_blank', 'noopener');
      return;
    }
    setBusyAction('kindle');
    try {
      const file = await getDownloadedFile();
      if (!file) return;
      const bytes = await file.arrayBuffer();
      const tmp = await tempDir();
      const safeTitle = result.book.title.replace(/[^\w\s-]/g, '_').trim();
      const epubPath = `${tmp}/${safeTitle}.epub`;
      await writeFile(epubPath, new Uint8Array(bytes));
      const shareResult = await sendToKindleApp(epubPath, result.book.title, kindle.isFire);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: shareResult.helperMessage,
        timeout: 6000,
      });
    } catch (err) {
      console.error('Send to Kindle failed:', err);
      window.open(KINDLE_WEB_URL, '_blank', 'noopener');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveToDownloads = async () => {
    if (!result) return;
    setBusyAction('downloads');
    try {
      const file = await getDownloadedFile();
      if (!file) return;
      const bytes = await file.arrayBuffer();
      await appService?.saveFile(`${result.book.title}.epub`, bytes, {
        mimeType: 'application/epub+zip',
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (!result && !codeError) return null;

  const busy = busyAction !== null;

  if (codeError) {
    return (
      <Dialog
        id='book_code_dialog'
        isOpen={isOpen}
        title={_('Claim Code')}
        onClose={handleClose}
        boxClassName='sm:!w-[440px] sm:!max-w-screen-sm sm:h-auto'
      >
        {isOpen && (
          <div className='flex flex-col items-center gap-5 pb-8 text-center'>
            <MdErrorOutline className='text-error mt-2' size={48} />
            <div className='flex flex-col gap-2'>
              <p className='text-base-content font-mono text-lg font-bold tracking-widest'>
                {codeError.code.toUpperCase()}
              </p>
              <p className='text-base-content/80 text-sm'>{codeError.message}</p>
              <p className='text-base-content/40 mt-2 text-xs'>
                {_('Error {{code}}', { code: String(codeError.statusCode) })}
              </p>
            </div>
            <button className='btn btn-outline w-full' onClick={handleClose}>
              {_('Close')}
            </button>
          </div>
        )}
      </Dialog>
    );
  }

  const { book, expiresAt } = result!;
  const expiryLabel = expiresAt
    ? _('Expires on {{date}}', {
        date: new Date(expiresAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
      })
    : null;
  const primaryLabel = alreadyOwned ? _('Continue Reading') : _('Start Reading');

  return (
    <Dialog
      id='book_code_dialog'
      isOpen={isOpen}
      title={_('We found your book!')}
      onClose={handleClose}
      boxClassName='sm:!w-[440px] sm:!max-w-screen-sm sm:h-auto'
    >
      {isOpen && (
        <div className='flex flex-col gap-5 pb-8'>
          {/* Book info */}
          <div className='flex gap-4'>
            <div className='relative flex h-36 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-base-300'>
              {book.coverImageUrl ? (
                <Image
                  src={book.coverImageUrl}
                  alt={book.title}
                  width={96}
                  height={144}
                  className='h-full w-full object-cover'
                />
              ) : (
                <MdMenuBook className='text-base-content/30' size={40} />
              )}
              {alreadyOwned && (
                <div className='absolute bottom-1 right-1'>
                  <MdCheckCircle className='text-primary drop-shadow' size={22} />
                </div>
              )}
            </div>

            <div className='flex flex-col justify-center gap-1.5'>
              <h3 className='text-base-content text-lg font-bold leading-snug'>{book.title}</h3>
              <p className='text-base-content/70 text-sm italic'>{book.author}</p>
              <div className='mt-1 flex flex-col gap-1'>
                <div className='text-base-content/60 flex items-center gap-1.5 text-xs'>
                  <MdMenuBook size={13} />
                  <span>{book.format}</span>
                </div>
              </div>
              {expiryLabel && <p className='text-base-content/50 text-xs'>{expiryLabel}</p>}
            </div>
          </div>

          {/* Description */}
          {book.description && (
            <p className='text-base-content/70 line-clamp-3 text-sm leading-relaxed'>
              {book.description}
            </p>
          )}

          {/* Actions */}
          <div className='flex flex-col gap-3'>
            <button
              className='btn btn-primary btn-lg w-full font-bold tracking-wide'
              onClick={handleStartReading}
              disabled={busy}
            >
              {busyAction === 'reading' ? (
                <RiLoader2Line className='animate-spin' size={20} />
              ) : (
                primaryLabel
              )}
            </button>

            <button
              className='btn btn-outline w-full'
              onClick={handleSaveToLibrary}
              disabled={busy}
            >
              {busyAction === 'saving' ? (
                <RiLoader2Line className='animate-spin' size={18} />
              ) : (
                _('Save to My Library')
              )}
            </button>

            {(!isWebAppPlatform() || isStoreCapture()) && !book.appOnlyReading && (
              <>
                <button
                  className='btn btn-ghost w-full'
                  onClick={handleSendToKindle}
                  disabled={busy}
                >
                  {busyAction === 'kindle' ? (
                    <RiLoader2Line className='animate-spin' size={18} />
                  ) : (
                    _('Send to Kindle')
                  )}
                </button>

                <button
                  className='btn btn-ghost w-full'
                  onClick={() => handleShareFile('playbooks', PLAY_BOOKS_WEB_URL)}
                  disabled={busy}
                >
                  {busyAction === 'playbooks' ? (
                    <RiLoader2Line className='animate-spin' size={18} />
                  ) : (
                    _('Upload to Play Books')
                  )}
                </button>
              </>
            )}

            {!book.appOnlyReading && (
              <button
                className='btn btn-ghost w-full'
                onClick={handleSaveToDownloads}
                disabled={busy}
              >
                {busyAction === 'downloads' ? (
                  <RiLoader2Line className='animate-spin' size={18} />
                ) : (
                  _('Save to Downloads')
                )}
              </button>
            )}

            <button
              className='btn btn-ghost text-base-content/50 w-full text-sm'
              onClick={handleClose}
              disabled={busy}
            >
              {_('Close')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
