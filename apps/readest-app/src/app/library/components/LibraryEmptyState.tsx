import * as React from 'react';
import clsx from 'clsx';
import { PiBooks } from 'react-icons/pi';

import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { navigateToLogin, navigateToDiscover, navigateToClaim } from '@/utils/nav';

interface LibraryEmptyStateProps {
  onImport: () => void;
}

const LibraryEmptyState: React.FC<LibraryEmptyStateProps> = ({ onImport }) => {
  const _ = useTranslation();
  const { user } = useAuth();
  const router = useAppRouter();

  // The intro sentence weaves three inline actions into flowing text. Each
  // `[[token]]` in the (translatable) template is swapped for its button below.
  // i18next only interpolates `{{…}}`, so the `[[…]]` markers survive
  // translation and may be reordered per language.
  const links: Record<string, { label: string; onClick: () => void }> = {
    '[[import]]': { label: _('importing a book'), onClick: onImport },
    '[[discover]]': {
      label: _('discovering a book in our library'),
      onClick: () => navigateToDiscover(router),
    },
    '[[claim]]': { label: _('claim code'), onClick: () => navigateToClaim(router) },
  };
  const template = _(
    'You can start reading by [[import]], [[discover]], or using a [[claim]] an author sent you.',
  );

  return (
    <div className='hero-content text-neutral-content text-center'>
      <div className='flex max-w-md flex-col items-center'>
        <PiBooks aria-hidden className='text-base-content/80 mb-8 size-16' />
        <h1 className='mb-5 text-balance text-4xl font-semibold leading-tight tracking-tight'>
          {_('Start your library')}
        </h1>
        <p className='text-base-content/70 text-pretty text-lg leading-relaxed'>
          {template.split(/(\[\[import\]\]|\[\[discover\]\]|\[\[claim\]\])/).map((segment, i) => {
            const link = links[segment];
            return link ? (
              <button
                key={i}
                type='button'
                className={clsx(
                  'text-primary inline appearance-none underline underline-offset-2',
                  'hover:text-primary/80 focus-visible:text-primary/80 focus-visible:outline-none',
                )}
                onClick={link.onClick}
              >
                {link.label}
              </button>
            ) : (
              <React.Fragment key={i}>{segment}</React.Fragment>
            );
          })}
        </p>
        {!user && (
          <button
            type='button'
            className={clsx(
              'text-base-content/70 hover:text-base-content mt-12 py-2 text-sm font-medium',
              'underline underline-offset-4',
              'focus-visible:text-base-content focus-visible:outline-none',
            )}
            onClick={() => navigateToLogin(router)}
          >
            {_('Sign in to sync your library')}
          </button>
        )}
      </div>
    </div>
  );
};

export default LibraryEmptyState;
