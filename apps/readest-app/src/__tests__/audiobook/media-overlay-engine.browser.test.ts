import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { MediaOverlayEngine, MediaOverlayItem } from '@/types/mediaOverlay';
import type { FoliateView } from '@/types/view';

/**
 * Engine-level contract for the foliate-js MediaOverlay extensions, exercised
 * against the generated mo-sentences.epub in real Chromium (real Audio
 * elements, real playback). The fixture timeline:
 *
 *   section 0 (c1): one file c1.wav, 8 sentences × 1.5s → duration 12s
 *   section 1 (c2): c2a.wav (s1–s4, clips 0–6) + c2b.wav (s5–s8, clips 0–6),
 *                   i.e. per-file clip clocks RESTART — duration 12s
 *   section 2 (c3): one file c3.wav, 12 words × 0.5s → duration 6s
 */

const EPUB_URL = new URL('../../../e2e/fixtures/books/mo-sentences.epub', import.meta.url).href;
const LONG_EPUB_URL = new URL('../../../e2e/fixtures/books/mo-long.epub', import.meta.url).href;

let book: BookDoc;

const loadEPUB = async (): Promise<BookDoc> => {
  const resp = await fetch(EPUB_URL);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], 'mo-sentences.epub', { type: 'application/epub+zip' });
  return (await new DocumentLoader(file).open()).book;
};

const loadLongEPUB = async (): Promise<BookDoc> => {
  const resp = await fetch(LONG_EPUB_URL);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], 'mo-long.epub', { type: 'application/epub+zip' });
  return (await new DocumentLoader(file).open()).book;
};

/**
 * Run `fn` from a REAL user click (CDP input via vitest's userEvent) so
 * Chromium grants the transient activation audio autoplay requires —
 * programmatic .click() does not count.
 */
const withGesture = async (fn: () => unknown): Promise<void> => {
  const button = document.createElement('button');
  button.textContent = 'play';
  // Keep the button clickable above absolutely-positioned test views.
  Object.assign(button.style, { position: 'fixed', right: '0', bottom: '0', zIndex: '99999' });
  document.body.append(button);
  const done = new Promise<void>((resolve, reject) => {
    button.addEventListener(
      'click',
      () => {
        Promise.resolve(fn()).then(() => resolve(), reject);
      },
      { once: true },
    );
  });
  await userEvent.click(button);
  await done;
  button.remove();
};

const nextEvent = <T>(target: EventTarget, type: string, timeout = 10_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeout);
    target.addEventListener(
      type,
      (e) => {
        clearTimeout(timer);
        resolve((e as CustomEvent).detail as T);
      },
      { once: true },
    );
  });

const poll = async (pred: () => boolean, timeout = 10_000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('poll timeout');
};

const engines: MediaOverlayEngine[] = [];
const createEngine = (): MediaOverlayEngine => {
  const engine = book.getMediaOverlay!();
  engine.setVolume(0);
  engines.push(engine);
  return engine;
};

beforeAll(async () => {
  book = await loadEPUB();
}, 30_000);

afterEach(() => {
  while (engines.length) engines.pop()?.stop();
});

describe('MediaOverlay engine — durations metadata', () => {
  it('exposes declared per-section media:duration on sections', () => {
    const durations = book.sections.map((s) => s.mediaOverlayDuration);
    expect(durations).toEqual([12, 12, 6]);
    expect(book.media?.duration).toBe(30);
  });

  it('exports resolved audio segments and text cues for native car playback', async () => {
    const engine = createEngine();
    const manifest = await engine.exportPlaybackManifest();

    expect(manifest.sections).toHaveLength(3);
    expect(manifest.sections[1]).toMatchObject({
      sectionIndex: 1,
      duration: 12,
      segments: [
        {
          source: 'OEBPS/audio/c2a.wav',
          clipBegin: 0,
          clipEnd: 6,
        },
        {
          source: 'OEBPS/audio/c2b.wav',
          clipBegin: 0,
          clipEnd: 6,
        },
      ],
    });
    expect(manifest.sections[1]!.segments[1]!.cues[0]).toEqual({
      offset: 0,
      text: 'OEBPS/text/c2.xhtml#s5',
    });

    const audio = await engine.loadAudioSource(manifest.sections[1]!.segments[1]!.source);
    expect(audio.type).toBe('audio/wav');
    expect(audio.size).toBeGreaterThan(40_000);
  });
});

