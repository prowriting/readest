import clsx from 'clsx';
import React from 'react';
import { MdArrowBackIosNew } from 'react-icons/md';
import BookCover from '@/components/BookCover';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { Book } from '@/types/book';
import { Insets } from '@/types/misc';

interface AudiobookFullScreenProps {
  book: Book;
  gridInsets: Insets;
  /** Library escape hatch for audio-only books, which hide the header bar. */
  onGoToLibrary?: () => void;
  /** The embedded {@link AudiobookPlayer}. */
  children: React.ReactNode;
}

/**
 * Fullscreen player surface (v2 PRD §5.1): cover art, book title/author and
 * the full player. Default view for audio-only books; the expanded state of
 * the combined view for text+audio books. The foliate view stays mounted
 * underneath and keeps driving playback.
 */
const AudiobookFullScreen: React.FC<AudiobookFullScreenProps> = ({
  book,
  gridInsets,
  onGoToLibrary,
  children,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(20);

  return (
    <div
      aria-label={_('Audiobook Screen')}
      className={clsx(
        'bg-base-100 absolute inset-0 z-50 flex flex-col items-center gap-4 overflow-y-auto px-6',
      )}
      style={{
        paddingTop: `${gridInsets.top + 12}px`,
        paddingBottom: `${gridInsets.bottom + 12}px`,
      }}
    >
      {onGoToLibrary && (
        <div className='flex w-full max-w-lg items-center'>
          <button
            type='button'
            className='btn btn-ghost btn-circle btn-sm eink-bordered'
            aria-label={_('Go to Library')}
            title={_('Go to Library')}
            onClick={onGoToLibrary}
          >
            <MdArrowBackIosNew size={iconSize} />
          </button>
        </div>
      )}
      <div aria-label={_('Audiobook Cover')} className='aspect-[28/41] w-40 shrink-0'>
        <BookCover book={book} mode='grid' imageClassName='rounded shadow-md' />
      </div>
      <div className='max-w-lg text-center'>
        <div className='truncate text-lg font-semibold'>{book.title}</div>
        <div className='text-base-content/70 truncate text-sm'>{book.author}</div>
      </div>
      {children}
    </div>
  );
};

export default AudiobookFullScreen;
