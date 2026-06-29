# Dwell Analytics

Dwell analytics track how long a reader spends on each page of a book and send that data, with the reader's consent, to the author via BookArcWeb. Authors use it to understand which parts of a book readers linger on or skip through, to inform edits.

## Consent model

Each `BookRecord` has an `analyticsStatus` field with four states:

| Value | Meaning |
|-------|---------|
| `none` | Default. Author has not requested analytics. |
| `ask` | Author requested analytics; reader has not yet been asked. |
| `collect` | Reader has consented. Dwells are recorded and synced. |
| `denied` | Reader declined. Nothing is recorded. |

The author sets `RequestAnalytics = true` on their book in BookArcWeb. When the reader claims the book via a gift code, BookArcReaderApi seeds `AnalyticsStatus = "ask"` on the `BookRecord`. On the next session open, `AnalyticsConsentModal` is shown. The reader's choice is synced back immediately.

Dwell records are **only ever stored or transmitted when `analyticsStatus === 'collect'`**. The guard appears in `useDwellTracking` (hook level) and in `SyncController` (server level — the push endpoint rejects dwell records for non-consenting books).

## Position representation

Positions use two integers: `(section, char)`.

**Section** is the 0-based spine index of the EPUB content document (HTML file). It is extracted from the Foliate `relocate` event's CFI via `getIndexFromCfi(detail.cfi)`, which parses the `/6/N` component: `index = N/2 - 1`. This is a **spine index**, not a chapter index — one spine document can contain multiple chapters.

**Char** is the character offset within that spine document, counted by walking all text nodes in DOM order with `TreeWalker(SHOW_TEXT)` and summing their lengths until the target node is reached. This is **font-size independent**: the DOM character count does not change when the user resizes text, unlike page numbers.

Both a `startChar` and `endChar` are captured per relocate event, giving the full extent of the visible page range:

```typescript
// getSectionCharRange in useDwellTracking.ts
export function getSectionCharRange(range: Range): { startChar: number; endChar: number }
```

The `detail.range` from the Foliate `relocate` event is the DOM Range of everything visible on screen. `startChar` is the offset of `range.startContainer/startOffset`; `endChar` is the offset of `range.endContainer/endOffset`.

### Mapping positions to chapters

Section index ≠ chapter. To resolve a position to a chapter, use `findTocItemBS(toc, cfi)` in `src/services/nav/lookup.ts`, which binary-searches the TOC by CFI. Foliate also provides `detail.tocItem` directly on every `relocate` event. The dwell records themselves do not store chapter labels — chapter mapping is done at query time using the book's TOC.

## DwellRecord schema

```
(startSection, startChar) — beginning of the visible page range
(endSection, endChar)     — end of the visible page range
timeMilliseconds          — milliseconds the reader was active on this view
```

`startSection === endSection` in practice, because a single page view is almost always within one spine document. The fields are stored separately to remain correct for the edge cases where a page spans a section boundary.

### Storage

