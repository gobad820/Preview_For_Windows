import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport';
import type { PageSource } from '../pdf/source';
import { CSS_UNITS, PageRenderer, type RenderHandle } from '../pdf/renderer';
import { mountTextLayer, type TextLayerHandle } from '../pdf/textlayer';
import type { DisplayMode, Store, ViewerState } from '../store';
import type { Rotation, ZoomMode } from '../types';
import {
  anchoredScroll,
  computeLayout,
  currentPageIndex,
  docPointAt,
  fitPageScale,
  fitWidthScale,
  rowOfPage,
  scrollLeftToReveal,
  scrollTopForPage,
  stepRow,
  visibleRange,
  yForDocPoint,
  type DocPoint,
  type Layout,
  type Spread,
} from './layout';
import { clampZoom, wheelZoom } from './zoom';

export const PAGE_GAP = 16;
export const PAGE_PADDING = 24;
/** Space between the two pages of a row in Two Pages, CSS px. */
export const SPINE_GAP = 8;
/** Pages within this many viewport heights of the visible area stay mounted. */
const OVERSCAN_VIEWPORTS = 0.5;
const RESIZE_DEBOUNCE_MS = 100;

export type TextLayerListener = (index: number, el: HTMLElement, textDivs: HTMLElement[]) => void;

/** A page on screen as an overlay sees it (document view or thumbnail). */
export interface PageView {
  /** Current position in the document. */
  readonly index: number;
  /** Element an overlay appends to and fills (positioned). */
  readonly el: HTMLElement;
  /** pdf.js viewport in CSS px: scale × CSS_UNITS, the page's /Rotate plus the view rotation. */
  readonly viewport: PageViewport;
  /** `hideGeneration` the visible canvas was rendered with; -1 before the first render. */
  readonly canvasGeneration: number;
  /** True in the document view, false for thumbnails. */
  readonly interactive: boolean;
}

export type PageViewListener = (view: PageView) => void;
export type PageGoneListener = (el: HTMLElement) => void;

export interface ViewerHooks {
  onFirstPaint?: () => void;
}

interface MountedPage {
  /** Current position; changes when the document's structure changes. */
  index: number;
  /** `PageSource.pageKey` of the page this element shows. */
  key: string;
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  textHost: HTMLElement;
  renderedKey: string | null;
  renderingKey: string | null;
  render: RenderHandle | null;
  text: TextLayerHandle | null;
  textDivs: HTMLElement[];
  /** CSS-px viewport for `viewKey` (scale|rotation), once the page proxy was fetched. */
  viewport: PageViewport | null;
  viewKey: string | null;
  canvasGeneration: number;
}

const EMPTY_LAYOUT: Layout = { pages: [], rows: [], totalHeight: 0, contentWidth: 0, padding: PAGE_PADDING };

/** Continuous, virtualised page view inside a scroll container. */
export class PdfViewer {
  private doc: PageSource | null = null;
  private renderer: PageRenderer | null = null;
  private layout: Layout = EMPTY_LAYOUT;
  private readonly layer: HTMLElement;
  private mounted = new Map<number, MountedPage>();
  private readonly textListeners = new Set<TextLayerListener>();
  private readonly viewListeners = new Set<PageViewListener>();
  private readonly goneListeners = new Set<PageGoneListener>();
  private scale = 1;
  private zoomMode: ZoomMode = 'fit-width';
  private rotation: Rotation = 0;
  private spread: Spread = 'none';
  /** The page last gone to and the scroll position that put it there; it stays current until the view scrolls. */
  private navTarget: { index: number; scrollTop: number } | null = null;
  private scrollRaf = 0;
  private resizeTimer = 0;
  private painted = false;
  private readonly resizeObserver: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly store: Store<ViewerState>,
    private readonly hooks: ViewerHooks = {},
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'page-layer';
    container.append(this.layer);
    container.addEventListener('scroll', this.onScroll, { passive: true });
    container.addEventListener('wheel', this.onWheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.watchDpr();
  }

  // ---- document lifecycle -------------------------------------------------

