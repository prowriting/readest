import clsx from 'clsx';
import React from 'react';
import { MdArrowBackIosNew } from 'react-icons/md';
import BookCover from '@/components/BookCover';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useBookDataStore } from '@/store/bookDataStore';
import { Insets } from '@/types/misc';
import AudiobookControl from './AudiobookControl';

interface AudioOnlyScreenProps {
  bookKey: string;
  gridInsets: Insets;
  onGoToLibrary: () => void;
}

/**
 * Player-first screen for audio-only audiobooks: shown instead of the
 * paginated reader (which would be a run of near-empty pages). The foliate
 * view stays mounted underneath and keeps driving playback.
 */
const AudioOnlyScreen: React.FC<AudioOnlyScreenProps> = ({
  bookKey,
  gridInsets,
  onGoToLibrary,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(20);
  const { getBookData } = useBookDataStore();
  const book = getBookData(bookKey)?.book;

  if (!book?.isAudioOnly) return null;

  return (
    <div
      aria-label={_('Audiobook Screen')}
      className={clsx(
        'bg-base-100 absolute inset-0 z-30 flex flex-col items-center gap-4 overflow-y-auto px-6',
      )}
      style={{
        paddingTop: `${gridInsets.top + 12}px`,
        paddingBottom: `${gridInsets.bottom + 12}px`,
      }}
    >
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
      <div className='w-40 shrink-0'>
        <BookCover book={book} mode='grid' imageClassName='rounded shadow-md' />
      </div>
      <div className='max-w-lg text-center'>
        <div className='truncate text-lg font-semibold'>{book.title}</div>
        <div className='text-base-content/70 truncate text-sm'>{book.author}</div>
      </div>
      <AudiobookControl bookKey={bookKey} gridInsets={gridInsets} variant='fullscreen' />
    </div>
  );
};

export default AudioOnlyScreen;
