import type { PageSource } from '../pdf/source';
import type { Store, ViewerState } from '../store';
import { icons } from '../ui/icons';
import type { PdfViewer } from '../viewer/viewer';
import {
  buildPageIndex,
  findMatches,
  matchToItemSpans,
  type Match,
  type PageTextIndex,
} from './search';

/**
 * Find bar: a text field with match count, previous / next and close, plus the
 * highlight layer that wraps matched ranges of the pdf.js text layer in
 * `<mark class="find-match">` (`find-current` on the active match).
 *
 * Text-div invariant (checked against pdfjs-dist 6.4.299, `TextLayer.#processItems`
 * / `#appendText`): the layer creates exactly one `<span>` per text content item
 * whose `str` is defined and pushes it to `textDivs`, in item order; marked-content
 * items (`beginMarkedContent`, `endMarkedContent`, …) only nest a container and
 * produce no div. `PageSource.getPageText` keeps precisely the items with a `str`,
 * so `viewer.getTextDivs(i)[k]` is the span of `getPageText(i)[k]`, and
 * `matchToItemSpans` offsets apply to that span's text verbatim. (An empty-string
 * item still gets a div, which is simply never appended; matches never cover it.)
 */

export const FIND_DEBOUNCE_MS = 150;
/** Pages whose text is fetched concurrently while the index is built. */
const INDEX_BATCH = 10;
/** PDF points kept above a match when the viewer scrolls to it. */
const MATCH_MARGIN_PT = 80;
/** CSS px kept between a revealed match and the viewport edge. */
const NUDGE_MARGIN_PX = 8;

export interface FindBarDeps {
  viewer: PdfViewer;
  /** Document to search; `setDocument` replaces it when another file opens. */
  doc?: PageSource | null;
}

/** A character range inside one text item, tagged with the match it belongs to. */
interface ItemRange {
  start: number;
  end: number;
  match: number;
}

/** Highlight ranges for the current result set: page index → item index → ranges. */
type RangeMap = Map<number, Map<number, ItemRange[]>>;

// ---- text index (memoised per document) -------------------------------------

const indexCache = new WeakMap<PageSource, Promise<PageTextIndex[]>>();
const indexReady = new WeakSet<PageSource>();

async function buildIndex(doc: PageSource): Promise<PageTextIndex[]> {
  const pages: PageTextIndex[] = [];
  for (let from = 0; from < doc.numPages; from += INDEX_BATCH) {
    const to = Math.min(from + INDEX_BATCH, doc.numPages);
    const batch = await Promise.all(
      Array.from({ length: to - from }, (_, k) =>
        doc.getPageText(from + k).then((items) => buildPageIndex(from + k, items)),
      ),
    );
    pages.push(...batch);
  }
  indexReady.add(doc);
  return pages;
}

function textIndex(doc: PageSource): Promise<PageTextIndex[]> {
  let p = indexCache.get(doc);
  if (!p) {
    p = buildIndex(doc);
    indexCache.set(doc, p);
    // A destroyed document rejects; forget the attempt so a later open can retry.
    p.catch(() => indexCache.delete(doc));
  }
  return p;
}

// ---- DOM helpers --------------------------------------------------------------

/** Rounded search field (glyph, input, count, end-search button) followed by previous / next. */
const TEMPLATE = `
  <div class="find-field">
    <span class="find-glyph" aria-hidden="true">${icons.search}</span>
    <input type="text" data-find-input placeholder="Search" aria-label="Find in document"
           autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
    <span class="find-count" data-find-count aria-live="polite"></span>
    <button type="button" class="find-clear" data-action="find-close" title="Done (Esc)" aria-label="Close find bar">${icons.xmarkCircleFill}</button>
  </div>
  <div class="find-nav">
    <button type="button" class="find-btn" data-action="find-prev" title="Previous match (Shift+Enter)" aria-label="Previous match">${icons.chevronUp}</button>
    <button type="button" class="find-btn" data-action="find-next" title="Next match (Enter)" aria-label="Next match">${icons.chevronDown}</button>
  </div>
`;

function must<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`find bar: missing ${selector}`);
  return el;
}

/** Nearest ancestor that actually scrolls (the viewer container); `overflow: hidden/clip` boxes are skipped. */
function scrollParent(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(p);
    if (/auto|scroll/.test(overflowX + overflowY)) return p;
  }
  return null;
}

