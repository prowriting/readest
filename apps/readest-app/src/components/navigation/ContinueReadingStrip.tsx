'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PiPlayFill } from 'react-icons/pi';

import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { navigateToReader } from '@/utils/nav';
import { formatAuthors, formatTitle } from '@/utils/book';
import { formatTimeLeft } from '@/services/audiobook/bookTimeline';
import BookCover from '@/components/BookCover';

/**
 * Pinned "Continue reading" strip shown above the bottom tab bar. It surfaces
 * the most recently opened book (per {@link settings.lastOpenBooks}) so it is
 * always one tap away. Hidden when no book has been opened yet, or when the
 * most-recent entries have all been removed from the library.
 */
const ContinueReadingStrip: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const lastOpenBooks = useSettingsStore((s) => s.settings.lastOpenBooks);
  const visibleLibrary = useLibraryStore((s) => s.visibleLibrary);

  const book = useMemo(() => {
    for (const hash of lastOpenBooks ?? []) {
      const match = visibleLibrary.find((b) => b.hash === hash);
      if (match) return match;
    }
    return null;
  }, [lastOpenBooks, visibleLibrary]);

  if (!book) return null;

  const title = formatTitle(book.title);
  const isAudio = Boolean(book.hasAudio);
  // Whole-book seconds remaining, when the listening position is known.
  const audioRemaining =
    isAudio && book.audioDuration != null && book.audioPosition != null
      ? Math.max(0, book.audioDuration - book.audioPosition)
      : null;
  const label = isAudio ? _('Continue listening') : _('Continue reading');
  const ariaLabel = isAudio
    ? _('Continue listening {{title}}', { title })
    : _('Continue reading {{title}}', { title });

  return (
    <button
      type='button'
      aria-label={ariaLabel}
      onClick={() => navigateToReader(router, [book.hash])}
      className='bg-base-100 eink-bordered flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start'
    >
      <div className='bg-base-300 h-[34px] w-6 flex-shrink-0 overflow-hidden rounded-sm'>
        <BookCover book={book} />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='text-base-content/60 text-xs'>{label}</div>
        <div className='text-base-content truncate text-sm font-semibold'>{title}</div>
        <div
          className='text-base-content/50 truncate text-xs'
          dir={audioRemaining != null ? 'auto' : undefined}
        >
          {audioRemaining != null
            ? _('{{time}} left', { time: formatTimeLeft(audioRemaining) })
            : formatAuthors(book.author || book.metadata?.author || '')}
        </div>
      </div>
      <PiPlayFill className='text-primary h-4 w-4 flex-shrink-0' aria-hidden />
    </button>
  );
};

export default ContinueReadingStrip;
