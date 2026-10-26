import type { Editor } from '../edit/editor';
import { CSS_UNITS, type PageRenderer, type RenderHandle } from '../pdf/renderer';
import type { PageSource } from '../pdf/source';
import type { Point } from '../platform/types';
import type { Store, ViewerState } from '../store';
import type { Rotation } from '../types';

/** CSS width of every thumbnail canvas. */
export const THUMB_WIDTH = 160;
/** Thumbnails within this many pixels of the panel's viewport are rendered; others release their canvas. */
const ROOT_MARGIN = '400px 0px';
/** Pointer travel before a press on a thumbnail becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Distance from the panel edge where dragging auto-scrolls, and the top speed in px per frame. */
const AUTOSCROLL_ZONE = 40;
const AUTOSCROLL_MAX = 18;

export interface ThumbnailDeps {
  editor: Editor;
  /** Right-click on a thumbnail (after the selection was adjusted). */
  contextMenu(point: Point): void;
}

interface Thumb {
  el: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  label: HTMLElement;
  /** `PageSource.pageKey` of the page shown. */
  key: string;
  /** Inside the observer's root margin; the only thumbs that hold pixels. */
  near: boolean;
  renderedKey: string | null;
  renderingKey: string | null;
  render: RenderHandle | null;
}

interface Press {
  index: number;
  x: number;
  y: number;
  pointerId: number;
  /** Plain press on an already selected page: collapse the selection on release unless it becomes a drag. */
  collapseOnRelease: boolean;
}

interface Drag {
  pointerId: number;
  ghost: HTMLElement;
  gap: number;
  y: number;
  raf: number;
}

/**
 * One `button.thumb[data-page=N]` per page inside a focusable listbox. Canvases render lazily
 * through an `IntersectionObserver` and are released when they scroll far away. The list is also
 * the page editor's surface: selection, drag-to-reorder with an insertion line, keyboard
 * navigation, and a drop target for files dragged in from Explorer.
 */
