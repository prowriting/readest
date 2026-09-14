import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { throttle } from '@/utils/throttle';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T19:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it('does not postpone library uploads for an hour when the system clock moves backwards', () => {
  const upload = vi.fn();
  const sync = throttle(upload, 5000);
  sync('initial');
  vi.setSystemTime(new Date('2026-09-10T18:00:00Z'));
  sync('uploaded-book');
  expect(upload.mock.calls).toEqual([['initial'], ['uploaded-book']]);
});

it('replaces a queued stale call when the clock is corrected, without a duplicate upload', async () => {
  const upload = vi.fn();
  const sync = throttle(upload, 5000);
  sync('initial');
  sync('queued');
  vi.setSystemTime(new Date('2026-09-10T18:00:00Z'));
  sync('latest');
  await vi.advanceTimersByTimeAsync(6000);
  expect(upload.mock.calls).toEqual([['initial'], ['latest']]);
});
