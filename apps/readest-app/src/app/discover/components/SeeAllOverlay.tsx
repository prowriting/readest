'use client';

import { useEffect, useRef, useState } from 'react';
import { PiArrowLeft, PiMagnifyingGlass } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import {
  type CatalogBookResult,
  type DiscoverBook,
  type DiscoverRow,
  searchCatalog,
} from '@/services/catalog';
import Spinner from '@/components/Spinner';
import CatalogCover from './CatalogCover';

interface SeeAllOverlayProps {
  row: DiscoverRow;
  onBack: () => void;
  onOpenBook: (book: DiscoverBook) => void;
}

const toDiscoverBook = (r: CatalogBookResult): DiscoverBook => ({
  id: `${r.source}:${r.sourceId}`,
  title: r.title,
  authors: r.author ? [r.author] : [],
  cover_url: r.coverUrl ?? '',
  description: r.description,
  is_free: true,
});

/**
 * Full-screen drill-in listing every book in a Discover row, replaying the row's
 * server query. Pushes over Discover (the tab bar stays hidden); the back arrow
 * is the only exit. A scoped search filters within the category.
 */
const SeeAllOverlay: React.FC<SeeAllOverlayProps> = ({ row, onBack, onOpenBook }) => {
  const _ = useTranslation();
  const { safeAreaInsets, statusBarHeight, systemUIVisible } = useThemeStore();
  const [results, setResults] = useState<CatalogBookResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    const run = async () => {
      setLoading(true);
      try {
        const res = await searchCatalog({
          topic: row.query.topic,
          language: row.query.language,
          sort: row.query.sort,
          q: query || undefined,
          pageSize: 50,
        });
        // Ignore out-of-order responses from rapid typing.
        if (id === reqId.current) setResults(res.results);
      } catch {
        if (id === reqId.current) setResults([]);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    };
    const t = setTimeout(run, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [row, query]);

  // Full-screen overlay pinned to the top of the display: clear the status bar
  // so the back arrow is not hidden under the system icons (SA top-inset rule).
  const topInset = Math.max(safeAreaInsets?.top ?? 0, systemUIVisible ? statusBarHeight : 0);

  return (
    <div
      className='bg-base-200 fixed inset-0 z-40 flex flex-col'
      style={{ paddingTop: `${topInset}px` }}
    >
      <div className='flex items-center gap-2 px-3 py-2'>
        <button
          type='button'
          aria-label={_('Back')}
          onClick={onBack}
          className='btn btn-ghost h-9 min-h-9 w-9 p-0'
        >
          <PiArrowLeft size={22} aria-hidden />
        </button>
        <h1 className='text-base-content truncate text-base font-semibold'>{row.title}</h1>
      </div>

      <div className='px-3 pb-2'>
        <div className='bg-base-100 eink-bordered flex items-center gap-2 rounded-full px-3 py-2'>
          <PiMagnifyingGlass className='text-base-content/50' size={16} aria-hidden />
          <input
            type='text'
            aria-label={_('Search {{title}}', { title: row.title })}
            placeholder={_('Search {{title}}…', { title: row.title })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className='text-base-content w-full bg-transparent text-sm outline-none'
          />
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {loading && (
          <div role='status' aria-label={_('Loading')} className='flex justify-center py-16'>
            <Spinner loading />
          </div>
        )}

        {!loading && results.length === 0 && (
          <p className='text-base-content/60 px-6 py-16 text-center text-sm'>
            {_('No books found.')}
          </p>
        )}

        {!loading &&
          results.map((b) => (
            <button
              key={`${b.source}:${b.sourceId}`}
              type='button'
              aria-label={_('Open {{title}}', { title: b.title })}
              onClick={() => onOpenBook(toDiscoverBook(b))}
              className='border-base-300/60 flex w-full items-start gap-3 border-b px-4 py-2.5 text-start'
            >
              <div className='aspect-[2/3] w-12 flex-shrink-0 overflow-hidden rounded'>
                <CatalogCover coverUrl={b.coverUrl} title={b.title} />
              </div>
              <div className='min-w-0 flex-1'>
                <div className='text-base-content line-clamp-2 text-sm font-medium leading-tight'>
                  {b.title}
                </div>
                <div className='text-base-content/50 line-clamp-1 text-xs'>{b.author}</div>
              </div>
            </button>
          ))}
      </div>
    </div>
  );
};

export default SeeAllOverlay;
