import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LegalLinks from '@/components/LegalLinks';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isIOSApp: true, isMacOSApp: false } }),
}));

afterEach(() => {
  cleanup();
});

describe('LegalLinks', () => {
  it('links to the BookArc Reader terms and privacy policy on every platform', () => {
    render(<LegalLinks />);

    expect(screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe(
      'https://bookarc.app/reader-terms',
    );
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe(
      'https://bookarc.app/reader-privacy',
    );
  });
});