/** Minimal scroll that brings `el` fully inside its scroll container (no-op when already visible). */
function nudgeIntoView(el: Element, scroller = scrollParent(el)): void {
  if (!scroller) return;
  const r = el.getBoundingClientRect();
  const c = scroller.getBoundingClientRect();
  const right = c.left + scroller.clientWidth;
  const bottom = c.top + scroller.clientHeight;
  if (r.left < c.left) scroller.scrollLeft += r.left - c.left - NUDGE_MARGIN_PX;
  else if (r.right > right) scroller.scrollLeft += r.right - right + NUDGE_MARGIN_PX;
  if (r.top < c.top) scroller.scrollTop += r.top - c.top - NUDGE_MARGIN_PX;
  else if (r.bottom > bottom) scroller.scrollTop += r.bottom - bottom + NUDGE_MARGIN_PX;
}

function isInView(el: Element): boolean {
  const scroller = scrollParent(el);
  if (!scroller) return false;
  const r = el.getBoundingClientRect();
  const c = scroller.getBoundingClientRect();
  return (
    r.top >= c.top &&
    r.bottom <= c.top + scroller.clientHeight &&
    r.left >= c.left &&
    r.right <= c.left + scroller.clientWidth
  );
}

/** Rebuilds `div`'s children as text + `<mark>` runs for `ranges` (item-relative, non-overlapping). */
function wrapRanges(div: HTMLElement, ranges: ItemRange[], current: number): void {
  const text = div.textContent ?? '';
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start < pos || r.end > text.length) continue;
    if (r.start > pos) frag.append(text.slice(pos, r.start));
    const mark = document.createElement('mark');
    mark.className = r.match === current ? 'find-match find-current' : 'find-match';
    mark.textContent = text.slice(r.start, r.end);
    frag.append(mark);
    pos = r.end;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  div.replaceChildren(frag);
}

/** Restores a single text node; the concatenated text is the original item string. */
function unwrap(div: HTMLElement): void {
  if (div.childElementCount > 0) div.textContent = div.textContent ?? '';
}

function groupRanges(pages: PageTextIndex[], matches: Match[]): { ranges: RangeMap; firstItem: number[] } {
  const byPage = new Map<number, PageTextIndex>();
  for (const p of pages) byPage.set(p.pageIndex, p);
  const ranges: RangeMap = new Map();
  const firstItem: number[] = [];
  matches.forEach((m, mi) => {
    const index = byPage.get(m.pageIndex);
    const spans = index ? matchToItemSpans(index, m) : [];
    firstItem.push(spans[0]?.item ?? 0);
    if (spans.length === 0) return;
    let items = ranges.get(m.pageIndex);
    if (!items) {
      items = new Map();
      ranges.set(m.pageIndex, items);
    }
    for (const s of spans) {
      let list = items.get(s.item);
      if (!list) {
        list = [];
        items.set(s.item, list);
      }
      list.push({ start: s.start, end: s.end, match: mi });
    }
  });
  return { ranges, firstItem };
}

// ---- component ----------------------------------------------------------------

