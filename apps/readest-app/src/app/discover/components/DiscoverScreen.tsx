'use client';

import { PiCaretRight, PiCompass } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useDiscover } from '@/hooks/useDiscover';
import type { DiscoverBook, DiscoverRow } from '@/services/catalog';
import Spinner from '@/components/Spinner';
import CatalogCover from './CatalogCover';

interface DiscoverScreenProps {
  onOpenBook: (book: DiscoverBook) => void;
  onSeeAll: (row: DiscoverRow) => void;
}

/**
 * The Discover store-browse screen: a vertical stack of horizontally-scrolling
 * rows delivered entirely by the server. Rows and their order are never
 * hard-coded here. Tapping a cover opens its details (which carries the download
 * link); "See all" drills into the row.
 */
const DiscoverScreen: React.FC<DiscoverScreenProps> = ({ onOpenBook, onSeeAll }) => {
  const _ = useTranslation();
  const { rows, status, reload } = useDiscover();

  const freshness =
    status === 'fresh'
      ? _('Updated just now')
      : status === 'cached'
        ? _('Showing saved picks')
        : null;

  return (
    <div className='flex flex-col pb-4'>
      <div className='flex items-center justify-between px-4 pt-3'>
        <span className='text-primary text-[10px] font-semibold uppercase tracking-wider'>
          {_('Discover')}
        </span>
        {freshness && <span className='text-base-content/50 text-xs'>{freshness}</span>}
      </div>

      {rows.length === 0 && status === 'loading' && (
        <div role='status' aria-label={_('Loading')} className='flex justify-center py-16'>
          <Spinner loading />
        </div>
      )}

      {status === 'empty' && (
        <div className='flex flex-col items-center gap-3 px-6 py-16 text-center'>
          <PiCompass className='text-base-content/40' size={40} aria-hidden />
          <p className='text-base-content/70 text-sm'>
            {_('Nothing to show yet. Check your connection and try again.')}
          </p>
          <button type='button' className='btn btn-primary btn-sm' onClick={() => reload()}>
            {_('Try again')}
          </button>
        </div>
      )}

      {rows.map((row) => (
        <section key={row.id} className='mt-4'>
          <div className='flex items-center justify-between px-4'>
            <h2 className='text-base-content text-sm font-semibold'>{row.title}</h2>
            <button
              type='button'
              aria-label={_('See all in {{title}}', { title: row.title })}
              onClick={() => onSeeAll(row)}
              className='text-primary flex items-center gap-0.5 text-xs font-semibold'
            >
              {_('See all')}
              <PiCaretRight size={12} aria-hidden />
            </button>
          </div>
          <div className='mt-2 flex gap-3 overflow-x-auto px-4 pb-1'>
            {row.books.map((b) => (
              <button
                key={b.id}
                type='button'
                aria-label={_('Open {{title}}', { title: b.title })}
                onClick={() => onOpenBook(b)}
                // flex-col top-aligns the content; a bare <button> vertically
                // centers it, which drops the cover when the title is one line.
                className='flex w-[88px] flex-shrink-0 flex-col text-start'
              >
                <div className='aspect-[2/3] w-full overflow-hidden rounded-md'>
                  <CatalogCover coverUrl={b.cover_url} title={b.title} />
                </div>
                <div className='text-base-content mt-1 line-clamp-2 text-xs font-medium leading-tight'>
                  {b.title}
                </div>
                <div className='text-base-content/50 line-clamp-1 text-[11px]'>
                  {b.authors.join(', ')}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default DiscoverScreen;
