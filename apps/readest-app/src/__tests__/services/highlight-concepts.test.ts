import { describe, it, expect } from 'vitest';
import { HIGHLIGHT_CONCEPTS, getHighlightConcept } from '@/services/highlightConcepts';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import { DEFAULT_HIGHLIGHT_COLORS } from '@/types/book';

describe('HIGHLIGHT_CONCEPTS', () => {
  it('defines the five fixed concepts in display order', () => {
    expect(HIGHLIGHT_CONCEPTS.map((c) => c.id)).toEqual([
      'useful',
      'love',
      'thought',
      'slow',
      'confusing',
    ]);
  });

  it('has a label, hex, and icon for every concept', () => {
    for (const concept of HIGHLIGHT_CONCEPTS) {
      expect(concept.label.length).toBeGreaterThan(0);
      expect(concept.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(concept.Icon).toBeTruthy();
    }
  });

  it('does not collide with the legacy named colors', () => {
    for (const concept of HIGHLIGHT_CONCEPTS) {
      expect(DEFAULT_HIGHLIGHT_COLORS as readonly string[]).not.toContain(concept.id);
    }
  });

  it('prompts for a written note only on the thought concept', () => {
    const prompting = HIGHLIGHT_CONCEPTS.filter((c) => c.promptsForNote).map((c) => c.id);
    expect(prompting).toEqual(['thought']);
  });

  it('registers every concept hex in HIGHLIGHT_COLOR_HEX so legacy rendering resolves it', () => {
    for (const concept of HIGHLIGHT_CONCEPTS) {
      expect(HIGHLIGHT_COLOR_HEX[concept.id]).toBe(concept.hex);
    }
  });
});

describe('getHighlightConcept', () => {
  it('returns the concept for a known id', () => {
    expect(getHighlightConcept('thought')?.label).toBe('Thought');
  });

  it('returns undefined for legacy colors and unknown values', () => {
    expect(getHighlightConcept('yellow')).toBeUndefined();
    expect(getHighlightConcept('#123456')).toBeUndefined();
    expect(getHighlightConcept(undefined)).toBeUndefined();
  });
});
