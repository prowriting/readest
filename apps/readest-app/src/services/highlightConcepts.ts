import { IconType } from 'react-icons';
import { FiHeart } from 'react-icons/fi';
import { IoChatbubbleOutline } from 'react-icons/io5';
import { LuSquareCheck } from 'react-icons/lu';
import { TbMoodNeutral, TbSpiral } from 'react-icons/tb';
import { stubTranslation as _ } from '@/utils/misc';
import { HIGHLIGHT_COLOR_HEX } from './constants';

// Register concept labels for i18n extraction (key-as-content pattern).
void [_('Useful'), _('Love this'), _('Thought'), _('Feels slow'), _('Confusing')];

export interface HighlightConcept {
  /** Stored in BookNote.color, alongside the legacy named colors. */
  id: string;
  /** Untranslated label; pass through `_()` at render time. */
  label: string;
  hex: string;
  Icon: IconType;
  /**
   * When true, tapping this concept opens the thought-entry sheet after
   * applying the highlight. Only `thought` captures a written note; the
   * other concepts apply the colored highlight and dismiss immediately.
   */
  promptsForNote?: boolean;
}

export const HIGHLIGHT_CONCEPTS: readonly HighlightConcept[] = [
  { id: 'useful', label: 'Useful', hex: HIGHLIGHT_COLOR_HEX['useful']!, Icon: LuSquareCheck },
  { id: 'love', label: 'Love this', hex: HIGHLIGHT_COLOR_HEX['love']!, Icon: FiHeart },
  {
    id: 'thought',
    label: 'Thought',
    hex: HIGHLIGHT_COLOR_HEX['thought']!,
    Icon: IoChatbubbleOutline,
    promptsForNote: true,
  },
  { id: 'slow', label: 'Feels slow', hex: HIGHLIGHT_COLOR_HEX['slow']!, Icon: TbMoodNeutral },
  { id: 'confusing', label: 'Confusing', hex: HIGHLIGHT_COLOR_HEX['confusing']!, Icon: TbSpiral },
];

export const getHighlightConcept = (id?: string): HighlightConcept | undefined =>
  id ? HIGHLIGHT_CONCEPTS.find((concept) => concept.id === id) : undefined;
