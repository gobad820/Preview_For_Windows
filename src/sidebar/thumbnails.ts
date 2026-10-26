import type { PdfDocument } from '../pdf/document';
import { CSS_UNITS, type PageRenderer, type RenderHandle } from '../pdf/renderer';
import type { Store, ViewerState } from '../store';
import type { Rotation } from '../types';

/** CSS width of every thumbnail canvas. */
export const THUMB_WIDTH = 160;
/** Thumbnails within this many pixels of the panel's viewport are rendered; others release their canvas. */
const ROOT_MARGIN = '400px 0px';

export interface ThumbnailDeps {
  goToPage(index: number): void;
}

interface Thumb {
  el: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  /** Inside the observer's root margin; the only thumbs that hold pixels. */
  near: boolean;
  renderedKey: string | null;
  renderingKey: string | null;
  render: RenderHandle | null;
}

/**
 * One `button.thumb[data-page=N]` per page. Canvases are rendered lazily through an
 * `IntersectionObserver` rooted at the panel scroller and released again when they scroll far away,
 * so a 300-page document never holds more than a screenful of bitmaps.
 */
export class ThumbnailList {
  private doc: PdfDocument | null = null;
  private renderer: PageRenderer | null = null;
  private thumbs: Thumb[] = [];
  private observer: IntersectionObserver | null = null;
  private rotation: Rotation = 0;
  private current = 0;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly store: Store<ViewerState>,
    private readonly deps: ThumbnailDeps,
  ) {
    scroller.addEventListener('click', this.onClick);
    this.unsubscribe = store.select('rotation', (r) => this.setRotation(r));
  }

  setDocument(doc: PdfDocument | null, renderer: PageRenderer | null): void {
    this.clear();
    this.doc = doc;
    this.renderer = renderer;
    if (!doc) return;
    this.observer = new IntersectionObserver(this.onIntersect, { root: this.scroller, rootMargin: ROOT_MARGIN });
    const frag = document.createDocumentFragment();
    for (let i = 0; i < doc.numPages; i++) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'thumb';
      el.tabIndex = -1;
      el.dataset['page'] = String(i + 1);
      el.setAttribute('aria-label', `Page ${i + 1}`);
      const canvas = document.createElement('canvas');
      canvas.width = 0;
      canvas.height = 0;
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = String(i + 1);
      el.append(canvas, label);
      frag.append(el);
      const thumb: Thumb = { el, canvas, near: false, renderedKey: null, renderingKey: null, render: null };
      this.thumbs.push(thumb);
      this.placeholder(thumb, i);
      this.observer.observe(el);
    }
    this.scroller.append(frag);
    this.setCurrent(this.store.get().currentPage);
  }

  /** Call after `PdfDocument.loadSizes` filled in more sizes so placeholders take their real aspect. */
  sizesChanged(): void {
    this.thumbs.forEach((t, i) => {
      if (t.renderedKey === null) this.placeholder(t, i);
    });
  }

  /** Highlights page `page` (1-based) and keeps it inside the panel's viewport. */
  setCurrent(page: number): void {
    const prev = this.thumbs[this.current - 1];
    prev?.el.classList.remove('current');
    prev?.el.removeAttribute('aria-current');
    this.current = page;
    const next = this.thumbs[page - 1];
    if (!next) return;
    next.el.classList.add('current');
    next.el.setAttribute('aria-current', 'page');
    this.scrollCurrentIntoView();
  }

  /** No-op while the panel has no layout (hidden); call again once it is shown. */
  scrollCurrentIntoView(): void {
    const t = this.thumbs[this.current - 1];
    if (!t || this.scroller.clientHeight === 0) return;
    t.el.scrollIntoView({ block: 'nearest' });
  }

  destroy(): void {
    this.clear();
    this.unsubscribe();
    this.scroller.removeEventListener('click', this.onClick);
  }

  // ---- internals ----------------------------------------------------------

  private readonly onClick = (e: MouseEvent): void => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('.thumb');
    const page = Number(btn?.dataset['page']);
    if (btn && page > 0) this.deps.goToPage(page - 1);
  };

  private readonly onIntersect = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      const t = this.thumbs[Number((entry.target as HTMLElement).dataset['page']) - 1];
      if (!t) continue;
      t.near = entry.isIntersecting;
      if (t.near) void this.ensureRendered(t);
      else this.release(t);
    }
  };

  private setRotation(rotation: Rotation): void {
    if (rotation === this.rotation) return;
    this.rotation = rotation;
    for (const t of this.thumbs) {
      if (t.near) void this.ensureRendered(t);
      else this.release(t);
    }
    this.thumbs.forEach((t, i) => {
      if (t.renderedKey === null) this.placeholder(t, i);
    });
  }

  private renderKey(): string {
    return `${this.rotation}|${window.devicePixelRatio || 1}`;
  }

  /** Sets the placeholder height from the (possibly provisional) page size. */
  private placeholder(t: Thumb, index: number): void {
    const size = this.doc?.sizes[index];
    if (!size) return;
    const landscape = this.rotation % 180 !== 0;
    const w = landscape ? size.height : size.width;
    const h = landscape ? size.width : size.height;
    this.setHeight(t, (THUMB_WIDTH * h) / w);
  }

  private setHeight(t: Thumb, height: number): void {
    t.el.style.setProperty('--thumb-h', `${Math.max(1, Math.round(height))}px`);
  }

  private async ensureRendered(t: Thumb): Promise<void> {
    const doc = this.doc;
    const renderer = this.renderer;
    if (!doc || !renderer) return;
    const key = this.renderKey();
    if (t.renderedKey === key || t.renderingKey === key) return;
    t.render?.cancel();
    t.render = null;
    t.renderingKey = key;
    const index = Number(t.el.dataset['page']) - 1;
    try {
      const page = await doc.getPage(index);
      if (this.doc !== doc || t.renderingKey !== key || !t.near) return;
      const rotation = ((page.rotate + this.rotation) % 360) as Rotation;
      const view = page.getViewport({ scale: 1, rotation });
      this.setHeight(t, (THUMB_WIDTH * view.height) / view.width);
      const canvas = document.createElement('canvas');
      const handle = renderer.render({
        index,
        scale: THUMB_WIDTH / (view.width * CSS_UNITS),
        rotation: this.rotation,
        canvas,
        dpr: window.devicePixelRatio || 1,
      });
      t.render = handle;
      await handle.done;
      if (t.render !== handle || this.doc !== doc) return; // cancelled or superseded
      t.canvas.replaceWith(canvas);
      t.canvas = canvas;
      canvas.dataset['rendered'] = 'true';
      t.renderedKey = key;
      t.renderingKey = null;
      t.render = null;
    } catch (err) {
      if (t.renderingKey === key) t.renderingKey = null;
      console.error(`thumbnail render failed for page ${index + 1}`, err);
    }
  }

  /** Cancels any in-flight render and drops the bitmap; the CSS placeholder keeps its size. */
  private release(t: Thumb): void {
    t.render?.cancel();
    t.render = null;
    t.renderingKey = null;
    if (t.renderedKey !== null) {
      t.renderedKey = null;
      t.canvas.width = 0;
      t.canvas.height = 0;
      delete t.canvas.dataset['rendered'];
    }
  }

  private clear(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.renderer?.cancelAll();
    for (const t of this.thumbs) {
      t.render?.cancel();
      t.el.remove();
    }
    this.thumbs = [];
    this.current = 0;
    this.doc = null;
    this.renderer = null;
  }
}
