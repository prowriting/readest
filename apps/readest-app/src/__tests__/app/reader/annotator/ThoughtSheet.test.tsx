import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

// Replace Dialog with a thin shell so the sheet's internals are testable
// without dragging in theme/device/responsive/haptics dependencies.
vi.mock('@/components/Dialog', () => ({
  default: ({
    children,
    header,
    isOpen,
    onClose,
  }: {
    children: ReactNode;
    header?: ReactNode;
    isOpen: boolean;
    onClose: () => void;
    snapHeight?: number;
    contentClassName?: string;
    dismissible?: boolean;
  }) =>
    isOpen ? (
      <div role='dialog' data-testid='dialog'>
        <div data-testid='dialog-header'>{header}</div>
        <div data-testid='dialog-body'>{children}</div>
        <button data-testid='dialog-overlay-close' onClick={onClose} aria-label='backdrop' />
      </div>
    ) : null,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

import ThoughtSheet from '@/app/reader/components/annotator/ThoughtSheet';
import { HIGHLIGHT_CONCEPTS, getHighlightConcept } from '@/services/highlightConcepts';

const thought = getHighlightConcept('thought')!;

const renderSheet = (
  props: Partial<{
    concept: (typeof HIGHLIGHT_CONCEPTS)[number];
    excerpt: string;
    initialNote: string;
    onSave: (text: string) => void;
    onDismiss: () => void;
  }> = {},
) =>
  render(
    <ThoughtSheet
      concept={props.concept ?? thought}
      excerpt={props.excerpt ?? 'with their big cow-boy hats'}
      initialNote={props.initialNote ?? ''}
      onSave={props.onSave ?? (() => {})}
      onDismiss={props.onDismiss ?? (() => {})}
    />,
  );

afterEach(() => {
  cleanup();
});

describe('ThoughtSheet', () => {
  it('shows the concept label in the header and the quoted excerpt', () => {
    renderSheet();
    expect(screen.getByTestId('dialog-header').textContent).toContain('Thought');
    expect(screen.getByText(/with their big cow-boy hats/)).toBeTruthy();
  });

  it('shows the saved-to-notes hint', () => {
    renderSheet();
    expect(screen.getByText('Saved to your notes')).toBeTruthy();
  });

  it('saves the typed text', () => {
    const onSave = vi.fn();
    renderSheet({ onSave });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Funny how Stoker dresses them like the American frontier' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('Funny how Stoker dresses them like the American frontier');
  });

  it('pre-fills the textarea from initialNote', () => {
    renderSheet({ initialNote: 'existing thought' });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('existing thought');
  });

  it('cancel dismisses without saving', () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    renderSheet({ onSave, onDismiss });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('tints the save button with the concept color', () => {
    renderSheet();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const n = parseInt(thought.hex.slice(1), 16);
    // jsdom normalizes inline hex colors to rgb().
    expect(save.style.backgroundColor).toBe(
      `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`,
    );
  });
});
