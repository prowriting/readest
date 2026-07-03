import { describe, expect, it } from 'vitest';
import { getMediaOverlayHighlightCss } from '@/services/audiobook/highlightStyle';

describe('getMediaOverlayHighlightCss', () => {
  it('renders the highlight style as a translucent background', () => {
    const css = getMediaOverlayHighlightCss({ style: 'highlight', color: '#facc15' }, false);
    expect(css).toContain('.-epub-media-overlay-active');
    expect(css).toContain('background-color: rgba(250, 204, 21, 0.45)');
    expect(css).not.toContain('text-decoration');
  });

  it('renders the underline style with a solid color and no fill', () => {
    const css = getMediaOverlayHighlightCss({ style: 'underline', color: '#4ade80' }, false);
    expect(css).toContain('background-color: transparent');
    expect(css).toContain('text-decoration-line: underline');
    expect(css).toContain('text-decoration-color: #4ade80');
  });

  it('forces a currentColor underline on e-ink regardless of settings', () => {
    const css = getMediaOverlayHighlightCss({ style: 'highlight', color: '#facc15' }, true);
    expect(css).toContain('text-decoration-line: underline');
    expect(css).toContain('text-decoration-color: currentColor');
    expect(css).toContain('background-color: transparent');
  });

  it('falls back to the highlight style for unsupported style values', () => {
    const css = getMediaOverlayHighlightCss({ style: 'squiggly', color: '#60a5fa' }, false);
    expect(css).toContain('background-color: rgba(96, 165, 250, 0.45)');
  });
});
