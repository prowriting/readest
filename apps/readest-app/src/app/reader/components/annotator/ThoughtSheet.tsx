'use client';

import React, { useEffect, useRef, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { HighlightConcept } from '@/services/highlightConcepts';

interface ThoughtSheetProps {
  concept: HighlightConcept;
  excerpt: string;
  initialNote: string;
  onSave: (text: string) => void;
  onDismiss: () => void;
}

const ThoughtSheet: React.FC<ThoughtSheetProps> = ({
  concept,
  excerpt,
  initialNote,
  onSave,
  onDismiss,
}) => {
  const _ = useTranslation();
  const [text, setText] = useState(initialNote);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { Icon } = concept;

  useEffect(() => {
    // Dialog steals focus onto itself ~100ms after opening; refocus the
    // textarea after that so the keyboard comes up ready to type.
    const timer = setTimeout(() => textareaRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Dialog
      id='thought-sheet'
      isOpen
      snapHeight={0.5}
      title={_(concept.label)}
      boxClassName='sm:h-auto sm:w-full sm:max-w-[440px]'
      header={
        <div className='flex h-11 w-full items-center gap-2 px-2'>
          <span
            className='eink-bordered flex h-8 w-8 items-center justify-center rounded-lg text-gray-900'
            style={{ backgroundColor: concept.hex }}
          >
            <Icon size={16} aria-hidden />
          </span>
          <span className='font-bold'>{_(concept.label)}</span>
          <button
            type='button'
            aria-label={_('Close')}
            onClick={onDismiss}
            className='btn btn-ghost btn-circle ml-auto h-8 min-h-8 w-8 focus:outline-none'
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-hidden
            >
              <line x1='18' y1='6' x2='6' y2='18' />
              <line x1='6' y1='6' x2='18' y2='18' />
            </svg>
          </button>
        </div>
      }
      onClose={onDismiss}
    >
      <div className='flex flex-col gap-3 px-4 pb-4'>
        <blockquote
          className='border-s-4 ps-3 text-sm italic opacity-80'
          style={{ borderColor: concept.hex }}
        >
          &ldquo;{excerpt}&rdquo;
        </blockquote>
        <textarea
          ref={textareaRef}
          value={text}
          rows={3}
          placeholder={_('Add your thought')}
          onChange={(e) => setText(e.target.value)}
          className='textarea eink-bordered w-full resize-none rounded-xl text-base focus:outline-none'
          style={{ borderColor: concept.hex }}
        />
        <div className='flex items-center gap-2'>
          <span className='text-base-content/60 me-auto text-xs'>{_('Saved to your notes')}</span>
          <button
            type='button'
            onClick={onDismiss}
            className='btn btn-ghost eink-bordered h-9 min-h-9 rounded-full px-4'
          >
            {_('Cancel')}
          </button>
          <button
            type='button'
            onClick={() => onSave(text)}
            className='btn btn-primary h-9 min-h-9 rounded-full border-none px-5 text-gray-900'
            style={{ backgroundColor: concept.hex }}
          >
            {_('Save')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default ThoughtSheet;