export class FindBar {
  private readonly viewer: PdfViewer;
  private readonly input: HTMLInputElement;
  private readonly countEl: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly offTextLayer: () => void;
  private doc: PageSource | null;
  /** Query whose results are currently shown ('' while idle or closed). */
  private activeQuery = '';
  private matches: Match[] = [];
  /** Text item holding the start of each match, for scrolling to it. */
  private firstItem: number[] = [];
  private current = -1;
  private ranges: RangeMap = new Map();
  /** Text divs that currently contain `<mark>`s, per page. */
  private marked = new Map<number, HTMLElement[]>();
  /** Match whose page has been scrolled to but whose text layer is not mounted yet. */
  private pendingReveal = -1;
  private debounce = 0;
  private seq = 0;
  private lastFocus: Element | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly store: Store<ViewerState>,
    deps: FindBarDeps,
  ) {
    this.viewer = deps.viewer;
    this.doc = deps.doc ?? null;
    host.innerHTML = TEMPLATE;
    host.setAttribute('role', 'search');
    this.input = must<HTMLInputElement>(host, 'input[data-find-input]');
    this.countEl = must<HTMLElement>(host, '[data-find-count]');
    this.prevBtn = must<HTMLButtonElement>(host, '[data-action="find-prev"]');
    this.nextBtn = must<HTMLButtonElement>(host, '[data-action="find-next"]');
    const closeBtn = must<HTMLButtonElement>(host, '[data-action="find-close"]');

    this.input.addEventListener('input', () => this.scheduleSearch());
    this.input.addEventListener('keydown', this.onKeydown);
    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());
    closeBtn.addEventListener('click', () => this.close());
    // Keep the caret in the field when the buttons are clicked.
    for (const b of [this.prevBtn, this.nextBtn, closeBtn]) {
      b.addEventListener('mousedown', (e) => e.preventDefault());
    }
    this.offTextLayer = this.viewer.onTextLayer((index, _el, divs) => this.onTextLayer(index, divs));
    this.publish();
  }

  // ---- public API -----------------------------------------------------------

  /** Shows the bar, focuses and selects the field; a kept query is searched again. */
  open(): void {
    if (this.host.hidden) {
      this.lastFocus = document.activeElement;
      this.host.hidden = false;
    }
    this.store.set({ findOpen: true });
    this.input.focus();
    this.input.select();
    if (this.input.value !== this.activeQuery) void this.search(this.input.value);
  }

  /** Hides the bar, drops every highlight and resets the find fields in the store. The text stays. */
  close(): void {
    this.cancelPending();
    this.reset();
    this.activeQuery = '';
    this.host.hidden = true;
    this.store.set({ findOpen: false, findQuery: '', findTotal: 0, findIndex: -1 });
    this.countEl.textContent = '';
    if (this.host.contains(document.activeElement)) {
      const back = this.lastFocus instanceof HTMLElement && this.lastFocus.isConnected ? this.lastFocus : null;
      if (back) back.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    }
    this.lastFocus = null;
  }

  toggle(): void {
    if (this.host.hidden) this.open();
    else this.close();
  }

  /** Swaps the searched document; an open bar re-runs its query against the new one. */
  /** Pages moved, were inserted or deleted: rebuild the text index and search again. */
  structureChanged(): void {
    const doc = this.doc;
    if (!doc) return;
    indexCache.delete(doc);
    indexReady.delete(doc);
    this.cancelPending();
    this.reset();
    if (this.store.get().findOpen && this.input.value) void this.search(this.input.value, false);
  }

  setDocument(doc: PageSource | null): void {
    if (doc === this.doc) return;
    this.doc = doc;
    this.cancelPending();
    this.reset();
    if (this.store.get().findOpen) void this.search(this.input.value);
  }

  next(): void {
    this.step(1);
  }

  prev(): void {
    this.step(-1);
  }

  destroy(): void {
    this.cancelPending();
    this.reset();
    this.offTextLayer();
    this.input.removeEventListener('keydown', this.onKeydown);
  }

  // ---- searching --------------------------------------------------------------

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      // Enter while a search is still debounced commits it (lands on the first match).
      if (this.debounce) void this.search(this.input.value);
      else this.step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  private scheduleSearch(): void {
    clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => {
      this.debounce = 0;
      void this.search(this.input.value);
    }, FIND_DEBOUNCE_MS);
  }

  private cancelPending(): void {
    clearTimeout(this.debounce);
    this.debounce = 0;
    this.seq++;
  }

  private async search(query: string, reveal = true): Promise<void> {
    this.cancelPending();
    const seq = this.seq;
    this.activeQuery = query;
    this.reset();
    this.store.set({ findQuery: query, findTotal: 0, findIndex: -1 });
    const doc = this.doc;
    if (!doc || query.trim() === '') {
      this.publish();
      return;
    }
    if (!indexReady.has(doc)) this.countEl.textContent = 'Searching…';
    let pages: PageTextIndex[];
    try {
      pages = await textIndex(doc);
    } catch {
      if (seq === this.seq) this.publish();
      return;
    }
    if (seq !== this.seq) return;
    this.matches = findMatches(query, pages);
    ({ ranges: this.ranges, firstItem: this.firstItem } = groupRanges(pages, this.matches));
    this.current = this.matches.length > 0 ? 0 : -1;
    for (const index of this.viewer.getMountedPages().keys()) this.applyPage(index);
    this.publish();
    if (reveal) this.reveal(seq);
  }

  private step(dir: 1 | -1): void {
    const n = this.matches.length;
    if (n === 0) return;
    const prev = this.current;
    this.current = (this.current + dir + n) % n;
    const prevPage = this.matches[prev]?.pageIndex;
    const page = this.matches[this.current]!.pageIndex;
    if (prevPage != null) this.applyPage(prevPage);
    if (page !== prevPage) this.applyPage(page);
    this.publish();
    this.reveal(this.seq);
  }

  /** Drops matches and every `<mark>`; leaves the field text and store fields alone. */
  private reset(): void {
    for (const divs of this.marked.values()) divs.forEach(unwrap);
    this.marked.clear();
    this.matches = [];
    this.firstItem = [];
    this.ranges = new Map();
    this.current = -1;
    this.pendingReveal = -1;
  }

  /** Writes the count label, button state and store fields for the current result set. */
  private publish(): void {
    const total = this.matches.length;
    const idle = this.activeQuery.trim() === '' || !this.doc;
    this.countEl.textContent = idle ? '' : total === 0 ? 'No results' : `${this.current + 1} of ${total}`;
    this.host.classList.toggle('no-results', !idle && total === 0);
    this.prevBtn.disabled = total === 0;
    this.nextBtn.disabled = total === 0;
    const s = this.store.get();
    if (s.findTotal !== total || s.findIndex !== this.current) {
      this.store.set({ findTotal: total, findIndex: this.current });
    }
  }

  // ---- highlights -------------------------------------------------------------

  private onTextLayer(index: number, divs: HTMLElement[]): void {
    if (!this.ranges.has(index)) {
      this.marked.delete(index);
      return;
    }
    this.applyPage(index, divs);
    const m = this.matches[this.current];
    if (m && m.pageIndex === index && this.pendingReveal === this.current) {
      this.pendingReveal = -1;
      const mark = this.currentMark(index);
      if (mark) nudgeIntoView(mark);
    }
  }

  /** (Re)wraps the matched ranges of page `index` in its current text divs. */
  private applyPage(index: number, divs: HTMLElement[] = this.viewer.getTextDivs(index)): void {
    const items = this.ranges.get(index);
    const touched = new Set<HTMLElement>();
    if (items && divs.length > 0) {
      for (const [item, list] of items) {
        const div = divs[item];
        if (!div) continue;
        wrapRanges(div, list, this.current);
        touched.add(div);
      }
    }
    // Divs marked earlier for this page but not touched now belong to a replaced text layer.
    for (const div of this.marked.get(index) ?? []) if (!touched.has(div)) unwrap(div);
    if (touched.size > 0) this.marked.set(index, [...touched]);
    else this.marked.delete(index);
  }

  private currentMark(index: number): HTMLElement | null {
    const pageEl = this.viewer.getMountedPages().get(index);
    return pageEl?.querySelector<HTMLElement>('mark.find-current') ?? null;
  }

  // ---- scrolling --------------------------------------------------------------

  /** Scrolls so the current match is visible: no-op when it already is. */
  private reveal(seq: number): void {
    const m = this.matches[this.current];
    if (!m) return;
    const mark = this.currentMark(m.pageIndex);
    if (mark && isInView(mark)) {
      this.pendingReveal = -1;
      return;
    }
    void this.scrollToMatch(m, this.current, seq);
  }

  /**
   * Positions the match `MATCH_MARGIN_PT` below the viewport top using the text item's
   * geometry: `transform[5]` is the baseline in PDF user space (origin bottom-left), so the
   * distance from the page's top edge is `height - baseline - itemHeight`.
   */
  private async scrollToMatch(m: Match, matchIndex: number, seq: number): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    let top = 0;
    try {
      const items = await doc.getPageText(m.pageIndex);
      const item = items[this.firstItem[matchIndex] ?? 0];
      const size = doc.sizes[m.pageIndex];
      if (item && size) top = size.height - (item.transform[5] ?? 0) - item.height;
    } catch {
      return;
    }
    if (seq !== this.seq || this.current !== matchIndex || this.matches[matchIndex] !== m) return;
    this.viewer.goToPage(m.pageIndex, Math.max(0, top - MATCH_MARGIN_PT));
    const mark = this.currentMark(m.pageIndex);
    if (mark) nudgeIntoView(mark);
    else this.pendingReveal = matchIndex; // the text layer arrives later via onTextLayer
  }
}