describe('MediaOverlay engine — position (Phase 1)', () => {
  it('startAtOffset resolves file and item across restarting clip clocks', async () => {
    const engine = createEngine();
    const highlight = nextEvent<MediaOverlayItem>(engine, 'highlight');
    // Section 1 offset 7.0s: past c2a's 6s span, so 1.0s into c2b → sentence 5.
    await withGesture(() => engine.startAtOffset(1, 7.0));
    const item = await highlight;
    expect(item.text).toContain('#s5');
    expect(engine.activeSectionIndex).toBe(1);
    await poll(() => engine.audioTime >= 0.95 && engine.audioTime < 2.5);
    await poll(() => engine.sectionOffset >= 6.95 && engine.sectionOffset < 8.5);
    expect(engine.sectionDuration).toBeCloseTo(12, 1);
  });

  it('pause freezes the timeline and resume continues from the same offset', async () => {
    const engine = createEngine();
    const highlight = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.start(0));
    await highlight;
    await poll(() => engine.sectionOffset > 0.3);

    engine.pause();
    const pausedAt = engine.sectionOffset;
    await new Promise((r) => setTimeout(r, 500));
    expect(engine.sectionOffset).toBeCloseTo(pausedAt, 1);

    engine.resume();
    await poll(() => engine.sectionOffset > pausedAt + 0.2);
    // Resume must not have jumped backwards to the clip start.
    expect(engine.sectionOffset).toBeGreaterThan(pausedAt);
  });
});

