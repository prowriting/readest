'use client';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { FcGoogle } from 'react-icons/fc';
import { FaApple } from 'react-icons/fa';
import { IoArrowBack } from 'react-icons/io5';
import { RiLoader2Line } from 'react-icons/ri';

import { useAuth, type AuthUser } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { getBaseUrl, getAPIBaseUrl, isTauriAppPlatform } from '@/services/environment';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { start, cancel, onUrl, onInvalidUrl } from '@fabianlars/tauri-plugin-oauth';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { handleAuthCallback } from '@/helpers/auth';
import { getUserProfilePlan } from '@/utils/access';
import { eventDispatcher } from '@/utils/event';
import { getAppleIdAuth, Scope } from './utils/appleIdAuth';
import { authWithCustomTab, authWithSafari } from './utils/nativeAuth';
import WindowButtons from '@/components/WindowButtons';

type OAuthProvider = 'google' | 'apple';

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

interface ProviderLoginProp {
  provider: OAuthProvider;
  handleSignIn: (provider: OAuthProvider) => void;
  Icon: React.ElementType;
  label: string;
  disabled?: boolean;
}

const API_BASE = getAPIBaseUrl();
const WEB_AUTH_CALLBACK = `${getBaseUrl()}/auth/callback`;
const DEEPLINK_CALLBACK = 'bookarc://auth-callback';
const USE_APPLE_SIGN_IN = process.env['NEXT_PUBLIC_USE_APPLE_SIGN_IN'] === 'true';

interface MarketingPolicy {
  requiresExplicitOptIn: boolean;
  policyVersion: string;
  wordingVersion: string;
  wording: string;
}

const ProviderLogin: React.FC<ProviderLoginProp> = ({
  provider,
  handleSignIn,
  Icon,
  label,
  disabled,
}) => (
  <button
    onClick={() => handleSignIn(provider)}
    disabled={disabled}
    className={clsx(
      'mb-2 flex w-64 items-center justify-center rounded border p-2.5',
      'bg-base-100 border-base-300 hover:bg-base-200 shadow-sm transition',
      disabled && 'cursor-not-allowed opacity-50',
    )}
  >
    <Icon />
    <span className='text-base-content/75 px-2 text-sm'>{label}</span>
  </button>
);

