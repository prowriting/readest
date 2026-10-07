import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccountActions from '@/app/user/components/AccountActions';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasIAP: true } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

const baseProps = {
  onLogout: vi.fn(),
  onResetPassword: vi.fn(),
  onUpdateEmail: vi.fn(),
  onConfirmDelete: vi.fn(),
  onManageSubscription: vi.fn(),
};

describe('AccountActions', () => {
  it('never offers purchase restoration, even where the platform has IAP', () => {
    render(<AccountActions userPlan='free' {...baseProps} />);
    expect(screen.queryByText('Restore Purchase')).toBeNull();
    expect(screen.queryByText('Manage Subscription')).toBeNull();
    expect(screen.getByText('Delete Account')).toBeTruthy();
    expect(screen.getByText('Sign Out')).toBeTruthy();
  });

  it('still lets an existing paid user reach subscription management', () => {
    render(<AccountActions userPlan='plus' {...baseProps} />);
    expect(screen.getByText('Manage Subscription')).toBeTruthy();
    expect(screen.queryByText('Restore Purchase')).toBeNull();
  });
});