describe('MediaOverlay engine — seeking (Phase 2)', () => {
  it('seekRelative forward crosses audio file boundaries', async () => {
    const engine = createEngine();
    const first = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.startAtOffset(1, 5.0));
    await first;

    const afterSeek = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await engine.seekRelative(2); // 5.0 + 2 = 7.0 → 1.0s into c2b → sentence 5
    const item = await afterSeek;
    expect(item.text).toContain('#s5');
    await poll(() => engine.sectionOffset >= 6.9 && engine.sectionOffset < 8.5);
  });

  it('seekRelative backward crosses into the previous section', async () => {
    const engine = createEngine();
    const first = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.startAtOffset(1, 0.5));
    await first;

    const afterSeek = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await engine.seekRelative(-2); // 0.5 - 2 → 10.5s into section 0 → sentence 8
    const item = await afterSeek;
    expect(item.text).toContain('#s8');
    expect(engine.activeSectionIndex).toBe(0);
    await poll(() => engine.sectionOffset >= 10.4 && engine.sectionOffset < 12);
  });

  it('seekRelative within one audio file unhighlights the previous item first', async () => {
    const engine = createEngine();
    const first = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.startAtOffset(0, 0.2)); // c1.wav, sentence 1
    await first;

    // Same-file seek (section 0 is one 12s file): consumers keep exactly one
    // element highlighted by pairing each highlight with the unhighlight of
    // the previous item. Regression: the same-file fast path highlighted the
    // new item without unhighlighting the old one, so stale highlights piled
    // up on every in-file skip.
    const events: string[] = [];
    const onUnhighlight = (e: Event) =>
      events.push(
        `unhighlight:${((e as CustomEvent).detail as MediaOverlayItem | undefined)?.text ?? ''}`,
      );
    const onHighlight = (e: Event) =>
      events.push(`highlight:${((e as CustomEvent).detail as MediaOverlayItem).text}`);
    engine.addEventListener('unhighlight', onUnhighlight);
    engine.addEventListener('highlight', onHighlight);
    await engine.seekRelative(6); // ~0.2+6 → sentence 5, same audio file
    await poll(() => events.some((entry) => entry.startsWith('highlight:')));
    engine.removeEventListener('unhighlight', onUnhighlight);
    engine.removeEventListener('highlight', onHighlight);

    const firstHighlight = events.findIndex((entry) => entry.startsWith('highlight:'));
    expect(events[firstHighlight]).toContain('#s5');
    const unhighlightedOldFirst = events
      .slice(0, firstHighlight)
      .some((entry) => entry.startsWith('unhighlight:') && entry.includes('#s1'));
    expect(unhighlightedOldFirst).toBe(true);
  });

  it('seekRelative while paused reports the target position and stays paused', async () => {
    const engine = createEngine();
    const first = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.startAtOffset(0, 2.0));
    await first;
    await poll(() => engine.sectionOffset >= 2.0);
    engine.pause();
    const pausedAt = engine.sectionOffset; // ≈2.0–2.4s into section 0 (12s)

    // +13s crosses into section 1: a NEW audio element is created while
    // paused. Regression: `highlight` fired before the seek was applied to
    // the fresh element (currentTime set pre-metadata), so listeners that
    // sync UI position on highlight — the reader's clock — captured the
    // file start, and nothing ever corrected it while paused.
    let offsetAtHighlight = -1;
    const afterSeek = new Promise<void>((resolve) => {
      engine.addEventListener(
        'highlight',
        () => {
          offsetAtHighlight = engine.sectionOffset;
          resolve();
        },
        { once: true },
      );
    });
    await engine.seekRelative(13);
    await afterSeek;
    expect(engine.activeSectionIndex).toBe(1);
    expect(offsetAtHighlight).toBeGreaterThanOrEqual(pausedAt + 0.6);
    expect(offsetAtHighlight).toBeLessThan(pausedAt + 1.6);
    expect(engine.sectionOffset).toBeGreaterThanOrEqual(pausedAt + 0.9);
    expect(engine.sectionOffset).toBeLessThan(pausedAt + 1.6);

    // Still paused: the timeline must not advance on its own.
    const settled = engine.sectionOffset;
    await new Promise((r) => setTimeout(r, 500));
    expect(engine.sectionOffset).toBeCloseTo(settled, 1);
  });

  it('seekRelative past the end of the book dispatches ended', async () => {
    const engine = createEngine();
    const first = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.startAtOffset(2, 5.0));
    await first;

    const ended = nextEvent<void>(engine, 'ended');
    await engine.seekRelative(10); // 5.0 + 10 is past the 6s word chapter — the end
    await ended;
  });

  it('seekRelative clamps at the very beginning of the book', async () => {
    const engine = createEngine();
    const first = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.startAtOffset(0, 0.2));
    await first;

    const afterSeek = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await engine.seekRelative(-30);
    const item = await afterSeek;
    expect(item.text).toContain('#s1');
    expect(engine.activeSectionIndex).toBe(0);
    await poll(() => engine.sectionOffset < 1.5);
  });
});

describe('MediaOverlay engine — tap-to-seek (Phase 3)', () => {
  it('playFromText seeks to the clip whose text target matches', async () => {
    const engine = createEngine();
    const first = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.start(0));
    await first;

    const afterSeek = nextEvent<MediaOverlayItem>(engine, 'highlight');
    expect(await engine.playFromText(0, 's4')).toBe(true);
    const item = await afterSeek;
    expect(item.text).toContain('#s4');
    // Sentence 4's clip spans 4.5–6.0s.
    await poll(() => engine.audioTime >= 4.4 && engine.audioTime < 6.0);
  });

  it('playFromText refuses unknown fragments without disturbing playback', async () => {
    const engine = createEngine();
    const first = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.start(0));
    await first;

    expect(await engine.playFromText(0, 'not-a-real-id')).toBe(false);
    expect(engine.activeSectionIndex).toBe(0);
    const before = engine.audioTime;
    await poll(() => engine.audioTime > before + 0.2); // still playing
  });

  it('playFromText can jump into another section', async () => {
    const engine = createEngine();
    const first = nextEvent<MediaOverlayItem>(engine, 'highlight');
    await withGesture(() => engine.start(0));
    await first;

    const afterSeek = nextEvent<MediaOverlayItem>(engine, 'highlight');
    expect(await engine.playFromText(2, 'w3')).toBe(true);
    const item = await afterSeek;
    expect(item.text).toContain('#w3');
    expect(engine.activeSectionIndex).toBe(2);
  });
});

