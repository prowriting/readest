'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { getAPIBaseUrl } from '@/services/environment';
import { RiLoader2Line } from 'react-icons/ri';

export default function ResetPasswordPage() {
  const _ = useTranslation();
  const router = useRouter();
  const params = useSearchParams();

  const token = params?.get('token') ?? '';
  const email = params?.get('email') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(_('Passwords do not match'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      const resp = await fetch(`${getAPIBaseUrl()}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, newPassword: password }),
      });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) {
        setError(data.error ?? _('Something went wrong'));
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/auth'), 2000);
    } catch {
      setError(_('Network error — please try again'));
    } finally {
      setBusy(false);
    }
  };

  if (!token || !email) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <p className='text-error'>{_('Invalid or expired reset link.')}</p>
      </div>
    );
  }

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='w-full max-w-md p-8'>
        <h1 className='text-base-content mb-6 text-xl font-bold'>{_('Set new password')}</h1>
        {done ? (
          <p className='text-success'>{_('Password updated — redirecting to sign in...')}</p>
        ) : (
          <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
            <input
              type='password'
              required
              autoComplete='new-password'
              placeholder={_('New password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className='input input-bordered w-full'
            />
            <input
              type='password'
              required
              autoComplete='new-password'
              placeholder={_('Confirm new password')}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className='input input-bordered w-full'
            />
            {error && <p className='text-error text-sm'>{error}</p>}
            <button type='submit' disabled={busy} className='btn btn-primary w-full'>
              {busy ? <RiLoader2Line className='animate-spin' size={18} /> : _('Update password')}
            </button>
            <button
              type='button'
              onClick={() => router.back()}
              className='btn btn-ghost w-full text-sm'
            >
              {_('Back')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
