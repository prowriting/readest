import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DwellAccumulator,
  MAX_DWELL_MS,
  getSectionCharRange,
} from '@/app/reader/hooks/useDwellTracking';

describe('DwellAccumulator', () => {
  it('returns empty dwells before any relocate', () => {
    const acc = new DwellAccumulator();
    expect(acc.flush()).toEqual([]);
  });

  it('records nothing on first relocate (no previous position)', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 100, 500, 'abc123', 1000);
    expect(acc.flush()).toEqual([]);
  });

  it('records a dwell on the second relocate with correct fields', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 100, 500, 'abc123', 1000);
    acc.onRelocate(1, 600, 900, 'abc123', 3000);

    const dwells = acc.flush();
    expect(dwells).toHaveLength(1);
    expect(dwells[0]).toMatchObject({
      bookHash: 'abc123',
      startSection: 0,
      startChar: 100,
      endSection: 0,
      endChar: 500,
      timeMilliseconds: 2000,
    });
    expect(dwells[0]!.id).toBeTruthy();
    expect(dwells[0]!.createdAt).toBeGreaterThan(0);
  });

  it('uses end char of previous page range, not start char of new page', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 100, 480, 'hash', 0); // page 1 visible: chars 100–480
    acc.onRelocate(0, 481, 900, 'hash', 2000); // page 2 starts at 481

    const dwells = acc.flush();
    expect(dwells).toHaveLength(1);
    expect(dwells[0]!.startChar).toBe(100);
    expect(dwells[0]!.endChar).toBe(480); // end of page 1, NOT 481 (start of page 2)
  });

  it('flush drains the accumulator', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 50, 'hash', 0);
    acc.onRelocate(0, 51, 100, 'hash', 2000);

    acc.flush();
    expect(acc.flush()).toEqual([]);
  });

  it('accumulates multiple dwells across multiple relocates', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onRelocate(0, 100, 199, 'hash', 5000);
    acc.onRelocate(1, 0, 149, 'hash', 9000);

    const dwells = acc.flush();
    expect(dwells).toHaveLength(2);
    expect(dwells[0]).toMatchObject({
      startSection: 0,
      startChar: 0,
      endSection: 0,
      endChar: 99,
      timeMilliseconds: 5000,
    });
    expect(dwells[1]).toMatchObject({
      startSection: 0,
      startChar: 100,
      endSection: 0,
      endChar: 199,
      timeMilliseconds: 4000,
    });
  });

  it('skips dwells shorter than 1000ms (instant page flips)', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onRelocate(0, 100, 199, 'hash', 500);

    expect(acc.flush()).toEqual([]);
  });

  it('includes dwells of exactly 1000ms', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onRelocate(0, 100, 199, 'hash', 1000);

    expect(acc.flush()).toHaveLength(1);
  });

  it('resets state after bookHash changes', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'book-a', 0);
    acc.onRelocate(0, 100, 199, 'book-b', 5000);

    expect(acc.flush()).toEqual([]);
  });

  it('each dwell gets a unique id', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onRelocate(0, 100, 199, 'hash', 2000);
    acc.onRelocate(0, 200, 299, 'hash', 4000);

    const dwells = acc.flush();
    expect(dwells).toHaveLength(2);
    expect(dwells[0]!.id).not.toBe(dwells[1]!.id);
  });

  // ── onBlur ────────────────────────────────────────────────────────────────

  it('onBlur records pending dwell with correct end char from page range', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 200, 'hash', 0);
    acc.onBlur(2000);

    const dwells = acc.flush();
    expect(dwells).toHaveLength(1);
    expect(dwells[0]).toMatchObject({
      startSection: 0,
      startChar: 0,
      endSection: 0,
      endChar: 200,
      timeMilliseconds: 2000,
    });
  });

  it('onBlur does not record if elapsed < 1000ms', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onBlur(500);

    expect(acc.flush()).toEqual([]);
  });

  it('onBlur does nothing when no pending dwell', () => {
    const acc = new DwellAccumulator();
    acc.onBlur(1000);

    expect(acc.flush()).toEqual([]);
  });

  it('onBlur clears timestamp so subsequent onRelocate treats as first', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onBlur(2000);
    acc.flush();

    acc.onRelocate(0, 100, 199, 'hash', 3000);
    expect(acc.flush()).toEqual([]);
  });

  it('double blur does not double-record', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onBlur(2000);
    acc.onBlur(3000);

    expect(acc.flush()).toHaveLength(1);
  });

  // ── onFocus ───────────────────────────────────────────────────────────────

  it('onFocus resets timestamp so next relocate only counts from focus time', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onBlur(2000);
    acc.flush();

    acc.onFocus(5000);
    acc.onRelocate(0, 100, 199, 'hash', 7000);

    const dwells = acc.flush();
    expect(dwells).toHaveLength(1);
    expect(dwells[0]!.timeMilliseconds).toBe(2000);
    expect(dwells[0]!.startChar).toBe(0);
    expect(dwells[0]!.endChar).toBe(99);
  });

  it('blur + focus + relocate: records only post-focus elapsed time', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onBlur(3000);
    acc.flush();

    acc.onFocus(10000);
    acc.onRelocate(0, 500, 999, 'hash', 12000);

    const dwells = acc.flush();
    expect(dwells).toHaveLength(1);
    expect(dwells[0]!.timeMilliseconds).toBe(2000);
    expect(dwells[0]!.startChar).toBe(0);
    expect(dwells[0]!.endChar).toBe(99);
  });

  // ── onTimeout ─────────────────────────────────────────────────────────────

  it('onTimeout records dwell capped at MAX_DWELL_MS with correct end char', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onTimeout(MAX_DWELL_MS);

    const dwells = acc.flush();
    expect(dwells).toHaveLength(1);
    expect(dwells[0]!.timeMilliseconds).toBe(MAX_DWELL_MS);
    expect(dwells[0]!.startChar).toBe(0);
    expect(dwells[0]!.endChar).toBe(99);
  });

  it('onTimeout resets timestamp so next relocate counts from timeout time', () => {
    const acc = new DwellAccumulator();
    acc.onRelocate(0, 0, 99, 'hash', 0);
    acc.onTimeout(MAX_DWELL_MS);
    acc.flush();

    acc.onRelocate(0, 100, 199, 'hash', MAX_DWELL_MS + 3000);

    const dwells = acc.flush();
    expect(dwells).toHaveLength(1);
    expect(dwells[0]!.timeMilliseconds).toBe(3000);
    expect(dwells[0]!.startChar).toBe(0);
    expect(dwells[0]!.endChar).toBe(99);
  });

  it('onTimeout does nothing when no pending dwell', () => {
    const acc = new DwellAccumulator();
    acc.onTimeout(5000);

    expect(acc.flush()).toEqual([]);
  });
});