  async setDocument(doc: PageSource | null): Promise<void> {
    this.unmountAll();
    this.renderer?.cancelAll();
    this.doc = doc;
    this.renderer = doc ? new PageRenderer(doc) : null;
    this.painted = false;
    this.layout = EMPTY_LAYOUT;
    this.container.scrollTop = 0;
    this.container.scrollLeft = 0;
    if (!doc) {
      this.layer.style.height = '0px';
      this.layer.style.width = '';
      return;
    }
    const s = this.store.get();
    this.zoomMode = s.zoomMode;
    this.rotation = s.rotation;
    this.scale = this.computeScale(s.zoomMode, s.scale);
    this.relayout(null);
    this.store.set({ scale: this.scale, zoomMode: this.zoomMode, rotation: this.rotation });
    this.syncCurrentPage();
  }

  /**
   * Call after pages were moved, inserted or deleted. Elements of pages that are still near
   * the viewport are reused (no re-render); `anchor` is the document point to keep at the
   * top of the viewport, in new positions.
   */
  structureChanged(anchor?: DocPoint, where: 'top' | 'center' = 'top'): void {
    const doc = this.doc;
    if (!doc) return;
    const old = [...this.mounted.values()];
    for (const mp of old) {
      if (mp.render) {
        mp.render.cancel();
        mp.render = null;
        mp.renderingKey = null;
      }
    }
    this.mounted = new Map();
    if (this.zoomMode !== 'custom') this.scale = this.computeScale(this.zoomMode, this.scale);
    this.relayout(null, false);
    if (anchor && this.layout.pages.length > 0) {
      const offset = where === 'center' ? this.container.clientHeight / 2 : 0;
      this.container.scrollTop = Math.max(0, yForDocPoint(this.layout, anchor) - offset);
    }
    const spare = new Map<string, MountedPage[]>();
    for (const mp of old) {
      const list = spare.get(mp.key) ?? [];
      list.push(mp);
      spare.set(mp.key, list);
    }
    const { scrollTop, clientHeight } = this.container;
    const range = visibleRange(this.layout, scrollTop, clientHeight, clientHeight * OVERSCAN_VIEWPORTS);
    if (range) {
      for (let i = range.first; i <= range.last; i++) {
        const mp = spare.get(doc.pageKey(i))?.pop();
        if (!mp) continue;
        mp.index = i;
        mp.el.dataset['page'] = String(i + 1);
        this.position(mp, i);
        this.mounted.set(i, mp);
        if (mp.textDivs.length > 0) for (const l of this.textListeners) l(i, mp.el, mp.textDivs);
      }
    }
    for (const list of spare.values()) {
      for (const mp of list) {
        mp.text?.cancel();
        mp.el.remove();
        this.emitGone(mp.el);
      }
    }
    if (this.store.get().scale !== this.scale) this.store.set({ scale: this.scale });
    this.updateMounted();
    this.syncCurrentPage();
  }

  /** The document point at the middle of the viewport (normally on the current page). */
  centerAnchor(): DocPoint {
    const { scrollTop, scrollLeft, clientHeight, clientWidth } = this.container;
    return docPointAt(this.layout, scrollTop + clientHeight / 2, scrollLeft + clientWidth / 2);
  }

  /** The document point at the top edge of the viewport. */
  topAnchor(): DocPoint {
    return docPointAt(this.layout, this.container.scrollTop);
  }

  /** Call after `loadSizes` updates a batch so placeholders take their real size. */
  sizesChanged(): void {
    if (!this.doc) return;
    if (this.zoomMode !== 'custom') this.scale = this.computeScale(this.zoomMode, this.scale);
    this.relayout({ x: 0, y: 0 });
    if (this.store.get().scale !== this.scale) this.store.set({ scale: this.scale });
  }

  destroy(): void {
    this.unmountAll();
    this.renderer?.cancelAll();
    this.resizeObserver.disconnect();
    this.container.removeEventListener('scroll', this.onScroll);
    this.container.removeEventListener('wheel', this.onWheel);
    cancelAnimationFrame(this.scrollRaf);
    clearTimeout(this.resizeTimer);
    this.layer.remove();
  }

  // ---- navigation ---------------------------------------------------------

