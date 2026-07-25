/**
 * Visual regression test for the AnnotationPopup component.
 *
 * Renders the *real* AnnotationPopup + ConceptChips with actual
 * annotationToolButtons and HIGHLIGHT_CONCEPTS. Tailwind CSS is loaded so
 * the screenshot matches the live app.
 *
 * Guards the chips-row layout: the concept chips float above the toolbar
 * without overlapping it, and every concept renders as a labeled chip.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';

// ── Tailwind / DaisyUI styles ───────────────────────────────────────────
import '@/styles/globals.css';

// ── Mocks (must be before component imports) ────────────────────────────

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

// ── Real component imports ──────────────────────────────────────────────

import AnnotationPopup from '@/app/reader/components/annotator/AnnotationPopup';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import { CONCEPT_CHIPS_HEIGHT_PIX } from '@/app/reader/components/annotator/ConceptChips';
import { HIGHLIGHT_CONCEPTS } from '@/services/highlightConcepts';

// ── Constants ───────────────────────────────────────────────────────────

const POPUP_W = 300;
const POPUP_H = 44;

// Concept chips float above the popup by (chips height + 8px padding).
const CHIPS_OFFSET = CONCEPT_CHIPS_HEIGHT_PIX + 8;

// Position the popup so both it and the floating chips are visible:
//   y=0..CHIPS_OFFSET: concept chips block
//   y=CHIPS_OFFSET..CHIPS_OFFSET+POPUP_H: toolbar
const POPUP_Y = CHIPS_OFFSET;
const POPUP_X = 0;
const WRAPPER_H = POPUP_Y + POPUP_H + 14; // +14 for triangle below

const toolButtons = annotationToolButtons.map(({ label, Icon }) => ({
  tooltipText: label,
  Icon,
  onClick: vi.fn(),
}));

// Browser-mode matcher types are unavailable to tsgo; cast once here.
const expectElement = (locator: unknown) =>
  // @ts-expect-error -- expect.element() exists in vitest browser mode
  expect.element(locator) as { toMatchScreenshot: (name: string) => Promise<void> };

/**
 * Fixed-size wrapper that contains both the popup and the absolutely
 * positioned concept-chips block above it, matching the real app where
 * the triangle points up and the chips float above.
 */
const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    data-theme='dark'
    style={{
      position: 'relative',
      width: POPUP_W,
      height: WRAPPER_H,
      overflow: 'visible',
    }}
  >
    {children}
  </div>
);

const renderPopup = (dir: 'up' | 'down' = 'up') => {
  // 'up': triangle points up, popup sits below the selection, chips float
  // above it. 'down': the reverse — chips float below the toolbar (the case
  // that previously rendered with an oversized gap).
  const popupY = dir === 'up' ? POPUP_Y : 0;
  const triangleY = dir === 'up' ? popupY + POPUP_H : popupY;
  return render(
    <Wrapper>
      <AnnotationPopup
        bookKey='test'
        dir='ltr'
        isVertical={false}
        buttons={toolButtons}
        notes={[]}
        position={{ dir, point: { x: POPUP_X, y: popupY } }}
        trianglePosition={{ dir, point: { x: POPUP_X + POPUP_W / 2, y: triangleY } }}
        highlightOptionsVisible
        popupWidth={POPUP_W}
        popupHeight={POPUP_H}
        onSelectConcept={vi.fn()}
        onDismiss={vi.fn()}
      />
    </Wrapper>,
  );
};

// ── Lifecycle ───────────────────────────────────────────────────────────

beforeAll(async () => {
  await page.viewport(800, 600);
});

afterEach(() => {
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('AnnotationPopup layout', () => {
  it('renders every concept as a labeled chip', () => {
    const { container } = renderPopup();
    for (const concept of HIGHLIGHT_CONCEPTS) {
      const chip = Array.from(container.querySelectorAll('.concept-chips button')).find(
        (b) => b.textContent === concept.label,
      );
      expect(chip, `chip for ${concept.id}`).toBeTruthy();
    }
  });

  it('chips fit their block and do not overlap the toolbar', () => {
    const { container } = renderPopup();
    const chipsBlock = container.querySelector('.concept-chips') as HTMLElement;
    const toolbar = container.querySelector('.selection-buttons') as HTMLElement;
    const chipsRect = chipsBlock.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();

    // Chips block floats fully above the toolbar row.
    expect(chipsRect.bottom).toBeLessThanOrEqual(toolbarRect.top);

    // Every chip is fully inside the chips block (no overflow of the
    // two-row layout at the 300px popup width).
    for (const chip of Array.from(chipsBlock.querySelectorAll('button'))) {
      const rect = chip.getBoundingClientRect();
      expect(rect.top).toBeGreaterThanOrEqual(chipsRect.top);
      expect(rect.bottom).toBeLessThanOrEqual(chipsRect.bottom);
      expect(rect.left).toBeGreaterThanOrEqual(chipsRect.left);
      expect(rect.right).toBeLessThanOrEqual(chipsRect.right);
    }
  });

  it('sits directly below the toolbar (small gap) when the popup opens downward', () => {
    const { container } = renderPopup('down');
    const chipsBlock = container.querySelector('.concept-chips') as HTMLElement;
    const toolbar = container.querySelector('.selection-buttons') as HTMLElement;
    const gap = chipsBlock.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom;

    // The chips clear the toolbar (no overlap) but hug it — the gap is the
    // small padding, not the block's full height as in the earlier bug.
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(20);
  });

  it('concept chips — screenshot', async () => {
    const { container } = renderPopup();
    const wrapper = container.firstElementChild as HTMLElement;
    await expectElement(page.elementLocator(wrapper)).toMatchScreenshot(
      'annotation-popup-concept-chips',
    );
  });
});