describe('MediaOverlay engine — text offsets (Phase 4)', () => {
  it('textOffset reports the concatenated-timeline offset of a text target', async () => {
    const engine = createEngine();
    // Chapter 1: sentence 3's clip begins at 3.0s.
    expect(await engine.textOffset(0, 's3')).toBeCloseTo(3.0, 3);
    // Chapter 2: sentence 5 opens the second audio file — 6.0s into the section.
    expect(await engine.textOffset(1, 's5')).toBeCloseTo(6.0, 3);
    // Word chapter: word 4 begins at 1.5s.
    expect(await engine.textOffset(2, 'w4')).toBeCloseTo(1.5, 3);
    expect(await engine.textOffset(0, 'not-a-real-id')).toBe(null);
  });
});

describe('audio-only detection on real fixtures (Phase 5)', () => {
  it('classifies the generated fixtures correctly', async () => {
    const { detectAudioOnly } = await import('@/utils/audiobook');
    expect(await detectAudioOnly(book)).toBe(false); // sentence-level read-along
    const url = new URL('../../../e2e/fixtures/books/mo-audio-only.epub', import.meta.url).href;
    const resp = await fetch(url);
    const file = new File([await resp.arrayBuffer()], 'mo-audio-only.epub', {
      type: 'application/epub+zip',
    });
    const audioOnlyBook = (await new DocumentLoader(file).open()).book;
    expect(await detectAudioOnly(audioOnlyBook)).toBe(true);
    expect(audioOnlyBook.media?.duration).toBe(30);
  });
});

