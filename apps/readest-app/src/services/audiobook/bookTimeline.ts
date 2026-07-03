/**
 * Whole-book audio timeline over per-section overlay durations (seconds).
 *
 * Input durations come from the OPF's refined `media:duration` metadata
 * (exposed by foliate-js as `section.mediaOverlayDuration`); sections without
 * audio contribute 0 and unknown durations (`null`/`undefined`) contribute 0
 * but mark the timeline incomplete so UI can hide the book-level scrubber.
 */
export interface BookTimeline {
  /** Sum of the known section durations. */
  total: number;
  /** False when any overlay section's duration is undeclared. */
  isComplete: boolean;
  /** Global elapsed seconds for a position inside a section. */
  elapsed(sectionIndex: number, offset: number): number;
  /** Section + offset for a global time, clamped into the book. */
  locate(seconds: number): { sectionIndex: number; offset: number };
}

const END_EPSILON = 0.05;

export const buildBookTimeline = (durations: Array<number | null | undefined>): BookTimeline => {
  const known = durations.map((d) => (typeof d === 'number' && d > 0 ? d : 0));
  const starts: number[] = [];
  let total = 0;
  for (const duration of known) {
    starts.push(total);
    total += duration;
  }
  const isComplete = durations.every((d) => typeof d === 'number');

  return {
    total,
    isComplete,
    elapsed(sectionIndex, offset) {
      const start = starts[sectionIndex] ?? total;
      return start + Math.max(0, offset);
    },
    locate(seconds) {
      const target = Math.max(0, Math.min(seconds, Math.max(0, total - END_EPSILON)));
      for (let i = known.length - 1; i >= 0; i--) {
        if (known[i]! > 0 && target >= starts[i]!) {
          return {
            sectionIndex: i,
            offset: Math.min(target - starts[i]!, known[i]! - END_EPSILON),
          };
        }
      }
      return { sectionIndex: 0, offset: 0 };
    },
  };
};

/** m:ss under an hour, h:mm:ss from there; garbage in → 0:00. */
export const formatPlaybackTime = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