  /**
   * Scrolls so the row of page `index` (0-based) starts at the top and makes that page the
   * current one; `top` is PDF points from the page's top edge.
   */
  goToPage(index: number, top?: number): void {
    if (!this.doc || this.layout.pages.length === 0) return;
    const i = Math.min(Math.max(0, index), this.layout.pages.length - 1);
    let y = scrollTopForPage(this.layout, i);
    if (top != null && this.rotation === 0) {
      y = Math.max(0, this.layout.pages[i]!.top + top * this.scale * CSS_UNITS - PAGE_PADDING);
    }
    this.container.scrollTop = y;
    // In a zoomed Two Pages row the page may sit beside the viewport.
    this.container.scrollLeft = scrollLeftToReveal(this.layout, i, this.container.scrollLeft, this.container.clientWidth);
    this.navTarget = { index: i, scrollTop: this.container.scrollTop };
    this.syncCurrentPage();
    this.updateMounted();
  }

  /** Goes to the first page of the next (1) or previous (-1) row. */
  stepPage(dir: 1 | -1): void {
    if (!this.doc || this.layout.pages.length === 0) return;
    const current = Math.max(0, this.store.get().currentPage - 1);
    const target = stepRow(this.layout, current, dir);
    if (dir === 1 && target < current) return; // the right page of the last row: → would go back
    this.goToPage(target);
  }

  /** True when the layout is wider than the viewport (arrow keys pan instead of paging). */
  overflowsHorizontally(): boolean {
    return this.container.scrollWidth > this.container.clientWidth + 1;
  }

  panBy(dx: number): void {
    this.container.scrollBy({ left: dx });
  }

  scrollByViewport(dir: 1 | -1): void {
    this.container.scrollBy({ top: dir * Math.max(40, this.container.clientHeight - PAGE_GAP * 2) });
  }

  // ---- zoom / rotation ----------------------------------------------------

  /** `anchor` is the container-relative point that stays fixed; defaults to the viewport center. */
  setZoom(mode: ZoomMode, scale?: number, anchor?: { x: number; y: number }): void {
    if (!this.doc) {
      this.store.set({ zoomMode: mode, scale: scale != null ? clampZoom(scale) : this.store.get().scale });
      return;
    }
    this.zoomMode = mode;
    this.scale = this.computeScale(mode, scale ?? this.scale);
    this.relayout(anchor ?? this.center());
    this.store.set({ zoomMode: this.zoomMode, scale: this.scale });
    this.syncCurrentPage();
  }

  /** One page per row or two (Book Mode: the first page alone on the right); keeps the center page in view. */
  setDisplay(mode: DisplayMode, book: boolean): void {
    const spread: Spread = mode === 'two-pages' ? (book ? 'book' : 'pairs') : 'none';
    if (spread === this.spread) return;
    this.spread = spread;
    if (!this.doc) return;
    if (this.zoomMode !== 'custom') this.scale = this.computeScale(this.zoomMode, this.scale);
    this.relayout(this.currentPagePoint() ?? this.center());
    if (this.store.get().scale !== this.scale) this.store.set({ scale: this.scale });
    this.syncCurrentPage();
  }

  setRotation(rotation: Rotation): void {
    this.rotation = rotation;
    if (this.doc) {
      if (this.zoomMode !== 'custom') this.scale = this.computeScale(this.zoomMode, this.scale);
      this.relayout(this.center());
    }
    this.store.set({ rotation, scale: this.scale });
    this.syncCurrentPage();
  }

  // ---- introspection ------------------------------------------------------

  getMountedPages(): Map<number, HTMLElement> {
    const out = new Map<number, HTMLElement>();
    for (const [i, mp] of this.mounted) out.set(i, mp.el);
    return out;
  }

  getTextDivs(index: number): HTMLElement[] {
    return this.mounted.get(index)?.textDivs ?? [];
  }

  /** Document point under a viewport (client) coordinate. */
  docPointAtClient(clientX: number, clientY: number): DocPoint {
    const rect = this.container.getBoundingClientRect();
    return docPointAt(
      this.layout,
      this.container.scrollTop + (clientY - rect.top),
      this.container.scrollLeft + (clientX - rect.left),
    );
  }

  getLayout(): Layout {
    return this.layout;
  }

  onTextLayer(cb: TextLayerListener): () => void {
    this.textListeners.add(cb);
    return () => this.textListeners.delete(cb);
  }

  /** Fires after a page is mounted, after each canvas swap, and when its scale, rotation or position changes. */
  onPageView(cb: PageViewListener): () => void {
    this.viewListeners.add(cb);
    return () => this.viewListeners.delete(cb);
  }

