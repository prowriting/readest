'use client';

import clsx from 'clsx';
import { useState } from 'react';

import { getProxiedURL, needsProxy } from '@/app/opds/utils/opdsReq';

interface CatalogCoverProps {
  coverUrl?: string | null;
  title: string;
  className?: string;
}

/**
 * Cover image for a remote catalog book. Catalog covers are arbitrary external
 * URLs (e.g. gutenberg.org), so this uses a plain <img> and degrades to a
 * title-only fallback when the image is missing or fails to load.
 */
const CatalogCover: React.FC<CatalogCoverProps> = ({ coverUrl, title, className }) => {
  const [failed, setFailed] = useState(false);

  if (!coverUrl || failed) {
    return (
      <div
        className={clsx(
          'bg-base-300 text-neutral-content flex h-full w-full items-center justify-center p-1.5 text-center',
          className,
        )}
      >
        <span className='line-clamp-3 text-[10px] font-medium'>{title}</span>
      </div>
    );
  }

  // The app runs under COEP `require-corp`, which blocks cross-origin images that
  // lack CORP headers (e.g. gutenberg.org covers). On web, route them through the
  // same-origin OPDS proxy so they load; on Tauri the URL is used directly.
  const src = needsProxy(coverUrl) ? getProxiedURL(coverUrl, '', true) : coverUrl;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={title}
      loading='lazy'
      draggable={false}
      onError={() => setFailed(true)}
      className={clsx('h-full w-full object-cover', className)}
    />
  );
};

export default CatalogCover;
