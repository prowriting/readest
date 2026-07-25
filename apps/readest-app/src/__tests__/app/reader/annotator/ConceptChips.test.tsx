import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import ConceptChips from '@/app/reader/components/annotator/ConceptChips';
import { HIGHLIGHT_CONCEPTS } from '@/services/highlightConcepts';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

const renderChips = (
  props: Partial<{
    isVertical: boolean;
    triangleDir: 'up' | 'down' | 'left' | 'right';
    popupWidth: number;
    popupHeight: number;
    onSelectConcept: (id: string) => void;
  }> = {},
) =>
  render(
    <ConceptChips
      isVertical={props.isVertical ?? false}
      triangleDir={props.triangleDir ?? 'down'}
      popupWidth={props.popupWidth ?? 300}
      popupHeight={props.popupHeight ?? 44}
      onSelectConcept={props.onSelectConcept ?? (() => {})}
    />,
  );

afterEach(() => {
  cleanup();
});

// jsdom normalizes inline hex colors to rgb().
const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('ConceptChips', () => {
  it('renders one chip per concept with its translated label', () => {
    renderChips();
    for (const concept of HIGHLIGHT_CONCEPTS) {
      expect(screen.getByRole('button', { name: concept.label })).toBeTruthy();
    }
  });

  it('fires onSelectConcept with the concept id when a chip is tapped', () => {
    const onSelectConcept = vi.fn();
    renderChips({ onSelectConcept });

    fireEvent.click(screen.getByRole('button', { name: 'Useful' }));
    expect(onSelectConcept).toHaveBeenCalledWith('useful');

    fireEvent.click(screen.getByRole('button', { name: 'Feels slow' }));
    expect(onSelectConcept).toHaveBeenCalledWith('slow');
  });

  it('tints each chip with its concept color', () => {
    renderChips();
    for (const concept of HIGHLIGHT_CONCEPTS) {
      const chip = screen.getByRole('button', { name: concept.label }) as HTMLButtonElement;
      expect(chip.style.backgroundColor).toBe(hexToRgb(concept.hex));
    }
  });
});
