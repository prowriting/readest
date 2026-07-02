'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PiStarFill } from 'react-icons/pi';
import { RiLoader2Line } from 'react-icons/ri';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { type DiscoverBook, fetchCatalogBook, parseDiscoverBookId } from '@/services/catalog';
import { acquireCatalogBook } from '@/services/catalogAcquire';
import { transferManager } from '@/services/transferManager';
import Dialog from '@/components/Dialog';
import CatalogCover from './CatalogCover';

interface CatalogBookDetailProps {
  book: DiscoverBook | null;
  onClose: () => void;
}

type BusyAction = 'read' | 'add' | null;

/**
 * Details for a Discover (store) book. The feed omits download links to stay
 * light, so this resolves the full catalog record (with formats) by id, then
 * downloads it via the shared OPDS-style acquisition path.
 */
const CatalogBookDetail: React.FC<CatalogBookDetailProps> = ({ book, onClose }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  const library = useLibraryStore((s) => s.library);
  const setLibrary = useLibraryStore((s) => s.setLibrary);
  const [busy, setBusy] = useState<BusyAction>(null);

  const acquire = async (thenRead: boolean) => {
    if (!book || !appService) return;
    const parsed = parseDiscoverBookId(book.id);
    if (!parsed) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        timeout: 3000,
        message: _('This book is unavailable.'),
      });
      return;
    }
    setBusy(thenRead ? 'read' : 'add');
    try {
      const full = await fetchCatalogBook(parsed.source, parsed.sourceId);
      const imported = await acquireCatalogBook(full, { appService, library });
      // Auto-upload acquired books to the cloud so they sync across devices —
      // same policy as the manual OPDS download path (honors the autoUpload
      // setting; no-op when signed out).
      if (user && settings.autoUpload && !imported.uploadedAt) {
        transferManager.queueUpload(imported);
      }
      setLibrary(library);
      void appService.saveLibraryBooks(library);
      if (thenRead) {
        navigateToReader(router, [imported.hash]);
        onClose();
      } else {
        eventDispatcher.dispatch('toast', {
          type: 'success',
          timeout: 2500,
          message: _('Added to your library'),
        });
        onClose();
      }
    } catch {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        timeout: 3500,
        message: _('Download failed — please try again'),
      });
    } finally {
      setBusy(null);
    }
  };

  if (!book) return null;
  const anyBusy = busy !== null;
  const hasRating = typeof book.rating_count === 'number' && book.rating_count > 0;

  return (
    <Dialog
      id='catalog_book_detail'
      isOpen={!!book}
      title={_('Book details')}
      onClose={onClose}
      boxClassName='sm:!w-[440px] sm:!max-w-screen-sm sm:h-auto'
    >
      <div className='flex flex-col gap-5 pb-6'>
        <div className='flex gap-4'>
          <div className='bg-base-300 h-36 w-24 flex-shrink-0 overflow-hidden rounded-md'>
            <CatalogCover coverUrl={book.cover_url} title={book.title} />
          </div>
          <div className='flex min-w-0 flex-col justify-center gap-1'>
            <h3 className='text-base-content text-lg font-bold leading-snug'>{book.title}</h3>
            <p className='text-base-content/70 text-sm italic'>{book.authors.join(', ')}</p>
            {hasRating && (
              <p className='text-amber-700 flex items-center gap-1 text-xs'>
                <PiStarFill size={12} aria-hidden />
                {book.rating_average?.toFixed(1)}
                <span className='text-base-content/50'>
                  {_('({{count}})', { count: book.rating_count! })}
                </span>
              </p>
            )}
          </div>
        </div>

        {book.categories && book.categories.length > 0 && (
          <div className='flex flex-wrap gap-1.5'>
            {book.categories.slice(0, 4).map((c) => (
              <span
                key={c.id}
                className='bg-base-200 text-base-content/70 rounded-full px-2 py-0.5 text-xs'
              >
                {c.name}
              </span>
            ))}
          </div>
        )}

        {book.description && (
          <p className='text-base-content/70 line-clamp-4 text-sm leading-relaxed'>
            {book.description}
          </p>
        )}

        <div className='flex flex-col gap-3'>
          <button
            type='button'
            className='btn btn-primary w-full'
            disabled={anyBusy}
            onClick={() => acquire(true)}
          >
            {busy === 'read' ? <RiLoader2Line className='animate-spin' size={18} /> : _('Read now')}
          </button>
          <button
            type='button'
            className='btn btn-outline w-full'
            disabled={anyBusy}
            onClick={() => acquire(false)}
          >
            {busy === 'add' ? (
              <RiLoader2Line className='animate-spin' size={18} />
            ) : (
              _('Add to Library')
            )}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default CatalogBookDetail;