export default function AuthPage() {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams?.get('next') ?? '/library';
  const { login } = useAuth();
  const { envConfig, appService } = useEnv();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  const { isTrafficLightVisible } = useTrafficLightStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [port, setPort] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const isOAuthServerRunning = useRef(false);
  const useCustomeOAuth = useRef(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [marketingPolicy, setMarketingPolicy] = useState<MarketingPolicy | null>(null);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [resendComplete, setResendComplete] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);

  useTheme({ systemUIVisible: false });

  const getTauriRedirectTo = (isOAuth: boolean) => {
    if (
      !useCustomeOAuth.current &&
      (process.env.NODE_ENV === 'production' || appService?.isMobileApp || USE_APPLE_SIGN_IN)
    ) {
      return appService?.isMobileApp && !isOAuth ? WEB_AUTH_CALLBACK : DEEPLINK_CALLBACK;
    }
    return `http://localhost:${port}`;
  };

  const getWebRedirectTo = () =>
    process.env.NODE_ENV === 'production'
      ? WEB_AUTH_CALLBACK
      : `${window.location.origin}/auth/callback`;

  // Tauri: Apple native token exchange
  const tauriSignInApple = async () => {
    const request = { scope: ['fullName', 'email'] as Scope[] };
    if (appService?.isIOSApp || USE_APPLE_SIGN_IN) {
      const appleAuthResponse = await getAppleIdAuth(request);
      if (appleAuthResponse.identityToken) {
        const resp = await fetch(`${API_BASE}/auth/apple/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken: appleAuthResponse.identityToken,
            authorizationCode: appleAuthResponse.authorizationCode,
            marketingOptIn: isSignUp && marketingOptIn,
            marketingPolicyVersion: marketingPolicy?.policyVersion,
            marketingWordingVersion: marketingPolicy?.wordingVersion,
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            accessToken: string;
            refreshToken: string;
            user: AuthUser;
          };
          localStorage.setItem('refresh_token', data.refreshToken);
          login(data.accessToken, data.user);
          router.push('/library');
        }
      }
    } else {
      tauriSignIn('apple');
    }
  };

  // Tauri: redirect-based OAuth via BookArcReaderApi
  const tauriSignIn = async (provider: OAuthProvider) => {
    const redirectTo = getTauriRedirectTo(true);
    const oauthStartUrl =
      `${API_BASE}/auth/${provider}?redirect_uri=${encodeURIComponent(redirectTo)}` +
      `&marketing_opt_in=${isSignUp && marketingOptIn}` +
      `&marketing_policy_version=${encodeURIComponent(marketingPolicy?.policyVersion ?? '')}` +
      `&marketing_wording_version=${encodeURIComponent(marketingPolicy?.wordingVersion ?? '')}`;

    if (appService?.isIOSApp || appService?.isMacOSApp) {
      const res = await authWithSafari({ authUrl: oauthStartUrl });
      if (res) handleOAuthUrl(res.redirectUrl);
    } else if (appService?.isAndroidApp) {
      const res = await authWithCustomTab({ authUrl: oauthStartUrl });
      if (res) handleOAuthUrl(res.redirectUrl);
    } else {
      await openUrl(oauthStartUrl);
    }
  };

  const exchangeConfirmationCode = async (code: string) => {
    setFormBusy(true);
    setFormError(null);
    try {
      const resp = await fetch(`${API_BASE}/auth/exchange-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = (await resp.json()) as {
        accessToken?: string;
        refreshToken?: string;
        user?: AuthUser;
        error?: string;
      };
      if (!resp.ok || !data.accessToken || !data.refreshToken || !data.user) {
        setFormError(data.error ?? _('This confirmation link is no longer valid'));
        return;
      }
      localStorage.setItem('refresh_token', data.refreshToken);
      login(data.accessToken, data.user);
      void eventDispatcher.dispatch('toast', {
        message: _('Subscription confirmed'),
        type: 'success',
        timeout: 3500,
      });
      router.push(nextUrl);
    } catch {
      setFormError(_('Network error — please try again'));
    } finally {
      setFormBusy(false);
    }
  };

  const handleOAuthUrl = (url: string) => {
    const parsed = new URL(url);
    const confirmationCode = parsed.searchParams.get('code');
    if (confirmationCode && parsed.pathname.includes('subscription-confirmed')) {
      void exchangeConfirmationCode(confirmationCode);
      return;
    }
    const hashMatch = url.match(/#(.*)/);
    if (!hashMatch) return;
    const params = new URLSearchParams(hashMatch[1]!);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');
    if (accessToken) {
      const next =
        getUserProfilePlan(accessToken) === 'free' ? '/user' : (params.get('next') ?? '/');
      handleAuthCallback({ accessToken, refreshToken, type, next, login, navigate: router.push });
    }
  };

  // Web: redirect to BookArcReaderApi OAuth start
  const webSignIn = (provider: OAuthProvider) => {
    if (nextUrl !== '/library') sessionStorage.setItem('auth_return_url', nextUrl);
    const redirectTo = getWebRedirectTo();
    window.location.href =
      `${API_BASE}/auth/${provider}?redirect_uri=${encodeURIComponent(redirectTo)}` +
      `&marketing_opt_in=${isSignUp && marketingOptIn}` +
      `&marketing_policy_version=${encodeURIComponent(marketingPolicy?.policyVersion ?? '')}` +
      `&marketing_wording_version=${encodeURIComponent(marketingPolicy?.wordingVersion ?? '')}`;
  };

  // Web: email/password via BookArcReaderApi
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormBusy(true);
    try {
      const endpoint = isSignUp ? '/auth/register' : '/auth/login';
      const returnUrl = isTauriAppPlatform()
        ? 'bookarc://auth/subscription-confirmed'
        : `${window.location.origin}/auth?subscription_confirmed=1`;
      const resp = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isSignUp
            ? {
                email,
                password,
                marketingOptIn,
                marketingPolicyVersion: marketingPolicy?.policyVersion,
                marketingWordingVersion: marketingPolicy?.wordingVersion,
                returnUrl,
                locale: navigator.language,
              }
            : { email, password },
        ),
      });
      const data = (await resp.json()) as {
        accessToken?: string;
        refreshToken?: string;
        user?: AuthUser;
        error?: string;
        requiresEmailConfirmation?: boolean;
        email?: string;
        policy?: MarketingPolicy;
      };
      if (!resp.ok) {
        if (data.error === 'marketing_policy_changed' && data.policy) {
          setMarketingPolicy(data.policy);
          setFormError(_('The email preference wording changed. Please review it and try again.'));
          return;
        }
        if (data.error === 'email_confirmation_required') {
          setConfirmationEmail(email);
          return;
        }
        setFormError(data.error ?? 'Something went wrong');
        return;
      }
      if (data.requiresEmailConfirmation) {
        setConfirmationEmail(data.email ?? email);
        return;
      }
      localStorage.setItem('refresh_token', data.refreshToken!);
      login(data.accessToken!, data.user!);
      router.push(nextUrl);
    } catch {
      setFormError(_('Network error — please try again'));
    } finally {
      setFormBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!confirmationEmail) return;
    setFormBusy(true);
    setFormError(null);
    try {
      const returnUrl = isTauriAppPlatform()
        ? 'bookarc://auth/subscription-confirmed'
        : `${window.location.origin}/auth?subscription_confirmed=1`;
      await fetch(`${API_BASE}/auth/resend-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: confirmationEmail, returnUrl }),
      });
      setResendComplete(true);
    } catch {
      setFormError(_('Network error — please try again'));
    } finally {
      setFormBusy(false);
    }
  };

  const handleGoBack = () => {
    settings.keepLogin = false;
    setSettings(settings);
    saveSettings(envConfig, settings);
    const redirectTo = new URLSearchParams(window.location.search).get('redirect');
    if (redirectTo) router.push(redirectTo);
    else router.back();
  };

  const startTauriOAuth = async () => {
    try {
      if (
        !useCustomeOAuth.current &&
        (process.env.NODE_ENV === 'production' || appService?.isMobileApp || USE_APPLE_SIGN_IN)
      ) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        currentWindow.listen('single-instance', ({ payload }) => {
          const { args } = payload as SingleInstancePayload;
          if (args?.[1]) handleOAuthUrl(args[1]);
        });
        await onOpenUrl((urls) => urls.forEach((url) => handleOAuthUrl(url)));
      } else {
        const p = await start();
        setPort(p);
        await onUrl(handleOAuthUrl);
        await onInvalidUrl((url) => console.log('Invalid OAuth URL:', url));
      }
    } catch (error) {
      console.error('Error starting OAuth server:', error);
    }
  };

  const stopTauriOAuth = async () => {
    try {
      if (port) await cancel(port);
    } catch {}
  };

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (isOAuthServerRunning.current) return;
    isOAuthServerRunning.current = true;
    invoke('get_environment_variable', { name: 'USE_CUSTOM_OAUTH' }).then((v) => {
      if (v === 'true') useCustomeOAuth.current = true;
    });
    startTauriOAuth();
    return () => {
      isOAuthServerRunning.current = false;
      stopTauriOAuth();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setIsMounted(true);
    fetch(`${API_BASE}/compliance/marketing-policy`)
      .then((response) => response.json())
      .then((policy: MarketingPolicy) => setMarketingPolicy(policy))
      .catch(() => {
        setMarketingPolicy({
          requiresExplicitOptIn: true,
          policyVersion: '2026-07-01',
          wordingVersion: 'reader-marketing-v1',
          wording:
            'Send me BookArc reading tips, product updates, and occasional offers by email. I can unsubscribe at any time.',
        });
      });
  }, []);

  useEffect(() => {
    const code = searchParams?.get('code');
    if (code && searchParams?.get('subscription_confirmed') === '1') {
      void exchangeConfirmationCode(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (!isMounted) return null;

  const emailForm = confirmationEmail ? (
    <div className='border-base-300 bg-base-200/40 flex w-64 flex-col gap-4 rounded border p-4 text-center'>
      <div>
        <h1 className='text-base font-semibold'>{_('Check your email')}</h1>
        <p className='text-base-content/65 mt-2 text-sm'>
          {_('We sent a confirmation link to')} <strong>{confirmationEmail}</strong>.
        </p>
      </div>
      {formError && <p className='text-error text-xs'>{formError}</p>}
      {resendComplete ? (
        <p className='text-success text-xs'>{_('A new confirmation email has been sent')}</p>
      ) : (
        <button
          type='button'
          onClick={resendConfirmation}
          disabled={formBusy}
          className='btn btn-outline btn-sm min-h-11 w-full'
        >
          {formBusy ? <RiLoader2Line className='animate-spin' size={16} /> : _('Resend email')}
        </button>
      )}
      <button
        type='button'
        className='text-base-content/60 text-xs underline'
        onClick={() => {
          setConfirmationEmail(null);
          setResendComplete(false);
        }}
      >
        {_('Use a different email address')}
      </button>
    </div>
  ) : (
    <EmailPasswordForm
      email={email}
      setEmail={setEmail}
      password={password}
      setPassword={setPassword}
      isSignUp={isSignUp}
      setIsSignUp={setIsSignUp}
      formBusy={formBusy}
      formError={formError}
      marketingPolicy={marketingPolicy}
      marketingOptIn={marketingOptIn}
      setMarketingOptIn={setMarketingOptIn}
      onSubmit={handleEmailSubmit}
      _={_}
    />
  );

  // ── Tauri layout ────────────────────────────────────────────────────────────
  if (isTauriAppPlatform()) {
    return (
      <div
        className={clsx(
          'bg-base-100 full-height inset-0 flex select-none flex-col items-center overflow-hidden',
          appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
        )}
      >
        <div
          className='flex h-full w-full flex-col items-center overflow-y-auto'
          style={{ paddingTop: `${safeAreaInsets?.top || 0}px` }}
        >
          <div
            ref={headerRef}
            className={clsx(
              'fixed z-10 flex w-full items-center justify-between py-2 pe-6 ps-4',
              appService?.hasTrafficLight && 'pt-11',
            )}
          >
            <button
              aria-label={_('Go Back')}
              onClick={handleGoBack}
              className='btn btn-ghost h-12 min-h-12 w-12 p-0 sm:h-8 sm:min-h-8 sm:w-8'
            >
              <IoArrowBack className='text-base-content' />
            </button>
            {appService?.hasWindowBar && (
              <WindowButtons
                headerRef={headerRef}
                showMinimize={!isTrafficLightVisible}
                showMaximize={!isTrafficLightVisible}
                showClose={!isTrafficLightVisible}
                onClose={handleGoBack}
              />
            )}
          </div>
          <div
            className={clsx(
              'z-20 flex flex-col items-center pb-8',
              appService?.hasTrafficLight ? 'mt-24' : 'mt-12',
            )}
            style={{ maxWidth: '420px' }}
          >
            <ProviderLogin
              provider='google'
              handleSignIn={tauriSignIn}
              Icon={FcGoogle}
              label={_('Sign in with {{provider}}', { provider: 'Google' })}
            />
            <ProviderLogin
              provider='apple'
              handleSignIn={
                appService?.isIOSApp || USE_APPLE_SIGN_IN ? tauriSignInApple : tauriSignIn
              }
              Icon={FaApple}
              label={_('Sign in with {{provider}}', { provider: 'Apple' })}
            />
            <hr aria-hidden='true' className='border-base-300 my-3 mt-6 w-64 border-t' />
            {emailForm}
          </div>
        </div>
      </div>
    );
  }

  // ── Web layout ──────────────────────────────────────────────────────────────
  const isClaimRedirect = nextUrl.startsWith('/read?code=');

  return (
    <div style={{ maxWidth: '420px', margin: 'auto', padding: '2rem', paddingTop: '4rem' }}>
      <button
        onClick={handleGoBack}
        className='btn btn-ghost fixed left-6 top-6 h-8 min-h-8 w-8 p-0'
      >
        <IoArrowBack className='text-base-content' />
      </button>
      <div className='flex flex-col items-center gap-2'>
        {isClaimRedirect && (
          <div className='mb-4 w-64 text-center'>
            <p className='text-base-content text-sm font-medium'>
              {_('Sign in to read your book')}
            </p>
            <p className='text-base-content/60 mt-1 text-xs'>
              {_('A free account saves your place and syncs highlights across devices.')}
            </p>
          </div>
        )}
        <ProviderLogin
          provider='google'
          handleSignIn={webSignIn}
          Icon={FcGoogle}
          label={_('Sign in with {{provider}}', { provider: 'Google' })}
        />
        <ProviderLogin
          provider='apple'
          handleSignIn={webSignIn}
          Icon={FaApple}
          label={_('Sign in with {{provider}}', { provider: 'Apple' })}
        />
        <hr aria-hidden='true' className='border-base-300 my-3 mt-2 w-64 border-t' />
        {emailForm}
      </div>
    </div>
  );
}

interface EmailFormProps {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  isSignUp: boolean;
  setIsSignUp: (v: boolean) => void;
  formBusy: boolean;
  formError: string | null;
  marketingPolicy: MarketingPolicy | null;
  marketingOptIn: boolean;
  setMarketingOptIn: (value: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  _: (key: string) => string;
}

function EmailPasswordForm({
  email,
  setEmail,
  password,
  setPassword,
  isSignUp,
  setIsSignUp,
  formBusy,
  formError,
  marketingPolicy,
  marketingOptIn,
  setMarketingOptIn,
  onSubmit,
  _,
}: EmailFormProps) {
  return (
    <form onSubmit={onSubmit} className='flex w-64 flex-col gap-3'>
      <input
        type='email'
        required
        autoComplete='email'
        placeholder={_('Email address')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className='input input-bordered w-full text-sm'
      />
      {isSignUp && marketingPolicy && (
        <div className='border-base-300 bg-base-200/40 rounded border p-3'>
          {marketingPolicy.requiresExplicitOptIn ? (
            <label className='flex cursor-pointer items-start gap-3 text-xs leading-5'>
              <input
                type='checkbox'
                checked={marketingOptIn}
                onChange={(event) => setMarketingOptIn(event.target.checked)}
                className='checkbox checkbox-sm mt-0.5 shrink-0'
              />
              <span>{_(marketingPolicy.wording)}</span>
            </label>
          ) : (
            <p className='text-base-content/65 text-xs leading-5'>{_(marketingPolicy.wording)}</p>
          )}
        </div>
      )}
      <input
        type='password'
        required
        autoComplete={isSignUp ? 'new-password' : 'current-password'}
        placeholder={_('Password')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className='input input-bordered w-full text-sm'
      />
      {formError && <p className='text-error text-xs'>{formError}</p>}
      <button type='submit' disabled={formBusy} className='btn btn-primary btn-sm w-full'>
        {formBusy ? (
          <RiLoader2Line className='animate-spin' size={16} />
        ) : isSignUp ? (
          _('Sign up')
        ) : (
          _('Sign in')
        )}
      </button>
      <button
        type='button'
        onClick={() => setIsSignUp(!isSignUp)}
        className='text-base-content/50 text-xs underline'
      >
        {isSignUp ? _('Already have an account? Sign in') : _("Don't have an account? Sign up")}
      </button>
    </form>
  );
}