  /** Fires when a page element leaves the document view. */
  onPageGone(cb: PageGoneListener): () => void {
    this.goneListeners.add(cb);
    return () => this.goneListeners.delete(cb);
  }

  /** The current views of the mounted pages, in position order. */
  getPageViews(): PageView[] {
    const out: PageView[] = [];
    for (const mp of [...this.mounted.values()].sort((a, b) => a.index - b.index)) {
      const view = this.viewOf(mp);
      if (view) out.push(view);
    }
    return out;
  }

  /** Re-renders mounted canvases whose `hideGeneration` changed (own annotations became overlays). */
  annotationsChanged(): void {
    for (const [i, mp] of this.mounted) this.ensureRendered(mp, i);
  }

  // ---- internals ----------------------------------------------------------

  private get dpr(): number {
    return window.devicePixelRatio || 1;
  }

  private center(): { x: number; y: number } {
    return { x: this.container.clientWidth / 2, y: this.container.clientHeight / 2 };
  }

  /**
   * A viewport point on the current page, as near the viewport center as it allows; null when
   * the page is off screen. Anchoring on it keeps a right-hand current page through a layout change.
   */
  private currentPagePoint(): { x: number; y: number } | null {
    const page = this.layout.pages[this.store.get().currentPage - 1];
    if (!page) return null;
    const { scrollTop, scrollLeft, clientWidth, clientHeight } = this.container;
    const left = Math.max(0, page.left - scrollLeft);
    const right = Math.min(clientWidth, page.left + page.width - scrollLeft);
    const top = Math.max(0, page.top - scrollTop);
    const bottom = Math.min(clientHeight, page.top + page.height - scrollTop);
    if (left >= right || top >= bottom) return null;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    return { x: clamp(clientWidth / 2, left, right), y: clamp(clientHeight / 2, top, bottom) };
  }

  private computeScale(mode: ZoomMode, fallback: number): number {
    if (!this.doc) return clampZoom(fallback);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (mode === 'fit-width' && w > 0) {
      return clampZoom(fitWidthScale(this.doc.sizes, this.rotation, w, PAGE_PADDING, this.spread, SPINE_GAP));
    }
    if (mode === 'fit-page' && w > 0 && h > 0) {
      return clampZoom(fitPageScale(this.doc.sizes, this.rotation, w, h, PAGE_PADDING, this.spread, SPINE_GAP));
    }
    return clampZoom(fallback);
  }

  /** Recomputes the layout; keeps the document point under `anchor` fixed when given. */
  /** `mount: false` leaves mounting to the caller (structure changes reuse elements first). */
  private relayout(anchor: { x: number; y: number } | null, mount = true): void {
    if (!this.doc) return;
    const old = this.layout;
    const next = computeLayout(this.doc.sizes, {
      scale: this.scale,
      rotation: this.rotation,
      gap: PAGE_GAP,
      padding: PAGE_PADDING,
      containerWidth: this.container.clientWidth,
      spread: this.spread,
      spineGap: SPINE_GAP,
    });
    this.layout = next;
    this.layer.style.height = `${next.totalHeight}px`;
    this.layer.style.width = `${next.contentWidth}px`;
    if (anchor && old.pages.length > 0) {
      const { scrollTop, scrollLeft } = this.container;
      const { top, left } = anchoredScroll(old, next, { top: scrollTop, left: scrollLeft }, anchor);
      this.container.scrollTop = top;
      this.container.scrollLeft = left;
    }
    for (const [i, mp] of this.mounted) this.position(mp, i);
    if (mount) this.updateMounted();
  }

  private position(mp: MountedPage, index: number): void {
    const r = this.layout.pages[index];
    if (!r) return;
    mp.el.style.top = `${r.top}px`;
    mp.el.style.left = `${r.left}px`;
    mp.el.style.width = `${r.width}px`;
    mp.el.style.height = `${r.height}px`;
    mp.el.style.setProperty('--scale-factor', String(this.scale * CSS_UNITS));
    this.refreshView(mp);
  }

  private viewOf(mp: MountedPage): PageView | null {
    if (!mp.viewport || mp.viewKey !== this.viewKey()) return null;
    return { index: mp.index, el: mp.el, viewport: mp.viewport, canvasGeneration: mp.canvasGeneration, interactive: true };
  }

