import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/opds/utils/opdsReq', () => ({
  needsProxy: vi.fn(() => true),
  getProxiedURL: () => 'https://reader.bookarc.app/api/opds/proxy?url=cover',
}));

import CatalogCover from '@/app/discover/components/CatalogCover';
import { needsProxy } from '@/app/opds/utils/opdsReq';

const cover = 'https://www.gutenberg.org/cache/epub/2701/pg2701.cover.medium.jpg';

afterEach(() => {
  cleanup();
  vi.mocked(needsProxy).mockReturnValue(true);
});

describe('CatalogCover', () => {
  it('loads web covers through the same-origin proxy without API authentication', () => {
    render(<CatalogCover coverUrl={cover} title='Moby Dick' />);
    const src = screen.getByRole('img').getAttribute('src');
    expect(src).toBe(`/api/opds/proxy?${new URLSearchParams({ url: cover, stream: 'true' })}`);
  });

  it('uses the original cover URL on native platforms', () => {
    vi.mocked(needsProxy).mockReturnValue(false);
    render(<CatalogCover coverUrl={cover} title='Moby Dick' />);
    expect(screen.getByRole('img').getAttribute('src')).toBe(cover);
  });
});
