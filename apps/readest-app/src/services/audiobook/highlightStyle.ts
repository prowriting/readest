import tinycolor from 'tinycolor2';
import type { TTSHighlightOptions } from '@/services/tts';

const HIGHLIGHT_ALPHA = 0.45;

/**
 * CSS injected into book section documents for the EPUB3 Media Overlay
 * read-along highlight. The class name comes from the package's
 * media:active-class metadata; foliate-js applies it to the element whose
 * SMIL clip is playing.
 *
 * E-ink panels have no color and ghost on fills, so they always get a crisp
 * currentColor underline regardless of the configured style.
 */
export const getMediaOverlayHighlightCss = (
  options: TTSHighlightOptions,
  isEink: boolean,
): string => {
  if (isEink) {
    return `
    .-epub-media-overlay-active {
      background-color: transparent;
      text-decoration-line: underline;
      text-decoration-color: currentColor;
      text-decoration-thickness: 2px;
    }
  `;
  }
  if (options.style === 'underline') {
    return `
    .-epub-media-overlay-active {
      background-color: transparent;
      text-decoration-line: underline;
      text-decoration-color: ${options.color};
      text-decoration-thickness: 2px;
    }
  `;
  }
  const background = tinycolor(options.color).setAlpha(HIGHLIGHT_ALPHA).toRgbString();
  return `
    .-epub-media-overlay-active {
      background-color: ${background};
      border-radius: 2px;
    }
  `;
};
