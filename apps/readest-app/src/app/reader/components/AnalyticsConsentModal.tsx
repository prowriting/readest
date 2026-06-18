import React from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';

interface AnalyticsConsentModalProps {
  onAllow: () => void;
  onDecline: () => void;
}

const AnalyticsConsentModal: React.FC<AnalyticsConsentModalProps> = ({ onAllow, onDecline }) => {
  const _ = useTranslation();

  return (
    <Dialog isOpen={true} onClose={onDecline} title={_('Reading Analytics')}>
      <p className='text-base-content/80 mb-6 mt-1 px-1 text-center text-sm leading-relaxed'>
        {_(
          'The author of this book would like access to your statistics about your reading progress on this book as well as your annotations. This will help them to improve the book. Are you happy to provide them with statistics and the contents of your annotations?',
        )}
      </p>
      <div className='flex flex-col gap-2.5'>
        <button
          type='button'
          onClick={onAllow}
          className='btn-primary eink-bordered w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors duration-150'
        >
          {_('Allow')}
        </button>
        <button
          type='button'
          onClick={onDecline}
          className='eink-bordered hover:bg-base-200/60 active:bg-base-200/80 w-full rounded-xl border px-4 py-3 text-sm transition-colors duration-150'
        >
          {_('Decline')}
        </button>
      </div>
    </Dialog>
  );
};

export default AnalyticsConsentModal;
