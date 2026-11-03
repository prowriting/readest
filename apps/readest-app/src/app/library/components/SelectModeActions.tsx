import clsx from 'clsx';
import {
  MdDelete,
  MdOpenInNew,
  MdOutlineCancel,
  MdInfoOutline,
  MdCheckCircleOutline,
  MdSend,
} from 'react-icons/md';
import { LuFolderPlus } from 'react-icons/lu';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useTranslation } from '@/hooks/useTranslation';
import { isMd5 } from '@/utils/md5';
import type { Book } from '@/types/book';
import { getKindleAvailability } from '@/utils/bookDelivery';

interface SelectModeActionsProps {
  selectedBooks: string[];
  safeAreaBottom: number;
  onOpen: () => void;
  onGroup: () => void;
  onDetails: () => void;
  onStatus: () => void;
  onDelete: () => void;
  onCancel: () => void;
  kindleBook?: Book;
  kindlePreparing?: boolean;
  onSendToKindle?: () => void;
}

const SelectModeActions: React.FC<SelectModeActionsProps> = ({
  selectedBooks,
  safeAreaBottom,
  onOpen,
  onGroup,
  onDetails,
  onStatus,
  onDelete,
  onCancel,
  kindleBook,
  kindlePreparing = false,
  onSendToKindle,
}) => {
  const _ = useTranslation();

  const hasSelection = selectedBooks.length > 0;
  const hasValidBooks = selectedBooks.every((id) => isMd5(id));
  const hasSingleSelection = selectedBooks.length === 1;
  const divRef = useKeyDownActions({ onCancel });
  const kindleAvailability = hasSingleSelection ? getKindleAvailability(kindleBook) : 'hidden';

  return (
    <div
      ref={divRef}
      className='fixed bottom-0 left-0 right-0 z-40'
      style={{
        paddingBottom: `${safeAreaBottom + 16}px`,
      }}
    >
      <div
        className={clsx(
          'text-base-content text-xs shadow-lg',
          'not-eink:bg-base-300 eink:bg-base-100 eink:border eink:border-base-content',
          'mx-auto w-fit max-w-[calc(100vw-1rem)] rounded-lg p-4',
          'flex flex-wrap items-center justify-center gap-x-4 [&>button]:min-h-11 [&>button]:min-w-11',
          'max-[640px]:grid max-[640px]:grid-cols-4 max-[640px]:gap-x-3 max-[640px]:gap-y-3',
        )}
      >
        <button
          onClick={onOpen}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <MdOpenInNew />
          <div>{_('Open')}</div>
        </button>
        <button
          onClick={onGroup}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            !hasSelection && 'btn-disabled opacity-50',
          )}
        >
          <LuFolderPlus />
          <div>{_('Group')}</div>
        </button>
        <button
          onClick={onStatus}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <MdCheckCircleOutline />
          <div>{_('Status')}</div>
        </button>
        <button
          onClick={onDetails}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSingleSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <MdInfoOutline />
          <div>{_('Details')}</div>
        </button>
        {kindleAvailability !== 'hidden' && (
          <button
            onClick={onSendToKindle}
            disabled={kindleAvailability === 'download' || kindlePreparing}
            aria-label={_('Send to Kindle')}
            aria-describedby={
              kindleAvailability === 'download' ? 'kindle-download-guidance' : undefined
            }
            aria-busy={kindlePreparing}
            className='flex max-w-24 flex-col items-center justify-center gap-1 disabled:opacity-50'
          >
            <MdSend />
            <span>{kindlePreparing ? _('Preparing…') : _('Send to Kindle')}</span>
            {kindleAvailability === 'download' && (
              <span id='kindle-download-guidance'>{_('Download this book first')}</span>
            )}
          </button>
        )}
        <button
          onClick={onDelete}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            kindleAvailability === 'hidden' && 'max-[640px]:col-start-2',
            !hasSelection && 'btn-disabled opacity-50',
          )}
        >
          <MdDelete className='text-red-500' />
          <div className='text-red-500'>{_('Delete')}</div>
        </button>
        <button onClick={onCancel} className='flex flex-col items-center justify-center gap-1'>
          <MdOutlineCancel />
          <div>{_('Cancel')}</div>
        </button>
      </div>
    </div>
  );
};

export default SelectModeActions;