- **Reader app (SQLite)**: `DwellRecord` in `src/types/book.ts` / `src/types/records.ts`
- **API (Postgres)**: `DwellRecord` entity in `BookArcReaderApi/Models/Entities/DwellRecord.cs`
- **Web analytics (C#)**: `DwellTime` in `BookArcWeb/src/BookArcWeb.Domain/Analytics/DwellTime.cs`

## Tracking logic

### DwellAccumulator (pure class, no React)

State: `lastSection`, `lastChar`, `lastEndChar`, `lastBookHash`, `lastTimestamp`.

```
onRelocate(section, startChar, endChar, bookHash, nowMs)
  If previous position exists AND same bookHash AND elapsed >= 1000ms:
    push record: (lastSection, lastChar) → (lastSection, lastEndChar), time = elapsed
  Update state to new position and timestamp.

onBlur(nowMs)
  If timestamp exists AND elapsed >= 1000ms:
    push record: (lastSection, lastChar) → (lastSection, lastEndChar), time = elapsed
  Clear timestamp (stop counting while app is in background).

onFocus(nowMs)
  Set timestamp = nowMs (restart counting, position unchanged).

onTimeout(nowMs)
  Push record with timeMilliseconds = MAX_DWELL_MS (5 minutes).
  Reset timestamp = nowMs (start the next cap period).

flush()
  Return and clear accumulated records.
```

Key behavioural points:
- **`endChar` is the end of the *previous* page's visible range**, not the start of the new page. If the reader is on a page showing chars 100–480, then turns to 481–900, the dwell records `endChar = 480`.
- **`MIN_DWELL_MS = 1000`**: quick flips (< 1 s) are ignored.
- **`MAX_DWELL_MS = 300_000` (5 min)**: if the reader stays on one page for more than 5 minutes, a capped dwell is recorded and the clock resets. If they genuinely keep reading, successive MAX_DWELL_MS records accumulate.
- **Book hash change**: if `bookHash` differs between relocates, no record is pushed and state resets — prevents cross-book contamination.
- **Double blur**: `onBlur` clears `lastTimestamp`, so a second blur finds no timestamp and does nothing.

### useDwellTracking hook

Wraps `DwellAccumulator` and adds:

1. **Focus/blur** via `useWindowActiveChanged` (Tauri `appWindow.onFocusChanged` on desktop, `document.visibilitychange` on web/mobile). Calls `onBlur`/`onFocus` and clears/restarts the max-dwell timer.

2. **Max-dwell timer**: `setTimeout` set to `MAX_DWELL_MS` on every `onRelocate` or `onFocus`. Firing calls `onTimeout` and reschedules itself. Cleared on blur or unmount.

Returns `{ onRelocate(section, startChar, endChar), flushDwells() }`.

### useAnalyticsDwells hook

Wraps `useDwellTracking` and adds:

- **Consent gating**: exposes `showConsent`, `handleAllow`, `handleDecline`.
- **Auto-flush**: debounced on the same cadence as progress sync. Calls `flushDwells()` and `pushChanges({ dwells })` when new progress is recorded.
- Exposes `onRelocate` directly (passthrough to `useDwellTracking`).

### FoliateViewer wiring

In `progressRelocateHandler`, every Foliate `relocate` event:

```typescript
const section = getIndexFromCfi(detail.cfi) ?? 0;
const { startChar, endChar } = getSectionCharRange(detail.range as Range);
onRelocate(section, startChar, endChar);
```

This fires on: page turns, font size changes, initial load, and RSVP position updates.

## Sync flow

**Push (reader → API)**:
`useAnalyticsDwells.flushAndPushDwells` → `SyncClient.pushChanges({ dwells })` → `POST /api/sync` → `SyncController.UpsertDwells`.

The API only persists a dwell if `BookRecord.AnalyticsStatus == "collect"` for the user+book pair.

**Pull (API → BookArcWeb analytics)**:
`GET /api/analytics/dwells?book=<hash>` (authenticated with `X-Api-Key`) → `AnalyticsController` → returns all non-deleted dwell records for users who have consented for that book.

## Analytics computation (BookArcWeb)

`DwellCalculator` in `BookArcWeb.Domain` takes the raw dwell records and produces sector-level summaries.

`GetSectors(dwells, numberOfIntervals, minSection, minChar, maxSection, maxChar)` divides the book's character range into N equal buckets and distributes each dwell's time proportionally across the buckets it spans.

Internally it linearises `(section, char)` positions using `CharsPerSection = 1_000_000` as a multiplier: `linear = section * 1_000_000 + char`. This is an implementation detail not exposed in the API — all external interfaces use the compound `(section, char)` form.

`AverageSectors(sets)` averages multiple GetSectors results (e.g. across multiple readers) into a single heatmap, suitable for display on the author's analytics dashboard.

## Constants

| Constant | Value | Location |
|----------|-------|----------|
| `MIN_DWELL_MS` | 1 000 ms | `useDwellTracking.ts` (not exported) |
| `MAX_DWELL_MS` | 300 000 ms (5 min) | `useDwellTracking.ts` (exported for tests) |
| `CharsPerSection` | 1 000 000 | `DwellCalculator.cs` (private) |

## Edge case summary

| Scenario | Behaviour |
|----------|-----------|
| Quick page flip (< 1 s) | Filtered by `MIN_DWELL_MS` — no record |
| App backgrounded | `onBlur` records elapsed, clears timer |
| App foregrounded | `onFocus` restarts clock at current position |
| Long idle on one page (> 5 min) | `onTimeout` caps at `MAX_DWELL_MS`, resets clock; repeats |
| Font size change | New `relocate` event fires; `lastEndChar` updated; no dwell unless ≥ 1 s |
| Different book opened | `bookHash` mismatch — no record, state resets |
| `analyticsStatus !== 'collect'` | Guards in hook and API prevent any recording |
| Double blur | Second `onBlur` finds `lastTimestamp === null` — no-op |
