import clsx from 'clsx';
import React, { useCallback, useEffect, useState } from 'react';
import { MdDeleteOutline } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { saveSysSettings } from '@/helpers/settings';
import {
  summarizeAudioStorage,
  type AudioStorageSummary,
  type LocalAudiobookUsage,
} from '@/services/audiobook/localAudioStorage';
import type { Book } from '@/types/book';
import { formatBytes, getDir } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';

interface AudiobookStorageDialogProps {
  onClose: () => void;
}

/**
 * On-device audiobook storage: per-title footprint, total, per-title
 * remove-download, and the Wi-Fi-only download preference. Removal is only
 * offered when a cloud copy exists — this dialog frees space, it never
 * destroys the sole copy of a book.
 */
const AudiobookStorageDialog: React.FC<AudiobookStorageDialogProps> = ({ onClose }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { library, updateBook } = useLibraryStore();
  const [summary, setSummary] = useState<AudioStorageSummary | null>(null);

  const loadUsage = useCallback(async () => {
    if (!appService) return;
    const audiobooks = library.filter((b) => b.hasAudio && b.downloadedAt && !b.deletedAt);
    const entries: LocalAudiobookUsage[] = [];
    for (const book of audiobooks) {
      let sizeBytes = 0;
      try {
        const files = await appService.readDirectory(getDir(book), 'Books');
        sizeBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
      } catch {
        // A missing directory means nothing is stored locally after all.
        continue;
      }
      entries.push({
        hash: book.hash,
        title: book.title,
        sizeBytes,
        removable: Boolean(book.uploadedAt),
      });
    }
    setSummary(summarizeAudioStorage(entries));
  }, [appService, library]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const removeDownload = useCallback(
    async (hash: string) => {
      const book = library.find((b) => b.hash === hash);
      if (!book || !appService) return;
      try {
        await appService.deleteBook(book, 'local');
        const updated: Book = { ...book, downloadedAt: null, updatedAt: Date.now() };
        await updateBook(envConfig, updated);
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 2000,
          message: _('Download removed: {{title}}', { title: book.title }),
        });
      } catch {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to remove download: {{title}}', { title: book.title }),
        });
      }
      void loadUsage();
    },
    [library, appService, envConfig, updateBook, loadUsage, _],
  );

  return (
    <Dialog
      id='audiobook_storage_dialog'
      isOpen
      title={_('Audiobook Storage')}
      onClose={onClose}
      boxClassName='sm:!max-w-lg'
    >
      <div className='flex flex-col gap-4 p-4 pt-0'>
        <div className='bg-base-200 eink-bordered rounded-box flex items-center justify-between px-4 py-3'>
          <span className='text-sm font-medium'>{_('Total Audio Storage')}</span>
          <span aria-label={_('Total Audio Storage')} className='text-sm tabular-nums' dir='ltr'>
            {formatBytes(summary?.totalBytes ?? 0)}
          </span>
        </div>

        <label className='flex items-center justify-between gap-2 px-1 text-sm'>
          <span className='flex flex-col'>
            {_('Wi-Fi Only Downloads')}
            <span className='text-base-content/60 text-xs'>
              {_('Never download audiobooks over cellular data.')}
            </span>
          </span>
          <input
            type='checkbox'
            className='toggle toggle-sm'
            aria-label={_('Wi-Fi Only Downloads')}
            checked={settings.wifiOnlyDownloads}
            onChange={(e) => void saveSysSettings(envConfig, 'wifiOnlyDownloads', e.target.checked)}
          />
        </label>

        <ul className='flex flex-col gap-1'>
          {(summary?.items ?? []).map((item) => (
            <li
              key={item.hash}
              data-storage-item
              className='bg-base-100 eink-bordered rounded-box flex items-center gap-3 px-3 py-2'
            >
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium'>{item.title}</div>
                <div className='text-base-content/60 text-xs tabular-nums' dir='ltr'>
                  {formatBytes(item.sizeBytes)}
                </div>
              </div>
              <button
                type='button'
                className={clsx('btn btn-ghost btn-circle btn-sm eink-bordered')}
                aria-label={_('Remove Download')}
                title={
                  item.removable ? _('Remove Download') : _('No cloud copy to restore from yet')
                }
                disabled={!item.removable}
                onClick={() => void removeDownload(item.hash)}
              >
                <MdDeleteOutline size={18} />
              </button>
            </li>
          ))}
          {summary != null && summary.items.length === 0 && (
            <li className='text-base-content/60 px-1 py-4 text-center text-sm'>
              {_('No downloaded audiobooks on this device.')}
            </li>
          )}
        </ul>
      </div>
    </Dialog>
  );
};

export default AudiobookStorageDialog;