  private viewKey(): string {
    return `${this.scale}|${this.rotation}`;
  }

  /** Emits the page's view, fetching its viewport first when the scale or rotation changed. */
  private refreshView(mp: MountedPage): void {
    const doc = this.doc;
    if (!doc) return;
    const key = this.viewKey();
    if (mp.viewport && mp.viewKey === key) {
      this.emitView(mp);
      return;
    }
    const index = mp.index;
    void doc
      .getPage(index)
      .then((page) => {
        if (this.doc !== doc || mp.index !== index || this.mounted.get(index) !== mp || this.viewKey() !== key) return;
        mp.viewport = page.getViewport({ scale: this.scale * CSS_UNITS, rotation: (page.rotate + this.rotation) % 360 });
        mp.viewKey = key;
        this.emitView(mp);
      })
      .catch(() => {});
  }

  private emitView(mp: MountedPage): void {
    const view = this.viewOf(mp);
    if (view) for (const l of this.viewListeners) l(view);
  }

  private emitGone(el: HTMLElement): void {
    for (const l of this.goneListeners) l(el);
  }

  private readonly onScroll = (): void => {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.syncCurrentPage();
      this.updateMounted();
    });
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey || !this.doc) return;
    e.preventDefault();
    const rect = this.container.getBoundingClientRect();
    this.setZoom('custom', wheelZoom(this.scale, e.deltaY), {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  private onResize(): void {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      if (!this.doc) return;
      if (this.zoomMode !== 'custom') this.scale = this.computeScale(this.zoomMode, this.scale);
      this.relayout(this.center());
      if (this.store.get().scale !== this.scale) this.store.set({ scale: this.scale });
    }, RESIZE_DEBOUNCE_MS);
  }

  private watchDpr(): void {
    this.dprQuery = window.matchMedia(`(resolution: ${this.dpr}dppx)`);
    const onChange = () => {
      this.dprQuery?.removeEventListener('change', onChange);
      for (const [i, mp] of this.mounted) this.ensureRendered(mp, i);
      this.watchDpr();
    };
    this.dprQuery.addEventListener('change', onChange);
  }

  /**
   * The current page is the first (left) page of the most visible row, except: the page last
   * gone to while the view has not scrolled since (a short last row cannot reach the top),
   * and a page of that same row that was current already (the right page of a spread).
   */
  private syncCurrentPage(): void {
    if (!this.doc) return;
    const { scrollTop, clientHeight } = this.container;
    const layout = this.layout;
    let idx = currentPageIndex(layout, scrollTop, clientHeight);
    const nav = this.navTarget;
    const target = nav && nav.scrollTop === scrollTop ? layout.pages[nav.index] : undefined;
    if (target && target.top < scrollTop + clientHeight && target.top + target.height > scrollTop) {
      idx = target.index;
    } else {
      this.navTarget = null;
      const current = this.store.get().currentPage - 1;
      if (current >= 0 && current < layout.pages.length && rowOfPage(layout, current) === rowOfPage(layout, idx)) {
        idx = current;
      }
    }
    const page = idx + 1;
    if (page > 0 && this.store.get().currentPage !== page) this.store.set({ currentPage: page });
  }

  private updateMounted(): void {
    if (!this.doc || !this.renderer) return;
    const { scrollTop, clientHeight } = this.container;
    const range = visibleRange(this.layout, scrollTop, clientHeight, clientHeight * OVERSCAN_VIEWPORTS);
    for (const [i, mp] of this.mounted) {
      if (!range || i < range.first || i > range.last) this.unmount(mp, i);
    }
    if (!range) return;
    const current = currentPageIndex(this.layout, scrollTop, clientHeight);
    const order: number[] = [];
    for (let i = range.first; i <= range.last; i++) order.push(i);
    order.sort((a, b) => Math.abs(a - current) - Math.abs(b - current));
    for (const i of order) {
      let mp = this.mounted.get(i);
      if (!mp) {
        mp = this.mount(i);
      }
      this.ensureRendered(mp, i);
    }
  }

  private mount(index: number): MountedPage {
    const el = document.createElement('div');
    el.className = 'page loading';
    el.dataset['page'] = String(index + 1);
    const canvas = document.createElement('canvas');
    const textHost = document.createElement('div');
    textHost.className = 'textLayer';
    el.append(canvas, textHost);
    const mp: MountedPage = {
      index,
      key: this.doc!.pageKey(index),
      el,
      canvas,
      textHost,
      renderedKey: null,
      renderingKey: null,
      render: null,
      text: null,
      textDivs: [],
      viewport: null,
      viewKey: null,
      canvasGeneration: -1,
    };
    this.layer.append(el);
    this.mounted.set(index, mp);
    this.position(mp, index);
    return mp;
  }

  private unmount(mp: MountedPage, index: number): void {
    mp.render?.cancel();
    mp.text?.cancel();
    mp.el.remove();
    this.mounted.delete(index);
    this.emitGone(mp.el);
    this.releasePage(index, mp.key);
  }

  /** Frees the page's operator list and decoded images once nothing on screen uses it. */
  private releasePage(index: number, key: string): void {
    const doc = this.doc;
    if (!doc || index >= doc.numPages) return;
    void doc
      .getPage(index)
      .then((page) => {
        if (this.doc !== doc) return;
        for (const mp of this.mounted.values()) if (mp.key === key) return;
        page.cleanup(); // returns false (no-op) while another render, e.g. a thumbnail, is pending
      })
      .catch(() => {});
  }

  private unmountAll(): void {
    for (const [i, mp] of this.mounted) this.unmount(mp, i);
  }

  private generation(index: number): number {
    return this.doc?.hideGeneration?.(index) ?? 0;
  }

  private renderKey(index: number): string {
    return `${this.scale}|${this.rotation}|${this.dpr}|${this.generation(index)}`;
  }

  private ensureRendered(mp: MountedPage, index: number): void {
    if (!this.renderer) return;
    const generation = this.generation(index);
    const key = this.renderKey(index);
    if (mp.renderedKey === key || mp.renderingKey === key) return;
    mp.render?.cancel();
    mp.text?.cancel();
    mp.text = null;
    mp.renderingKey = key;
    const canvas = document.createElement('canvas');
    const handle = this.renderer.render({
      index,
      slot: mp,
      scale: this.scale,
      rotation: this.rotation,
      canvas,
      dpr: this.dpr,
    });
    mp.render = handle;
    handle.done
      .then(() => {
        if (mp.render !== handle || this.mounted.get(mp.index) !== mp) return;
        if (this.renderKey(mp.index) !== key) return; // stale: a newer render is on its way
        const sameScale = mp.renderedKey?.split('|').slice(0, 3).join('|') === key.split('|').slice(0, 3).join('|');
        mp.canvas.replaceWith(canvas);
        mp.canvas = canvas;
        canvas.dataset['rendered'] = 'true';
        mp.el.classList.remove('loading');
        mp.renderedKey = key;
        mp.renderingKey = null;
        mp.render = null;
        mp.canvasGeneration = generation;
        this.firstPaint();
        this.emitView(mp);
        // A re-render that only hid annotations keeps the text layer that is already there.
        if (!sameScale || mp.textDivs.length === 0) void this.mountText(mp, key);
      })
      .catch((err: unknown) => {
        mp.renderingKey = null;
        console.error(`render failed for page ${index + 1}`, err);
      });
  }

  private firstPaint(): void {
    if (this.painted) return;
    this.painted = true;
    this.hooks.onFirstPaint?.();
  }

  private async mountText(mp: MountedPage, key: string): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const index = mp.index;
    let page: PDFPageProxy;
    try {
      page = await doc.getPage(index);
      const content = await doc.getTextContent(index);
      if (this.mounted.get(mp.index) !== mp || mp.renderedKey !== key || mp.index !== index) return;
      const viewport = page.getViewport({
        scale: this.scale * CSS_UNITS,
        rotation: (page.rotate + this.rotation) % 360,
      });
      const handle = mountTextLayer(page, content, viewport, mp.textHost);
      mp.text = handle;
      const divs = await handle.done;
      if (mp.text !== handle || this.mounted.get(mp.index) !== mp) return;
      mp.textDivs = divs;
      for (const l of this.textListeners) l(mp.index, mp.el, divs);
    } catch (err) {
      console.error(`text layer failed for page ${index + 1}`, err);
    }
  }
}
