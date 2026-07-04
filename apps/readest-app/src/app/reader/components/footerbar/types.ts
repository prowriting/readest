import type { BookFormat, PageInfo } from '@/types/book';
import { Insets } from '@/types/misc';

export interface FooterBarProps {
  bookKey: string;
  bookFormat: BookFormat;
  section?: PageInfo;
  pageinfo?: PageInfo;
  isHoveredAnim: boolean;
  gridInsets: Insets;
  /** Used by the audiobook fullscreen player, which covers the header bar. */
  onGoToLibrary: () => void;
}

export interface NavigationHandlers {
  onPrevPage: () => void;
  onNextPage: () => void;
  onPrevSection: () => void;
  onNextSection: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onProgressChange: (value: number) => void;
}

export interface FooterBarChildProps {
  bookKey: string;
  navigationHandlers: NavigationHandlers;
  progressFraction: number;
  progressValid: boolean;
  gridInsets: Insets;
  actionTab: string;
  forceMobileLayout: boolean;
  onSetActionTab: (tab: string) => void;
  onSpeakText: () => void;
}
