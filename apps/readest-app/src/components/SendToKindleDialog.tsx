import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import { KINDLE_WEB_URL } from '@/services/kindle';
import { prepareFireKindleFile, type KindleSource } from '@/services/fireKindle';
import { sendToKindleApp } from '@/utils/bridge';
import Dialog from './Dialog';

export default function SendToKindleDialog({
  file,
  source,
  onClose,
}: {
  file: File | null;
  source?: KindleSource | null;
  onClose: () => void;
}) {
  const { appService } = useEnv();
  const _ = useTranslation();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [fallbackFile, setFallbackFile] = useState<File | null>(null);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [fireSaved, setFireSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const activeFile = file ?? fallbackFile;
  const directFire = !!source && !fallbackFile;
  useEffect(() => {
    setSaved(false);
    setError('');
    setFireSaved(false);
    setFallbackFile(null);
    return () => controller.current?.abort();
  }, [file, source]);

  const close = () => {
    if (nativeBusy) return;
    controller.current?.abort();
    onClose();
  };
  const importFire = async () => {
    if (!source || !appService || pending.current) return;
    const abort = new AbortController();
    controller.current = abort;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const prepared = await prepareFireKindleFile(appService, source, abort.signal);
      abort.signal.throwIfAborted();
      setNativeBusy(true);
      const result = await sendToKindleApp(
        prepared.path,
        source.title,
        prepared.exportKey,
        prepared.fileSha256,
      );
      if (!result.cancelled) {
        setFireSaved(true);
        if (!result.kindleOpened)
          setError(_('The file is saved. Open Kindle from your Home screen.'));
      }
    } catch (err) {
      if (!abort.signal.aborted)
        setError(
          err instanceof Error
            ? err.message
            : _('Could not save the Kindle copy. Please try again.'),
        );
    } finally {
      pending.current = false;
      setBusy(false);
      setNativeBusy(false);
    }
  };
  const useWebsite = async () => {
    if (!source || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      setFallbackFile(await source.loadOriginal());
    } catch {
      setError(_('Could not prepare the book for Kindle. Please try again.'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const save = async () => {
    if (!activeFile || !appService || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (
        await appService.saveFile(activeFile.name, await activeFile.arrayBuffer(), {
          mimeType: activeFile.type,
        })
      )
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
      isOpen={!!file || !!source}
      title={_('Send to Kindle')}
      onClose={
        directFire
          ? close
          : () => {
              if (!pending.current) onClose();
            }
      }
      dismissible={directFire ? !nativeBusy : !busy}
      boxClassName='sm:!w-[440px] sm:h-auto'
    >
      <div className='flex flex-col gap-4 pb-4'>
        <p className='break-words font-medium'>{directFire ? source?.title : activeFile?.name}</p>
        {directFire ? (
          <>
            <p className='text-sm'>
              {source.delivery || source.downloadRef
                ? _('Save your personalized Kindle copy to the Books folder on this Fire tablet.')
                : _(
                    'If a Kindle copy is not saved yet, BookArc will upload this EPUB to prepare one. Your original book stays in your library.',
                  )}
            </p>
            <p className='text-sm'>
              {_(
                'If asked, choose the Books folder and allow access. Kindle reads this local copy; it does not sync through Amazon.',
              )}
            </p>
            <button
              className='btn btn-primary min-h-11 w-full'
              disabled={busy}
              onClick={importFire}
            >
              {busy
                ? _('Preparing…')
                : fireSaved
                  ? _('Open Kindle')
                  : source.delivery || source.downloadRef
                    ? _('Save to Books')
                    : _('Continue')}
            </button>
            {fireSaved && (
              <p role='status' className='text-sm'>
                {_('File saved to Books. Check your Kindle library to open it.')}
              </p>
            )}
            <button
              className='btn btn-outline min-h-11 w-full'
              disabled={busy}
              onClick={useWebsite}
            >
              {_('Use Amazon Send to Kindle instead')}
            </button>
          </>
        ) : (
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
        )}
        {error && (
          <p role='alert' className='text-error text-sm'>
            {error}
          </p>
        )}
        <button
          className='btn btn-ghost eink-bordered min-h-11'
          disabled={directFire ? nativeBusy : busy}
          onClick={close}
        >
          {directFire && busy ? _('Cancel') : _('Close')}
        </button>
      </div>
    </Dialog>
  );
}