describe('foliate-view media overlay integration (view.js)', () => {
  const createView = async (): Promise<FoliateView> => {
    await import('foliate-js/view.js');
    const view = document.createElement('foliate-view') as FoliateView;
    Object.assign(view.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.append(view);
    await view.open(await loadEPUB());
    view.mediaOverlay!.setVolume(0);
    await view.goToFraction(0);
    return view;
  };
  const destroyView = (view: FoliateView) => {
    view.mediaOverlay?.stop();
    view.close();
    view.remove();
  };
  const activeClassCount = (view: FoliateView): number =>
    view.renderer
      .getContents()
      .filter(({ doc }) => doc?.querySelector('.-epub-media-overlay-active') != null).length;

  it('applies the active class without corrupting renderer content indexes', async () => {
    const view = await createView();
    const highlight = nextEvent<MediaOverlayItem>(view.mediaOverlay!, 'highlight');
    await withGesture(() => view.startMediaOverlay!());
    await highlight;

    // The active class must appear in exactly one section document...
    await poll(() => activeClassCount(view) > 0);
    // ...and the buggy `find(x => x.index = resolved.index)` predicate would
    // have overwritten content indexes: they must all stay distinct.
    const indexes = view.renderer.getContents().map((c) => c.index);
    expect(new Set(indexes).size).toBe(indexes.length);
    destroyView(view);
  });

  it('mediaOverlayFollowEnabled=false keeps the reader where it is', async () => {
    const view = await createView();
    expect(view.renderer.primaryIndex).toBe(0);
    view.mediaOverlayFollowEnabled = false;

    // Play section 1 while the reader is looking at section 0.
    const highlight = nextEvent<MediaOverlayItem>(view.mediaOverlay!, 'highlight');
    await withGesture(() => view.mediaOverlay!.startAtOffset(1, 0));
    await highlight;
    // Two more highlight cycles: the renderer must not be dragged along.
    await nextEvent<MediaOverlayItem>(view.mediaOverlay!, 'highlight');
    expect(view.renderer.primaryIndex).toBe(0);

    // Re-enabling follow lets the next highlight navigate the reader.
    view.mediaOverlayFollowEnabled = true;
    await nextEvent<MediaOverlayItem>(view.mediaOverlay!, 'highlight');
    await poll(() => view.renderer.primaryIndex === 1);
    destroyView(view);
  });

  it('follows Chapter 1 narration when the next sentence begins on the next page', async () => {
    // The production Christmas Carol has the same inline-SMIL structure. On
    // its Chapter 1 layout the first observed boundary is f000036 -> f000037;
    // mo-long keeps that reproduction deterministic without committing the
    // customer's 87 MB EPUB to the repository.
    await import('foliate-js/view.js');
    const view = document.createElement('foliate-view') as FoliateView;
    Object.assign(view.style, {
      // This models the narrow reader pane used on the phone. The outer test
      // viewport is intentionally wider: visibility must be clipped to the
      // reader, not inferred from the browser window.
      width: '250px',
      height: '700px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.append(view);
    await view.open(await loadLongEPUB());
    view.mediaOverlay!.setVolume(0);
    view.mediaOverlayFollowEnabled = true;

    const chapterIndex = 0;
    const sectionHref = view.book.sections[chapterIndex]!.id;
    await view.renderer.goTo({ index: chapterIndex, anchor: 0 });

    let priorFragment = '';
    let nextFragment = '';
    let priorPage = view.renderer.page;
    for (let i = 1; i <= 16; i += 1) {
      const fragment = `s${i}`;
      const resolved = view.resolveNavigation(`${sectionHref}#${fragment}`);
      expect(resolved).not.toBeNull();
      await view.renderer.goTo(resolved);
      const page = view.renderer.page;
      if (page > priorPage) {
        priorFragment = `s${i - 1}`;
        nextFragment = fragment;
        break;
      }
      priorPage = page;
    }
    expect(nextFragment).not.toBe('');

    const priorTarget = view.resolveNavigation(`${sectionHref}#${priorFragment}`);
    const nextTarget = view.resolveNavigation(`${sectionHref}#${nextFragment}`);
    await view.renderer.goTo(priorTarget);
    const pageBeforePlayback = view.renderer.page;

    const chapter = view.renderer.getContents().find(({ index }) => index === chapterIndex);
    const nextElement = nextTarget?.anchor?.(chapter!.doc!);
    expect(nextElement).toBeDefined();
    const readerRect = view.getBoundingClientRect();
    const nextRect = nextElement!.getBoundingClientRect();
    expect(nextRect.left).toBeGreaterThanOrEqual(readerRect.right);

    const nextOffset = await view.mediaOverlay!.textOffset(chapterIndex, nextFragment);
    expect(nextOffset).not.toBeNull();

    const nextPageHighlight = new Promise<MediaOverlayItem>((resolve) => {
      const onHighlight = (event: Event) => {
        const item = (event as CustomEvent<MediaOverlayItem>).detail;
        if (!item.text.endsWith(`#${nextFragment}`)) return;
        view.mediaOverlay!.removeEventListener('highlight', onHighlight);
        resolve(item);
      };
      view.mediaOverlay!.addEventListener('highlight', onHighlight);
    });
    // Start at the tail of the previous sentence and allow the real audio
    // element to roll naturally into the first sentence on the next page.
    await withGesture(() => view.mediaOverlay!.startAtOffset(chapterIndex, nextOffset! - 0.1));
    const item = await nextPageHighlight;
    expect(item.text).toContain(`#${nextFragment}`);

    // Keep the assertion within this target's 2.5 second clip, so a later
    // sentence cannot accidentally make the test pass by turning the page.
    try {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(
        view.renderer.page,
        `audio advanced to ${nextFragment}, but the reader stayed on page ${pageBeforePlayback}`,
      ).toBeGreaterThan(pageBeforePlayback);
    } finally {
      destroyView(view);
    }
  });

  it('mediaOverlayHighlightEnabled=false clears and withholds the active class', async () => {
    const view = await createView();
    const highlight = nextEvent<MediaOverlayItem>(view.mediaOverlay!, 'highlight');
    await withGesture(() => view.startMediaOverlay!());
    await highlight;
    await poll(() => activeClassCount(view) > 0);

    view.mediaOverlayHighlightEnabled = false;
    // The current highlight is cleared on the next cycle and none reappear.
    await poll(() => activeClassCount(view) === 0);
    await nextEvent<MediaOverlayItem>(view.mediaOverlay!, 'highlight');
    expect(activeClassCount(view)).toBe(0);

    view.mediaOverlayHighlightEnabled = true;
    await nextEvent<MediaOverlayItem>(view.mediaOverlay!, 'highlight');
    await poll(() => activeClassCount(view) > 0);
    destroyView(view);
  });
});
