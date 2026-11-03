import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import { KINDLE_WEB_URL } from '@/services/kindle';
import Dialog from './Dialog';

export default function SendToKindleDialog({
  file,
  onClose,
}: {
  file: File | null;
  onClose: () => void;
}) {
  const { appService } = useEnv();
  const _ = useTranslation();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setSaved(false);
    setError('');
  }, [file]);

  const save = async () => {
    if (!file || !appService || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (await appService.saveFile(file.name, await file.arrayBuffer(), { mimeType: file.type }))
        setSaved(true);
    } catch {
      setError(_('Could not save the file. Please try again.'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const open = async () => {
    try {
      if (isTauriAppPlatform()) await openUrl(KINDLE_WEB_URL);
      else window.open(KINDLE_WEB_URL, '_blank', 'noopener,noreferrer');
    } catch {
      setError(_('Could not open Send to Kindle. Please try again.'));
    }
  };
  return (
    <Dialog
      isOpen={!!file}
      title={_('Send to Kindle')}
      onClose={() => {
        if (!pending.current) onClose();
      }}
      dismissible={!busy}
      boxClassName='sm:!w-[440px] sm:h-auto'
    >
      <div className='flex flex-col gap-4 pb-4'>
        <p className='break-words font-medium'>{file?.name}</p>
        <ol className='list-decimal space-y-4 ps-5 text-sm'>
          <li>
            <p className='mb-2'>{_('Save a copy of this book to your device.')}</p>
            <button className='btn btn-outline min-h-11 w-full' disabled={busy} onClick={save}>
              {_('Save file')}
            </button>
            {saved && (
              <p className='mt-2' role='status'>
                {_('File saved. Continue to Send to Kindle.')}
              </p>
            )}
          </li>
          <li>
            <p className='mb-2'>{_('Open Amazon’s Send to Kindle and upload the saved file.')}</p>
            <button
              className='btn btn-primary min-h-11 w-full'
              disabled={!saved || busy}
              onClick={open}
            >
              {_('Open Send to Kindle')}
            </button>
          </li>
        </ol>
        {error && (
          <p role='alert' className='text-error text-sm'>
            {error}
          </p>
        )}
        <button className='btn btn-ghost eink-bordered min-h-11' disabled={busy} onClick={onClose}>
          {_('Close')}
        </button>
      </div>
    </Dialog>
  );
}
