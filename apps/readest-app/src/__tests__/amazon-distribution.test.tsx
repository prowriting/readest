import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { useAvailablePlans } from '@/hooks/useAvailablePlans';
import AccountActions from '@/app/user/components/AccountActions';
import SuccessPage from '@/app/user/subscription/success/page';
import {
  createStripeCheckoutSession,
  createStripePortalSession,
  fetchStripePlans,
  getStripe,
} from '@/libs/payment/stripe/client';

const { replace, loadStripe, isAvailable } = vi.hoisted(() => ({
  replace: vi.fn(),
  loadStripe: vi.fn(),
  isAvailable: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe }));
vi.mock('@/utils/iap', () => ({ IAPService: { isAvailable } }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { hasIAP: false } }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_DIST_CHANNEL', 'amazon');
  vi.stubGlobal('fetch', vi.fn());
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('free Amazon distribution', () => {
  it('does not look up IAP or fall back to Stripe on the profile screen', () => {
    const { result } = renderHook(() => useAvailablePlans({ hasIAP: false }));
    expect(result.current.availablePlans).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(isAvailable).not.toHaveBeenCalled();
  });

  it('blocks the payment client before contacting Stripe or looking up credentials', async () => {
    expect(await fetchStripePlans()).toEqual([]);
    expect(await getStripe()).toBeNull();
    await expect(createStripeCheckoutSession('legacy-product')).rejects.toThrow(/Amazon/);
    await expect(createStripePortalSession()).rejects.toThrow(/Amazon/);
    expect(fetch).not.toHaveBeenCalled();
    expect(loadStripe).not.toHaveBeenCalled();
  });

  it('keeps account and sync actions without exposing legacy subscription management', () => {
    render(
      <AccountActions
        userPlan='plus'
        iapAvailable={false}
        onLogout={vi.fn()}
        onResetPassword={vi.fn()}
        onUpdateEmail={vi.fn()}
        onConfirmDelete={vi.fn()}
        onManageSync={vi.fn()}
        onManageSubscription={vi.fn()}
      />,
    );
    expect(screen.queryByText('Manage Subscription')).toBeNull();
    expect(screen.queryByText('Restore Purchase')).toBeNull();
    expect(screen.getByText('Reset Password')).toBeTruthy();
    expect(screen.getByText('Delete Account')).toBeTruthy();
    expect(screen.getByText('Manage Sync')).toBeTruthy();
  });

  it('returns direct payment links to the profile without verifying payments', () => {
    const { container } = render(<SuccessPage />);
    expect(replace).toHaveBeenCalledWith('/user');
    expect(container.textContent).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });
});
