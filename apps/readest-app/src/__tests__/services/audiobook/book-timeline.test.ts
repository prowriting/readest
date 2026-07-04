import { describe, expect, it } from 'vitest';
import {
  buildBookTimeline,
  formatPlaybackTime,
  formatTimeLeft,
} from '@/services/audiobook/bookTimeline';

describe('buildBookTimeline', () => {
  // The e2e fixture shape: three overlay chapters of 12s, 12s, 6s.
  const timeline = buildBookTimeline([12, 12, 6]);

  it('accumulates section starts and the total duration', () => {
    expect(timeline.total).toBe(30);
    expect(timeline.isComplete).toBe(true);
    expect(timeline.elapsed(0, 0)).toBe(0);
    expect(timeline.elapsed(1, 1)).toBe(13);
    expect(timeline.elapsed(2, 5.5)).toBe(29.5);
  });

  it('locates a global time inside the right section', () => {
    expect(timeline.locate(0)).toEqual({ sectionIndex: 0, offset: 0 });
    expect(timeline.locate(13)).toEqual({ sectionIndex: 1, offset: 1 });
    expect(timeline.locate(24.5)).toEqual({ sectionIndex: 2, offset: 0.5 });
  });

  it('clamps out-of-range times into the book', () => {
    expect(timeline.locate(-5)).toEqual({ sectionIndex: 0, offset: 0 });
    const end = timeline.locate(1000);
    expect(end.sectionIndex).toBe(2);
    expect(end.offset).toBeLessThan(6);
    expect(end.offset).toBeGreaterThan(5);
  });

  it('skips sections without audio when locating', () => {
    // A plain-text section (0s) between two audio chapters.
    const gappy = buildBookTimeline([12, 0, 6]);
    expect(gappy.total).toBe(18);
    expect(gappy.locate(12.5)).toEqual({ sectionIndex: 2, offset: 0.5 });
    expect(gappy.elapsed(2, 0.5)).toBe(12.5);
  });

  it('marks the timeline incomplete when any overlay duration is unknown', () => {
    const partial = buildBookTimeline([12, null, 6]);
    expect(partial.isComplete).toBe(false);
    expect(partial.total).toBe(18); // known durations still add up
    // Elapsed stays monotonic with unknowns contributing zero.
    expect(partial.elapsed(2, 1)).toBe(13);
  });

  it('handles an empty book', () => {
    const empty = buildBookTimeline([]);
    expect(empty.total).toBe(0);
    expect(empty.isComplete).toBe(true);
    expect(empty.locate(3)).toEqual({ sectionIndex: 0, offset: 0 });
  });
});

describe('formatPlaybackTime', () => {
  it('formats sub-hour times as m:ss', () => {
    expect(formatPlaybackTime(0)).toBe('0:00');
    expect(formatPlaybackTime(13)).toBe('0:13');
    expect(formatPlaybackTime(75.6)).toBe('1:15');
    expect(formatPlaybackTime(600)).toBe('10:00');
  });

  it('formats hour-plus times as h:mm:ss', () => {
    expect(formatPlaybackTime(3600)).toBe('1:00:00');
    expect(formatPlaybackTime(3600 + 90)).toBe('1:01:30');
  });

  it('never renders negative or NaN input', () => {
    expect(formatPlaybackTime(-3)).toBe('0:00');
    expect(formatPlaybackTime(Number.NaN)).toBe('0:00');
  });
});

describe('sectionDuration', () => {
  it('returns the known duration of a section and 0 for unknown/absent ones', () => {
    const timeline = buildBookTimeline([12, null, 6, 0]);
    expect(timeline.sectionDuration(0)).toBe(12);
    expect(timeline.sectionDuration(1)).toBe(0);
    expect(timeline.sectionDuration(2)).toBe(6);
    expect(timeline.sectionDuration(3)).toBe(0);
    expect(timeline.sectionDuration(99)).toBe(0);
  });
});

// PRD §5.1 mock: the line above the scrubber reads like "23m left" — hours
// and minutes for long books, bare minutes in the mid-range, seconds only
// below a minute.
describe('formatTimeLeft', () => {
  it('formats hours, minutes, and seconds ranges', () => {
    expect(formatTimeLeft(4920)).toBe('1h 22m');
    expect(formatTimeLeft(1380)).toBe('23m');
    expect(formatTimeLeft(65)).toBe('1m');
    expect(formatTimeLeft(49)).toBe('49s');
  });

  it('handles zero and garbage', () => {
    expect(formatTimeLeft(0)).toBe('0s');
    expect(formatTimeLeft(-3)).toBe('0s');
    expect(formatTimeLeft(Number.NaN)).toBe('0s');
  });
});
