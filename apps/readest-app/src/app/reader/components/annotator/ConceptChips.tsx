import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { HIGHLIGHT_CONCEPTS } from '@/services/highlightConcepts';

interface ConceptChipsProps {
  isVertical: boolean;
  popupWidth: number;
  popupHeight: number;
  triangleDir: 'up' | 'down' | 'left' | 'right';
  onSelectConcept: (id: string) => void;
}

// Two wrapped rows of chips (three + two) at the 300px popup width.
export const CONCEPT_CHIPS_HEIGHT_PIX = 84;
// Column of five chips beside the popup in vertical writing mode.
export const CONCEPT_CHIPS_WIDTH_PIX = 132;
const CHIPS_PADDING_PIX = 8;

const ConceptChips: React.FC<ConceptChipsProps> = ({
  isVertical,
  popupWidth,
  popupHeight,
  triangleDir,
  onSelectConcept,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(14);
  const chipsHeightPx = useResponsiveSize(CONCEPT_CHIPS_HEIGHT_PIX);
  const chipsWidthPx = useResponsiveSize(CONCEPT_CHIPS_WIDTH_PIX);
  const chipsPaddingPx = useResponsiveSize(CHIPS_PADDING_PIX);

  return (
    <div
      className={clsx(
        'concept-chips not-eink:bg-gray-700 eink-bordered absolute flex items-center justify-center',
        'gap-1.5 rounded-2xl p-2',
        isVertical ? 'flex-col' : 'flex-row flex-wrap',
      )}
      style={{
        // Offsets are asymmetric: to sit past the toolbar we only need to
        // clear the popup's own thickness (popupHeight/popupWidth), but to
        // sit before it we must shift by the chips block's full extent so
        // its trailing edge lands just short of the toolbar.
        ...(isVertical
          ? {
              width: `${chipsWidthPx}px`,
              height: `${popupHeight}px`,
              left:
                triangleDir === 'left'
                  ? `${-(chipsWidthPx + chipsPaddingPx)}px`
                  : `${popupWidth + chipsPaddingPx}px`,
            }
          : {
              width: `${popupWidth}px`,
              height: `${chipsHeightPx}px`,
              top:
                triangleDir === 'up'
                  ? `${-(chipsHeightPx + chipsPaddingPx)}px`
                  : `${popupHeight + chipsPaddingPx}px`,
            }),
      }}
    >
      {HIGHLIGHT_CONCEPTS.map(({ id, label, hex, Icon }) => (
        <button
          key={id}
          type='button'
          onClick={() => onSelectConcept(id)}
          className='eink-bordered flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-900'
          style={{ backgroundColor: hex }}
        >
          <Icon size={iconSize} aria-hidden />
          <span className='whitespace-nowrap'>{_(label)}</span>
        </button>
      ))}
    </div>
  );
};

export default ConceptChips;
