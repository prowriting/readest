'use client';

import { useState } from 'react';
import { PiGift } from 'react-icons/pi';
import { RiLoader2Line } from 'react-icons/ri';

import { useTranslation } from '@/hooks/useTranslation';
import { fetchBookByCode, BookCodeError } from '@/services/bookCode';
import { eventDispatcher } from '@/utils/event';

const CODE_LENGTH = 7;
const INVALID_CLAIM_CODE_CHARACTER = /[^a-hj-km-np-zA-HJ-KM-NP-Z2-9]/g;

// Mirrors the deep-link claim error mapping in useOpenWithCode so manual and
// link-driven claims surface the same messages.
const ERROR_MESSAGES: Record<number, string> = {
  404: "That code wasn't found — check for typos",
  409: 'This gift has already been claimed',
  410: 'This gift has expired',
  423: 'This gift is no longer available',
  429: 'Too many attempts — please try again shortly',
};

const sanitize = (raw: string) =>
  raw.replace(INVALID_CLAIM_CODE_CHARACTER, '').toUpperCase().slice(0, CODE_LENGTH);

/**
 * The Claim screen. A reader enters the 7-character code an author sent them; on a
 * successful redemption the found book is handed to the existing
 * {@link BookCodeDialog} (via the `book-code-found` event), which downloads it
 * and adds it to the library — the same path deep-link claims use.
 */
const ClaimScreen: React.FC = () => {
  const _ = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCode(sanitize(e.target.value));
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (code.length !== CODE_LENGTH) {
      setError(_('Claim codes are {{count}} letters or numbers.', { count: CODE_LENGTH }));
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError(_('Claiming needs a connection. Reconnect and try again.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await fetchBookByCode(code);
      eventDispatcher.dispatch('book-code-found', { result });
    } catch (err) {
      const status = err instanceof BookCodeError ? err.statusCode : 0;
      setError(_(ERROR_MESSAGES[status] ?? 'Something went wrong — please try again'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='mx-auto flex w-full max-w-sm flex-col px-5 py-8'>
      <div className='flex flex-col items-center text-center'>
        <PiGift className='text-primary' size={38} aria-hidden />
        <h1 className='text-base-content mt-2 text-xl font-semibold'>{_('Claim a book')}</h1>
        <p className='text-base-content/70 mt-1 text-sm leading-relaxed'>
          {_('Enter the code an author sent you to add their book to your library.')}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className='bg-base-100 eink-bordered mt-6 flex flex-col gap-3 rounded-xl border border-base-300 p-4'
      >
        <label htmlFor='claim-code-input' className='text-base-content/70 text-xs font-semibold'>
          {_('Claim code')}
        </label>
        <input
          id='claim-code-input'
          type='text'
          inputMode='text'
          autoCapitalize='characters'
          autoCorrect='off'
          spellCheck={false}
          maxLength={CODE_LENGTH}
          value={code}
          onChange={handleChange}
          placeholder='FBC83A2'
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'claim-code-error' : undefined}
          className='eink-bordered bg-base-200 text-base-content rounded-lg px-3 py-2.5 font-mono text-base tracking-[0.28em]'
        />
        {error && (
          <p id='claim-code-error' role='alert' className='text-error text-sm'>
            {error}
          </p>
        )}
        <button
          type='submit'
          aria-label={_('Claim book')}
          disabled={busy}
          className='btn btn-primary mt-1'
        >
          {busy ? <RiLoader2Line className='animate-spin' size={18} /> : _('Claim book')}
        </button>
      </form>
    </div>
  );
};

export default ClaimScreen;