// ── getSectionCharRange ───────────────────────────────────────────────────────

describe('getSectionCharRange', () => {
  it('returns { startChar: 0, endChar: 0 } when range has no ownerDocument', () => {
    const range = {
      startContainer: {},
      startOffset: 5,
      endContainer: {},
      endOffset: 5,
    } as unknown as Range;
    expect(getSectionCharRange(range)).toEqual({ startChar: 0, endChar: 0 });
  });

  it('returns correct values when start and end are in the same text node', () => {
    const div = document.createElement('div');
    div.textContent = 'hello world';
    document.body.appendChild(div);

    const textNode = div.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.setEnd(textNode, 8);

    expect(getSectionCharRange(range)).toEqual({ startChar: 2, endChar: 8 });
    document.body.removeChild(div);
  });

  it('returns startChar 0 for range starting at beginning of first text node', () => {
    const div = document.createElement('div');
    div.textContent = 'hello';
    document.body.appendChild(div);

    const textNode = div.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    expect(getSectionCharRange(range)).toEqual({ startChar: 0, endChar: 5 });
    document.body.removeChild(div);
  });

  it('counts characters across multiple text nodes', () => {
    const div = document.createElement('div');
    const span1 = document.createElement('span');
    span1.textContent = 'hello '; // 6 chars (indices 0–5)
    const span2 = document.createElement('span');
    span2.textContent = 'world'; // 5 chars (indices 6–10)
    div.appendChild(span1);
    div.appendChild(span2);
    document.body.appendChild(div);

    const textNode1 = span1.firstChild as Text;
    const textNode2 = span2.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode1, 2); // startChar = 2
    range.setEnd(textNode2, 3); // endChar = 6 + 3 = 9

    expect(getSectionCharRange(range)).toEqual({ startChar: 2, endChar: 9 });
    document.body.removeChild(div);
  });
});

// ── MAX_DWELL_MS export ───────────────────────────────────────────────────────

describe('MAX_DWELL_MS', () => {
  it('is a positive number', () => {
    expect(MAX_DWELL_MS).toBeGreaterThan(0);
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe('DwellAccumulator with media-overlay playback relocates', () => {
  it('attributes listening time to the sentence just played, across section hops', () => {
    const acc = new DwellAccumulator();
    const t0 = 1_751_500_000_000;
    // Playback highlights relocate every ~1.5s within section 0...
    acc.onRelocate(0, 0, 90, 'hash', t0);
    acc.onRelocate(0, 90, 180, 'hash', t0 + 1500);
    // ...then auto-advance hops to section 1.
    acc.onRelocate(1, 0, 90, 'hash', t0 + 3000);
    const dwells = acc.flush();
    expect(dwells).toHaveLength(2);
    expect(dwells[0]).toMatchObject({
      startSection: 0,
      startChar: 0,
      endChar: 90,
      timeMilliseconds: 1500,
    });
    expect(dwells[1]).toMatchObject({
      startSection: 0,
      startChar: 90,
      endChar: 180,
      timeMilliseconds: 1500,
    });
    expect(dwells.reduce((sum, d) => sum + d.timeMilliseconds, 0)).toBe(3000);
  });
});
