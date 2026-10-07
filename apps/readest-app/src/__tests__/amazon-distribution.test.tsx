import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccountActions from '@/app/user/components/AccountActions';
import SuccessPage from '@/app/user/subscription/success/page';
import { createStripePortalSession } from '@/libs/payment/stripe/client';

const { replace } = vi.hoisted(() => ({
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
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
  it('blocks the billing portal before contacting Stripe', async () => {
    await expect(createStripePortalSession()).rejects.toThrow(/Amazon/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps account and sync actions without exposing legacy subscription management', () => {
    render(
      <AccountActions
        userPlan='plus'
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
