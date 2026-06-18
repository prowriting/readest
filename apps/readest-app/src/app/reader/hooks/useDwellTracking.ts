import { useCallback, useEffect, useRef } from 'react';
import { DwellRecord, AnalyticsStatus } from '@/types/book';
import { useWindowActiveChanged } from '@/app/reader/hooks/useWindowActiveChanged';

const MIN_DWELL_MS = 1_000;
export const MAX_DWELL_MS = 5 * 60 * 1_000;

export function getSectionCharRange(range: Range): { startChar: number; endChar: number } {
  const doc = (range.startContainer as Node).ownerDocument;
  if (!doc?.body) return { startChar: 0, endChar: 0 };
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startChar: number | null = null;
  let node = walker.nextNode();
  while (node) {
    if (node === range.startContainer) {
      startChar = offset + range.startOffset;
      if (range.startContainer === range.endContainer) {
        return { startChar, endChar: offset + range.endOffset };
      }
    }
    if (startChar !== null && node === range.endContainer) {
      return { startChar, endChar: offset + range.endOffset };
    }
    offset += (node as Text).length;
    node = walker.nextNode();
  }
  return { startChar: startChar ?? 0, endChar: offset };
}

export class DwellAccumulator {
  private lastSection: number | null = null;
  private lastChar: number | null = null;
  private lastEndChar: number | null = null;
  private lastBookHash: string | null = null;
  private lastTimestamp: number | null = null;
  private records: DwellRecord[] = [];

  onRelocate(
    section: number,
    startChar: number,
    endChar: number,
    bookHash: string,
    nowMs: number,
  ): void {
    if (
      this.lastSection !== null &&
      this.lastChar !== null &&
      this.lastEndChar !== null &&
      this.lastTimestamp !== null &&
      this.lastBookHash === bookHash
    ) {
      const elapsed = nowMs - this.lastTimestamp;
      if (elapsed >= MIN_DWELL_MS) {
        this.records.push({
          id: crypto.randomUUID(),
          bookHash,
          startSection: this.lastSection,
          startChar: this.lastChar,
          endSection: this.lastSection,
          endChar: this.lastEndChar,
          timeMilliseconds: elapsed,
          createdAt: nowMs,
          updatedAt: nowMs,
        });
      }
    }

    this.lastSection = section;
    this.lastChar = startChar;
    this.lastEndChar = endChar;
    this.lastBookHash = bookHash;
    this.lastTimestamp = nowMs;
  }

  onBlur(nowMs: number): void {
    if (
      this.lastTimestamp === null ||
      this.lastSection === null ||
      this.lastChar === null ||
      this.lastEndChar === null
    )
      return;
    const elapsed = nowMs - this.lastTimestamp;
    if (elapsed >= MIN_DWELL_MS) {
      this.records.push({
        id: crypto.randomUUID(),
        bookHash: this.lastBookHash ?? '',
        startSection: this.lastSection,
        startChar: this.lastChar,
        endSection: this.lastSection,
        endChar: this.lastEndChar,
        timeMilliseconds: elapsed,
        createdAt: nowMs,
        updatedAt: nowMs,
      });
    }
    this.lastTimestamp = null;
  }

  onFocus(nowMs: number): void {
    this.lastTimestamp = nowMs;
  }

  onTimeout(nowMs: number): void {
    if (
      this.lastTimestamp === null ||
      this.lastSection === null ||
      this.lastChar === null ||
      this.lastEndChar === null
    )
      return;
    this.records.push({
      id: crypto.randomUUID(),
      bookHash: this.lastBookHash ?? '',
      startSection: this.lastSection,
      startChar: this.lastChar,
      endSection: this.lastSection,
      endChar: this.lastEndChar,
      timeMilliseconds: MAX_DWELL_MS,
      createdAt: nowMs,
      updatedAt: nowMs,
    });
    this.lastTimestamp = nowMs;
  }

  flush(): DwellRecord[] {
    const flushed = this.records;
    this.records = [];
    return flushed;
  }
}

export function useDwellTracking(bookHash: string, analyticsStatus: AnalyticsStatus | undefined) {
  const accRef = useRef<DwellAccumulator>(new DwellAccumulator());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    const tick = () => {
      accRef.current.onTimeout(Date.now());
      timerRef.current = setTimeout(tick, MAX_DWELL_MS);
    };
    timerRef.current = setTimeout(tick, MAX_DWELL_MS);
  }, [clearTimer]);

  useWindowActiveChanged(
    useCallback(
      (isActive: boolean) => {
        if (analyticsStatus !== 'collect') return;
        if (isActive) {
          accRef.current.onFocus(Date.now());
          startTimer();
        } else {
          clearTimer();
          accRef.current.onBlur(Date.now());
        }
      },
      [analyticsStatus, startTimer, clearTimer],
    ),
  );

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const onRelocate = useCallback(
    (section: number, startChar: number, endChar: number) => {
      if (analyticsStatus !== 'collect') return;
      accRef.current.onRelocate(section, startChar, endChar, bookHash, Date.now());
      startTimer();
    },
    [bookHash, analyticsStatus, startTimer],
  );

  const flushDwells = useCallback((): DwellRecord[] => {
    return accRef.current.flush();
  }, []);

  return { onRelocate, flushDwells };
}