export class ThumbnailList {
  private doc: PageSource | null = null;
  private renderer: PageRenderer | null = null;
  private thumbs: Thumb[] = [];
  private observer: IntersectionObserver | null = null;
  private rotation: Rotation = 0;
  private current = 0;
  private press: Press | null = null;
  private drag: Drag | null = null;
  private readonly indicator: HTMLElement;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly scroller: HTMLElement,
    private readonly store: Store<ViewerState>,
    private readonly deps: ThumbnailDeps,
  ) {
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'listbox');
    scroller.setAttribute('aria-multiselectable', 'true');
    scroller.setAttribute('aria-label', 'Pages');
    this.indicator = document.createElement('div');
    this.indicator.className = 'drop-indicator';
    this.indicator.hidden = true;
    scroller.addEventListener('pointerdown', this.onPointerDown);
    scroller.addEventListener('pointermove', this.onPointerMove);
    scroller.addEventListener('pointerup', this.onPointerUp);
    scroller.addEventListener('pointercancel', this.onPointerCancel);
    scroller.addEventListener('keydown', this.onKeyDown);
    scroller.addEventListener('contextmenu', this.onContextMenu);
    this.unsubscribe.push(
      store.select('rotation', (r) => this.setRotation(r)),
      deps.editor.onSelectionChange(() => this.renderSelection()),
    );
  }

  setDocument(doc: PageSource | null, renderer: PageRenderer | null): void {
    this.cancelDrag();
    this.clear();
    this.doc = doc;
    this.renderer = renderer;
    if (!doc) return;
    this.observer = new IntersectionObserver(this.onIntersect, { root: this.scroller, rootMargin: ROOT_MARGIN });
    const frag = document.createDocumentFragment();
    for (let i = 0; i < doc.numPages; i++) {
      const t = this.createThumb(doc.pageKey(i));
      this.thumbs.push(t);
      frag.append(t.el);
    }
    this.scroller.append(frag, this.indicator);
    this.relabel();
    this.setCurrent(this.store.get().currentPage);
    this.renderSelection();
  }

  /** Rebuilds the list after pages moved, were inserted or deleted, reusing rendered thumbnails. */
  structureChanged(): void {
    const doc = this.doc;
    if (!doc) return;
    this.cancelDrag();
    const spare = new Map<string, Thumb[]>();
    for (const t of this.thumbs) {
      // A render in flight was started for the old position; let the observer restart it.
      if (t.render) {
        t.render.cancel();
        t.render = null;
        t.renderingKey = null;
      }
      const list = spare.get(t.key) ?? [];
      list.push(t);
      spare.set(t.key, list);
    }
    const next: Thumb[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const key = doc.pageKey(i);
      next.push(spare.get(key)?.shift() ?? this.createThumb(key));
    }
    for (const list of spare.values()) {
      for (const t of list) {
        this.observer?.unobserve(t.el);
        t.el.remove();
      }
    }
    this.thumbs = next;
    const frag = document.createDocumentFragment();
    for (const t of next) frag.append(t.el);
    this.scroller.append(frag, this.indicator);
    this.relabel();
    for (const t of next) if (t.near) void this.ensureRendered(t);
    this.current = 0;
    this.setCurrent(this.store.get().currentPage);
    this.renderSelection();
  }

  /** Call after more page sizes are known so placeholders take their real aspect. */
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
    if (!this.drag) this.scrollCurrentIntoView();
  }

  /** No-op while the panel has no layout (hidden); call again once it is shown. */
  scrollCurrentIntoView(): void {
    const t = this.thumbs[this.current - 1];
    if (!t || this.scroller.clientHeight === 0) return;
    t.el.scrollIntoView({ block: 'nearest' });
  }

  // ---- drop target for files from outside -----------------------------------

  /** True when `point` (viewport CSS px) lies over the visible thumbnail list. */
  containsPoint(point: Point): boolean {
    if (this.scroller.offsetParent === null || this.scroller.hidden) return false;
    const r = this.scroller.getBoundingClientRect();
    return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
  }

  /** Gap (0..numPages) under a viewport y coordinate. */
  gapAt(clientY: number): number {
    let lo = 0;
    let hi = this.thumbs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const r = this.thumbs[mid]!.el.getBoundingClientRect();
      if (r.top + r.height / 2 < clientY) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Shows the insertion line at `gap`, or hides it with null. */
  showIndicator(gap: number | null): void {
    if (gap === null || this.thumbs.length === 0) {
      this.indicator.hidden = true;
      delete this.scroller.dataset['dropGap'];
      return;
    }
    const before = this.thumbs[gap - 1];
    const after = this.thumbs[gap];
    let y: number;
    if (before && after) y = (before.el.offsetTop + before.el.offsetHeight + after.el.offsetTop) / 2;
    else if (after) y = after.el.offsetTop - 4;
    else y = before!.el.offsetTop + before!.el.offsetHeight + 4;
    this.indicator.style.top = `${Math.round(y)}px`;
    this.indicator.hidden = false;
    this.scroller.dataset['dropGap'] = String(gap);
  }

  /** Scrolls the list when a dragged file hovers near its edges. */
  autoScrollFor(point: Point): void {
    const speed = this.edgeSpeed(point.y);
    if (speed !== 0) this.scroller.scrollTop += speed;
  }

  destroy(): void {
    this.cancelDrag();
    this.clear();
    for (const u of this.unsubscribe) u();
    this.scroller.removeEventListener('pointerdown', this.onPointerDown);
    this.scroller.removeEventListener('pointermove', this.onPointerMove);
    this.scroller.removeEventListener('pointerup', this.onPointerUp);
    this.scroller.removeEventListener('pointercancel', this.onPointerCancel);
    this.scroller.removeEventListener('keydown', this.onKeyDown);
    this.scroller.removeEventListener('contextmenu', this.onContextMenu);
  }

  // ---- pointer: select, drag, drop ---------------------------------------------

  private indexOf(target: EventTarget | null): number {
    const el = (target as Element | null)?.closest?.<HTMLElement>('.thumb');
    if (!el) return -1;
    return Number(el.dataset['page']) - 1;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const index = this.indexOf(e.target);
    this.scroller.focus({ preventScroll: true });
    if (index < 0) return;
    e.preventDefault();
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    const editor = this.deps.editor;
    let collapseOnRelease = false;
    if (mods.ctrl || mods.shift) editor.clickAt(index, mods);
    else if (!editor.isSelectedAt(index)) editor.clickAt(index, mods);
    else collapseOnRelease = true;
    this.press = { index, x: e.clientX, y: e.clientY, pointerId: e.pointerId, collapseOnRelease };
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.pointerId) {
      this.updateDrag(e.clientX, e.clientY);
      return;
    }
    const p = this.press;
    if (!p || e.pointerId !== p.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    // Ctrl+press may have just deselected the pressed page; there is nothing to drag then.
    if (!this.deps.editor.isSelectedAt(p.index)) {
      this.press = null;
      return;
    }
    this.startDrag(e);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.pointerId) {
      const gap = this.drag.gap;
      this.cancelDrag();
      this.deps.editor.moveSelectionTo(gap);
      return;
    }
    const p = this.press;
    this.press = null;
    if (p && p.collapseOnRelease && e.pointerId === p.pointerId) {
      this.deps.editor.clickAt(p.index, { ctrl: false, shift: false });
    }
  };

  private readonly onPointerCancel = (): void => {
    this.press = null;
    this.cancelDrag();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.drag && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.press = null;
      this.cancelDrag();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const editor = this.deps.editor;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') editor.step(1, e.shiftKey);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') editor.step(-1, e.shiftKey);
    else if (e.key === 'Home' && this.thumbs.length > 0) editor.clickAt(0, { ctrl: false, shift: e.shiftKey });
    else if (e.key === 'End' && this.thumbs.length > 0)
      editor.clickAt(this.thumbs.length - 1, { ctrl: false, shift: e.shiftKey });
    else return;
    e.preventDefault();
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const index = this.indexOf(e.target);
    this.scroller.focus({ preventScroll: true });
    if (index >= 0 && !this.deps.editor.isSelectedAt(index)) {
      this.deps.editor.clickAt(index, { ctrl: false, shift: false });
    }
    this.deps.contextMenu({ x: e.clientX, y: e.clientY });
  };

  private startDrag(e: PointerEvent): void {
    this.press = null;
    this.scroller.setPointerCapture(e.pointerId);
    const selected = this.deps.editor.selectedPositions();
    const ghost = this.buildGhost(selected);
    document.body.append(ghost);
    for (const i of selected) this.thumbs[i]?.el.classList.add('dragging');
    this.scroller.classList.add('is-dragging');
    this.drag = { pointerId: e.pointerId, ghost, gap: -1, y: e.clientY, raf: 0 };
    this.updateDrag(e.clientX, e.clientY);
    const tick = () => {
      if (!this.drag) return;
      const speed = this.edgeSpeed(this.drag.y);
      if (speed !== 0) {
        this.scroller.scrollTop += speed;
        this.setGap(this.gapAt(this.drag.y));
      }
      this.drag.raf = requestAnimationFrame(tick);
    };
    this.drag.raf = requestAnimationFrame(tick);
  }

  private updateDrag(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    d.y = y;
    d.ghost.style.transform = `translate(${Math.round(x + 10)}px, ${Math.round(y + 6)}px)`;
    this.setGap(this.gapAt(y));
  }

  private setGap(gap: number): void {
    if (!this.drag || this.drag.gap === gap) return;
    this.drag.gap = gap;
    this.showIndicator(gap);
  }

  private cancelDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    if (this.scroller.hasPointerCapture(d.pointerId)) this.scroller.releasePointerCapture(d.pointerId);
    for (const t of this.thumbs) t.el.classList.remove('dragging');
    this.scroller.classList.remove('is-dragging');
    this.showIndicator(null);
  }

  private edgeSpeed(clientY: number): number {
    const r = this.scroller.getBoundingClientRect();
    if (clientY < r.top + AUTOSCROLL_ZONE) {
      return -Math.ceil(AUTOSCROLL_MAX * Math.min(1, (r.top + AUTOSCROLL_ZONE - clientY) / AUTOSCROLL_ZONE));
    }
    if (clientY > r.bottom - AUTOSCROLL_ZONE) {
      return Math.ceil(AUTOSCROLL_MAX * Math.min(1, (clientY - (r.bottom - AUTOSCROLL_ZONE)) / AUTOSCROLL_ZONE));
    }
    return 0;
  }

  /** A small stack of the dragged thumbnails with a count badge. */
  private buildGhost(selected: number[]): HTMLElement {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const width = 72;
    for (const [n, i] of selected.slice(0, 3).entries()) {
      const t = this.thumbs[i];
      if (!t) continue;
      const card = document.createElement('canvas');
      const src = t.canvas;
      const ratio = src.width > 0 ? src.height / src.width : 1.414;
      card.width = width * 2;
      card.height = Math.round(width * 2 * ratio);
      card.style.width = `${width}px`;
      card.style.height = `${Math.round(width * ratio)}px`;
      card.style.setProperty('--n', String(n));
      const ctx = card.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, card.width, card.height);
        if (src.width > 0) ctx.drawImage(src, 0, 0, card.width, card.height);
      }
      ghost.prepend(card);
    }
    if (selected.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'drag-count';
      badge.textContent = String(selected.length);
      ghost.append(badge);
    }
    return ghost;
  }

  // ---- rendering -----------------------------------------------------------------

  private createThumb(key: string): Thumb {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'thumb';
    el.tabIndex = -1;
    el.setAttribute('role', 'option');
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.height = 0;
    const label = document.createElement('span');
    label.className = 'thumb-label';
    el.append(canvas, label);
    const t: Thumb = { el, canvas, label, key, near: false, renderedKey: null, renderingKey: null, render: null };
    this.observer?.observe(el);
    return t;
  }

  /** Numbers, labels and placeholder sizes follow positions. */
  private relabel(): void {
    this.thumbs.forEach((t, i) => {
      const n = String(i + 1);
      t.el.dataset['page'] = n;
      t.el.setAttribute('aria-label', `Page ${n}`);
      if (t.label.textContent !== n) t.label.textContent = n;
      if (t.renderedKey === null) this.placeholder(t, i);
    });
  }

  private renderSelection(): void {
    const editor = this.deps.editor;
    this.thumbs.forEach((t, i) => {
      const on = editor.isSelectedAt(i);
      t.el.classList.toggle('selected', on);
      t.el.setAttribute('aria-selected', String(on));
    });
  }

  private readonly onIntersect = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      const t = this.thumbs[Number((entry.target as HTMLElement).dataset['page']) - 1];
      if (!t || t.el !== entry.target) continue;
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
    const pageKey = t.key;
    try {
      const page = await doc.getPage(index);
      if (this.doc !== doc || t.renderingKey !== key || !t.near || t.key !== pageKey) return;
      if (index >= doc.numPages || doc.pageKey(index) !== pageKey) return;
      const rotation = ((page.rotate + this.rotation) % 360) as Rotation;
      const view = page.getViewport({ scale: 1, rotation });
      this.setHeight(t, (THUMB_WIDTH * view.height) / view.width);
      const canvas = document.createElement('canvas');
      const handle = renderer.render({
        index,
        slot: t,
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
    this.indicator.remove();
    this.thumbs = [];
    this.current = 0;
    this.doc = null;
    this.renderer = null;
  }
}
