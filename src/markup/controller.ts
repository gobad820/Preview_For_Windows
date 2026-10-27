/**
 * Markup interaction on the document view: creation tools, in-place text and note editing,
 * and the selected annotation. Every committed change is one `EditableDocument` update, so it
 * is one undo step; gestures in progress are only drafts on the overlay.
 */
import { annotBox, hitTest, normRect, resizeAnnot, translateAnnot } from '../annot/geometry';
import {
  NOTE_SIZE,
  type Annot,
  type MarkupAnnot,
  type NoteAnnot,
  type PdfPoint,
  type PdfRect,
  type TextAngle,
  type TextBoxAnnot,
} from '../annot/types';
import type { EditableDocument } from '../edit/document';
import { t } from '../i18n';
import type { Store, ViewerState } from '../store';
import { showMenu, type MenuItem } from '../ui/menu';
import type { PageView, PdfViewer } from '../viewer/viewer';
import { highlightMenuItems } from './bar';
import { localSize, placeBox, TEXT_LINE_HEIGHT, TEXT_PADDING, viewRect, type AnnotRef, type OverlayHost } from './overlay';
import { NOTE_COLOR, type MarkKind, type MarkupState, type Styles, type Tool } from './state';
import { selectionToMarks } from './textMarkup';

/** Pointer travel (CSS px) below which a press counts as a click. */
const CLICK_SLOP = 3;
/** Size of a shape created by a click, points (on screen: width × height). */
export const CLICK_SHAPE = { width: 100, height: 70 } as const;
/** Length of a line or arrow created by a click, points. */
export const CLICK_LINE = 100;
/** Width of a text box created by a click, points. */
export const TEXT_BOX_WIDTH = 144;
/** Ink points closer than this (points) to the previous one are dropped. */
export const INK_MIN_STEP = 1;
const NOTE_POPUP = { width: 220, height: 150, gap: 8 } as const;
/** Hit-test tolerance around strokes, CSS px. */
const HIT_TOLERANCE = 4;
/** Ctrl+D offsets the copy by this much right and down on screen, points. */
export const DUPLICATE_OFFSET = 10;
/** Smallest box a resize leaves, points. */
const MIN_BOX = 2;

export interface MarkupDeps {
  doc(): EditableDocument | null;
  viewer: PdfViewer;
  /** The viewer's scroll container; pointer input on pages arrives here. */
  container: HTMLElement;
  state: MarkupState;
  store: Store<ViewerState>;
  overlays: OverlayHost;
  /** Tells the user something went wrong (the app's error banner). */
  notify(message: string): void;
}

type ShapeTool = 'line' | 'arrow' | 'rect' | 'rounded' | 'oval';
const SHAPE_TOOLS: readonly Tool[] = ['line', 'arrow', 'rect', 'rounded', 'oval'];

interface Client {
  x: number;
  y: number;
}

interface Gesture {
  /** create: an armed tool; move / resize: the selected annotation. */
  kind: 'create' | 'move' | 'resize';
  pointerId: number;
  tool: Tool;
  pageId: number;
  id: string;
  /** Where the press was, on the screen at the time. */
  start: Client;
  /** Where the press was on the page; the anchor stays there when the view scrolls or zooms. */
  startPdf: PdfPoint;
  last: Client;
  shift: boolean;
  moved: boolean;
  ink: PdfPoint[];
  /** move / resize: the annotation when the press began. */
  original?: Annot;
  /** resize: nw, n, ne, e, se, s, sw, w, or from / to for line ends. */
  handle?: string;
}

/** A press on text markup: a click selects it, a drag selects text as usual. */
interface MarkPress {
  ref: AnnotRef;
  pointerId: number;
  start: Client;
}

interface Editing {
  ref: AnnotRef;
  annot: TextBoxAnnot | NoteAnnot;
  isNew: boolean;
  /** The element placed on the page (text box editor or note popup). */
  el: HTMLElement;
  input: HTMLTextAreaElement;
  host: HTMLElement;
  cleanup: Array<() => void>;
}

const now = () => new Date().toISOString();
const isMark = (a: Annot): a is MarkupAnnot => a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout';
/** Layer order on screen, top first: text boxes and notes, shapes, text markup. */
const layer = (a: Annot) => (a.kind === 'text' || a.kind === 'note' ? 0 : isMark(a) ? 2 : 1);
const upright = (view: PageView): TextAngle => ((((view.viewport.rotation % 360) + 360) % 360) as TextAngle);

export class MarkupController {
  private gesture: Gesture | null = null;
  private markPress: MarkPress | null = null;
  private editing: Editing | null = null;
  private selection: AnnotRef | null = null;
  /** Edits waiting for a page's annotations to be read. */
  private readonly deferred = new Set<Promise<unknown>>();

  constructor(private readonly deps: MarkupDeps) {
    const c = deps.container;
    c.addEventListener('pointerdown', this.onPointerDown, true);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerCancel);
    // Selection and focus changes come from mousedown; a press markup handles must not make them.
    c.addEventListener('mousedown', this.onMouseDown, true);
    c.addEventListener('dblclick', this.onDoubleClick);
    // The page moves under a drag that scrolls (wheel, or zoom): its draft follows.
    c.addEventListener('scroll', () => {
      if (this.gesture) this.drawDraft();
    }, { passive: true });
    c.addEventListener('contextmenu', this.onContextMenu);
    // In highlight mode, finishing a text selection marks it; a click on text markup selects it.
    document.addEventListener('pointerup', this.onSelectionEnd);
    // Arrow keys nudge the selection before page navigation sees them (menus stop them earlier).
    document.addEventListener('keydown', this.onKeyDown, true);
    deps.state.onChange(() => this.syncTool());
    this.syncTool();
  }

  get selected(): AnnotRef | null {
    return this.selection;
  }

  /** Selects an annotation (or nothing) and shows it on the overlays. */
  select(ref: AnnotRef | null): void {
    if (ref?.pageId === this.selection?.pageId && ref?.annotId === this.selection?.annotId) return;
    this.selection = ref;
    // With something selected, a touch or pen drag moves it instead of scrolling.
    this.deps.container.classList.toggle('mk-selection', ref !== null);
    this.deps.overlays.setSelected(ref);
  }

  /**
   * Commits an open editor and waits until edits that were waiting for a page's annotations
   * are applied (or have failed), so saving and closing see them.
   */
  async settle(): Promise<void> {
    this.commitEditing();
    while (this.deferred.size > 0) await Promise.allSettled([...this.deferred]);
  }

  /** Esc: ends editing, cancels a drag, disarms a tool, then deselects. True when it did one of these. */
  handleEscape(): boolean {
    if (this.editing) {
      this.endEditing('keep');
      return true;
    }
    if (this.gesture) {
      this.cancelGesture();
      return true;
    }
    if (this.deps.state.tool !== 'select') {
      this.deps.state.setTool('select');
      return true;
    }
    if (this.selection) {
      this.select(null);
      return true;
    }
    return false;
  }

  /** Commits an open text box editor or note popup (before saving or closing), keeping it selected. */
  commitEditing(): void {
    if (this.editing) this.endEditing('keep');
  }

  /**
   * Marks the text selected in the document view with the current mark style (one annotation
   * per page, one undo step) and clears the selection. False when no page text is selected.
   */
  markSelection(): boolean {
    const doc = this.deps.doc();
    const sel = window.getSelection();
    if (!doc || !sel || sel.isCollapsed) return false;
    const marks = selectionToMarks(sel, this.deps.viewer.getPageViews());
    if (marks.size === 0) return false;
    const { markKind, markColor } = this.deps.state.styles;
    const added = [...marks].map(([pos, m]) => ({
      pageId: doc.pages[pos]!.id,
      annot: { id: doc.newAnnotId(), kind: markKind, color: markColor, opacity: 1, modified: now(), quads: m.quads, text: m.text } as Annot,
    }));
    sel.removeAllRanges();
    this.addAll(doc, added);
    return true;
  }

  /** Adds annotations to several pages as one undo step, loading their lists first when needed. */
  private addAll(doc: EditableDocument, added: ReadonlyArray<{ pageId: number; annot: Annot }>): void {
    const positions = added.map((a) => this.positionOf(a.pageId));
    if (positions.some((p) => p < 0)) return;
    if (positions.some((p) => doc.annotationsAt(p) === null)) {
      this.defer(
        Promise.all(positions.map((p) => doc.loadAnnotations(p))).then(() => {
          if (this.deps.doc() === doc && added.every((a) => doc.annotationsAt(this.positionOf(a.pageId)) !== null)) this.addAll(doc, added);
        }),
        doc,
      );
      return;
    }
    const changes = new Map<number, Annot[]>();
    added.forEach((a, i) => {
      const pos = positions[i]!;
      changes.set(pos, [...(changes.get(pos) ?? doc.annotationsAt(pos)!), a.annot]);
    });
    doc.updateAnnotations(changes);
  }

  deleteSelected(): boolean {
    const sel = this.selection;
    if (!sel || this.editing || !this.find(sel)) return false;
    this.select(null);
    this.updatePage(sel.pageId, (list) => list.filter((a) => a.id !== sel.annotId));
    return true;
  }

  /** Ctrl+D: a copy DUPLICATE_OFFSET right and down on screen, selected. */
  duplicateSelected(): boolean {
    const sel = this.selection;
    const doc = this.deps.doc();
    const a = sel && this.find(sel);
    if (!sel || !doc || !a || this.editing) return false;
    const view = this.viewOf(sel.pageId);
    const offset = view ? this.screenVector(view, DUPLICATE_OFFSET, DUPLICATE_OFFSET) : { x: DUPLICATE_OFFSET, y: -DUPLICATE_OFFSET };
    const d = view ? clampDelta(annotBox(a), offset, this.pageBox(view)) : offset;
    const copy = translateAnnot({ ...a, id: doc.newAnnotId(), modified: now() }, d.x, d.y);
    this.add(sel.pageId, copy);
    return true;
  }

  /** Moves the selection by (dx, dy) points in screen directions; false when nothing could move. */
  nudge(dx: number, dy: number): boolean {
    const sel = this.selection;
    const a = sel && this.find(sel);
    const view = sel && this.viewOf(sel.pageId);
    if (!sel || !a || !view || this.editing) return false;
    const d = clampDelta(annotBox(a), this.screenVector(view, dx, dy), this.pageBox(view));
    if (d.x !== 0 || d.y !== 0) this.replace(sel.pageId, translateAnnot({ ...a, modified: now() }, d.x, d.y));
    return true;
  }

  /**
   * A style control changed: it becomes the default and restyles the selected annotation
   * where the style applies (one undo step).
   */
  applyStyles(patch: Partial<Styles>): void {
    this.deps.state.setStyles(patch);
    const sel = this.selection;
    const a = sel && this.find(sel);
    if (!sel || !a) return;
    const next = restyle(a, patch, this.deps.state.styles);
    if (next !== a) this.replace(sel.pageId, next.kind === 'text' ? fitText(next) : next);
  }

  /** A highlight style picked while text markup is selected restyles it; true when it did. */
  restyleSelectedMark(kind: MarkKind, color?: string): boolean {
    const sel = this.selection;
    const a = sel && this.find(sel);
    if (!sel || !a || !isMark(a)) return false;
    const next = { ...a, kind, color: color ?? this.deps.state.markColorFor(kind), modified: now() };
    if (next.kind !== a.kind || next.color !== a.color) this.replace(sel.pageId, next);
    return true;
  }

  /** Call after any document change (edit, undo, redo): drops a selection that no longer exists. */
  documentChanged(): void {
    const sel = this.selection;
    if (sel && !this.find(sel)) this.select(null);
  }

  /** A new document was opened: drop gestures, editors and the selection without committing. */
  reset(): void {
    this.cancelGesture();
    if (this.editing) this.teardownEditing();
    this.select(null);
  }

  // ---- lookups ------------------------------------------------------------------

  private positionOf(pageId: number): number {
    return this.deps.doc()?.pages.findIndex((p) => p.id === pageId) ?? -1;
  }

  private viewOf(pageId: number): PageView | null {
    const pos = this.positionOf(pageId);
    return pos < 0 ? null : (this.deps.viewer.getPageViews().find((v) => v.index === pos) ?? null);
  }

  private viewAt(p: Client): PageView | null {
    for (const v of this.deps.viewer.getPageViews()) {
      const r = v.el.getBoundingClientRect();
      if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return v;
    }
    return null;
  }

  private find(ref: AnnotRef): Annot | null {
    const doc = this.deps.doc();
    const pos = this.positionOf(ref.pageId);
    if (!doc || pos < 0) return null;
    return doc.annotationsAt(pos)?.find((a) => a.id === ref.annotId) ?? null;
  }

  /** PDF point of `view`'s page under a client point. */
  private toPdf(view: PageView, p: Client): PdfPoint {
    const r = view.el.getBoundingClientRect();
    const vp = view.viewport;
    const sx = r.width > 0 ? vp.width / r.width : 1;
    const sy = r.height > 0 ? vp.height / r.height : 1;
    const [x, y] = vp.convertToPdfPoint((p.x - r.left) * sx, (p.y - r.top) * sy) as [number, number];
    return { x, y };
  }

  /** CSS px per point on screen for `view`. */
  private pxPerPt(view: PageView): number {
    const r = view.el.getBoundingClientRect();
    return view.viewport.scale * (r.width > 0 ? r.width / view.viewport.width : 1);
  }

  // ---- document updates -------------------------------------------------------------

  /**
   * Replaces the page's list through `edit`; one undo step. Loads the page's annotations first
   * when needed; `then` runs once the edit is applied.
   */
  private updatePage(pageId: number, edit: (list: readonly Annot[]) => readonly Annot[], then?: () => void): void {
    const doc = this.deps.doc();
    const pos = this.positionOf(pageId);
    if (!doc || pos < 0) return;
    const list = doc.annotationsAt(pos);
    if (list === null) {
      this.defer(
        doc.loadAnnotations(pos).then(() => {
          if (this.deps.doc() === doc && doc.annotationsAt(this.positionOf(pageId)) !== null) this.updatePage(pageId, edit, then);
        }),
        doc,
      );
      return;
    }
    const next = edit(list);
    if (next !== list) doc.setAnnotations(pos, next);
    then?.();
  }

  /** Tracks an edit waiting for annotations to be read; tells the user when they cannot be. */
  private defer(work: Promise<unknown>, doc: EditableDocument): void {
    const tracked = work.catch((e: unknown) => {
      console.warn('markup edit dropped', e);
      if (this.deps.doc() === doc) this.deps.notify(t('chrome.mk.unreadable'));
    });
    this.deferred.add(tracked);
    void tracked.finally(() => this.deferred.delete(tracked));
  }

  private add(pageId: number, a: Annot, select = true): void {
    // Selected once it exists: an edit may wait for the page's annotations to be read.
    this.updatePage(pageId, (list) => [...list, a], select ? () => this.select({ pageId, annotId: a.id }) : undefined);
  }

  /** Replaces the annotation with `next.id` on the page (one undo step). */
  private replace(pageId: number, next: Annot): void {
    this.updatePage(pageId, (list) => (list.some((a) => a.id === next.id) ? list.map((a) => (a.id === next.id ? next : a)) : list));
  }

  /** PDF vector for (dx, dy) points along the screen's right and down on `view`. */
  private screenVector(view: PageView, dx: number, dy: number): PdfPoint {
    const vp = view.viewport;
    const [x0, y0] = vp.convertToPdfPoint(0, 0) as [number, number];
    const [x1, y1] = vp.convertToPdfPoint(dx * vp.scale, dy * vp.scale) as [number, number];
    const clean = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
    return { x: clean(x1 - x0), y: clean(y1 - y0) };
  }

  /** The topmost annotation under a client point (text boxes and notes, then shapes, then marks). */
  private hitAt(view: PageView, p: Client): Annot | null {
    const list = this.deps.overlays.annotsFor(view);
    if (!list || list.length === 0) return null;
    const q = this.toPdf(view, p);
    const tol = HIT_TOLERANCE / this.pxPerPt(view);
    const editing = this.editing?.ref.annotId;
    const order = list
      .map((a, i) => ({ a, i }))
      .sort((x, y) => layer(x.a) - layer(y.a) || y.i - x.i);
    return order.find(({ a }) => a.id !== editing && hitTest(a, q, tol))?.a ?? null;
  }

  /** The client point where a PDF point of `view`'s page is now. */
  private toClient(view: PageView, q: PdfPoint): Client {
    const r = view.el.getBoundingClientRect();
    const vp = view.viewport;
    const [x, y] = vp.convertToViewportPoint(q.x, q.y) as [number, number];
    return { x: r.left + x * (vp.width > 0 ? r.width / vp.width : 1), y: r.top + y * (vp.height > 0 ? r.height / vp.height : 1) };
  }

  /** The gesture's press point on screen now. */
  private anchor(g: Gesture, view: PageView): Client {
    return this.toClient(view, g.startPdf);
  }

  /** PDF point under a client point, kept on the page. */
  private toPdfOnPage(view: PageView, p: Client): PdfPoint {
    const vp = view.viewport;
    const q = this.toViewport(view, p);
    const [x, y] = vp.convertToPdfPoint(Math.min(Math.max(q.x, 0), vp.width), Math.min(Math.max(q.y, 0), vp.height)) as [number, number];
    return { x, y };
  }

  /** The page's visible box in PDF space. */
  private pageBox(view: PageView): PdfRect {
    const vp = view.viewport;
    const [ax, ay] = vp.convertToPdfPoint(0, 0) as [number, number];
    const [bx, by] = vp.convertToPdfPoint(vp.width, vp.height) as [number, number];
    return normRect({ x: ax, y: ay }, { x: bx, y: by });
  }

  /** Client point → the viewport's CSS px for `view`. */
  private toViewport(view: PageView, p: Client): Client {
    const r = view.el.getBoundingClientRect();
    const vp = view.viewport;
    return { x: (p.x - r.left) * (r.width > 0 ? vp.width / r.width : 1), y: (p.y - r.top) * (r.height > 0 ? vp.height / r.height : 1) };
  }

  // ---- tool state ---------------------------------------------------------------

  private syncTool(): void {
    const tool = this.deps.state.tool;
    this.deps.container.classList.toggle('mk-armed', tool !== 'select');
    this.deps.container.dataset['tool'] = tool;
    if (tool !== 'select' && this.gesture && this.gesture.tool !== tool) this.cancelGesture();
  }

  // ---- pointer input ------------------------------------------------------------------

  /** Shows the move cursor over annotations a press would pick up. */
  private hover(e: PointerEvent): void {
    const c = this.deps.container;
    let hover = '';
    if (this.deps.state.tool === 'select' && !(e.target as Element | null)?.closest?.('[data-handle], .mk-text-editor, .mk-note-popup')) {
      const p = { x: e.clientX, y: e.clientY };
      const view = this.viewAt(p);
      const hit = view && this.hitAt(view, p);
      if (hit && !isMark(hit)) hover = 'move';
    }
    if ((c.dataset['hover'] ?? '') !== hover) {
      if (hover) c.dataset['hover'] = hover;
      else delete c.dataset['hover'];
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.selection || this.editing || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
    const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (!dir) return;
    // Only while the document view (or nothing in particular) has focus: arrows elsewhere navigate.
    const t = e.target as HTMLElement | null;
    const inDocument = !t || t === document.body || t === document.documentElement || this.deps.container.contains(t);
    if (!inDocument || t?.isContentEditable || t?.closest?.('input, textarea, select')) return;
    const step = e.shiftKey ? 10 : 1;
    if (this.nudge(dir[0] * step, dir[1] * step)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private readonly onDoubleClick = (e: MouseEvent): void => {
    if (this.deps.state.tool !== 'select' || this.editing) return;
    const p = { x: e.clientX, y: e.clientY };
    const view = this.viewAt(p);
    const hit = view && this.hitAt(view, p);
    if (view && hit?.kind === 'text') {
      e.preventDefault();
      this.startEditing(view, hit, false);
    }
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.deps.state.tool !== 'select' || this.inEditor(e.target)) return;
    const doc = this.deps.doc();
    const p = { x: e.clientX, y: e.clientY };
    const view = this.viewAt(p);
    const hit = view && this.hitAt(view, p);
    const pageId = view ? doc?.pages[view.index]?.id : undefined;
    if (!view || !hit || pageId === undefined) return;
    // Selected text over a mark keeps the native menu (Copy).
    if (isMark(hit) && !(window.getSelection()?.isCollapsed ?? true)) return;
    e.preventDefault();
    if (this.editing) this.endEditing('outside');
    const ref = { pageId, annotId: hit.id };
    this.select(ref);
    const items: MenuItem[] = [];
    if (hit.kind === 'text' || hit.kind === 'note') {
      items.push({
        label: t('chrome.mk.editText'),
        action: () => {
          const v = this.viewOf(pageId);
          const a = this.find(ref);
          if (v && a && (a.kind === 'text' || a.kind === 'note')) this.startEditing(v, a, false);
        },
      });
    }
    if (isMark(hit)) {
      items.push(...highlightMenuItems(this.deps.state, (kind, color) => {
        this.deps.state.setMark(kind, color);
        this.restyleSelectedMark(kind, color);
      }), 'separator');
    } else {
      items.push({ label: t('chrome.mk.duplicate'), shortcut: 'Ctrl+D', action: () => this.duplicateSelected() });
    }
    items.push({ label: t('chrome.mk.delete'), shortcut: 'Delete', action: () => this.deleteSelected() });
    void showMenu(p, items);
  };

  private readonly onSelectionEnd = (e: PointerEvent): void => {
    const press = this.markPress;
    if (press && e.pointerId === press.pointerId) {
      this.markPress = null;
      const moved = Math.hypot(e.clientX - press.start.x, e.clientY - press.start.y) >= CLICK_SLOP;
      const collapsed = window.getSelection()?.isCollapsed ?? true;
      this.select(!moved && collapsed ? press.ref : null);
    }
    if (e.button !== 0 || !this.deps.state.highlightMode || this.deps.state.tool !== 'select') return;
    // The selection is final once the release has been handled.
    setTimeout(() => {
      if (this.deps.state.highlightMode && this.deps.state.tool === 'select') this.markSelection();
    }, 0);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.gesture) e.preventDefault();
  };

  /** True for presses on the view's scrollbars (pages extend under them when zoomed in). */
  private inScrollbar(e: PointerEvent): boolean {
    const c = this.deps.container;
    const r = c.getBoundingClientRect();
    return e.clientX - r.left >= c.clientLeft + c.clientWidth || e.clientY - r.top >= c.clientTop + c.clientHeight;
  }

  /** True for events inside the open text box editor or note popup, which handle them natively. */
  private inEditor(target: EventTarget | null): boolean {
    return !!this.editing && target instanceof Node && this.editing.el.contains(target);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary || this.inEditor(e.target) || this.inScrollbar(e)) return;
    const doc = this.deps.doc();
    if (!doc) return;
    const tool = this.deps.state.tool;
    if (tool === 'select') {
      this.pressSelect(e, doc);
      return;
    }
    const p = { x: e.clientX, y: e.clientY };
    const view = this.viewAt(p);
    if (!view) return;
    const ref = doc.pages[view.index];
    if (!ref) return;
    e.preventDefault();
    e.stopPropagation();
    this.deps.container.focus({ preventScroll: true });
    this.deps.container.setPointerCapture?.(e.pointerId);
    this.select(null);
    this.gesture = {
      kind: 'create',
      pointerId: e.pointerId,
      tool,
      pageId: ref.id,
      id: doc.newAnnotId(),
      start: p,
      startPdf: this.toPdf(view, p),
      last: p,
      shift: e.shiftKey,
      moved: false,
      ink: tool === 'draw' ? [this.toPdf(view, p)] : [],
    };
    this.drawDraft();
  };

  /** Text Selection mode: a handle resizes, an annotation is selected and dragged, text markup waits for the release. */
  private pressSelect(e: PointerEvent, doc: EditableDocument): void {
    const p = { x: e.clientX, y: e.clientY };
    const handle = (e.target as Element | null)?.closest?.('[data-handle]')?.getAttribute('data-handle');
    const sel = this.selection;
    if (handle && sel) {
      const a = this.find(sel);
      if (a) {
        this.startDrag(e, 'resize', sel.pageId, a, handle);
        return;
      }
    }
    const view = this.viewAt(p);
    const hit = view && this.hitAt(view, p);
    const pageId = view ? doc.pages[view.index]?.id : undefined;
    if (!view || !hit || pageId === undefined) {
      this.select(null);
      return;
    }
    const ref = { pageId, annotId: hit.id };
    if (isMark(hit)) {
      this.markPress = { ref, pointerId: e.pointerId, start: p };
      return;
    }
    this.select(ref);
    this.startDrag(e, 'move', pageId, hit);
  }

  private startDrag(e: PointerEvent, kind: 'move' | 'resize', pageId: number, a: Annot, handle?: string): void {
    e.preventDefault();
    e.stopPropagation();
    this.deps.container.focus({ preventScroll: true });
    this.deps.container.setPointerCapture?.(e.pointerId);
    const p = { x: e.clientX, y: e.clientY };
    const view = this.viewOf(pageId);
    this.gesture = {
      kind,
      pointerId: e.pointerId,
      tool: 'select',
      pageId,
      id: a.id,
      start: p,
      startPdf: view ? this.toPdf(view, p) : { x: 0, y: 0 },
      last: p,
      shift: e.shiftKey,
      moved: false,
      ink: [],
      original: a,
      ...(handle ? { handle } : {}),
    };
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g) {
      if (e.buttons === 0) this.hover(e);
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length > 0 ? events : [e]) this.track(g, { x: ev.clientX, y: ev.clientY });
    g.shift = e.shiftKey;
    this.drawDraft();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    this.track(g, { x: e.clientX, y: e.clientY });
    g.shift = e.shiftKey;
    this.finishGesture(g);
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (this.gesture && e.pointerId === this.gesture.pointerId) this.cancelGesture();
  };

  private track(g: Gesture, p: Client): void {
    g.last = p;
    const view = this.viewOf(g.pageId);
    const a = view ? this.anchor(g, view) : g.start;
    if (!g.moved && Math.hypot(p.x - a.x, p.y - a.y) >= CLICK_SLOP) g.moved = true;
    if (g.tool !== 'draw' || !view) return;
    const q = this.toPdfOnPage(view, p);
    const prev = g.ink[g.ink.length - 1];
    if (!prev || Math.hypot(q.x - prev.x, q.y - prev.y) >= INK_MIN_STEP) g.ink.push(q);
  }

  private cancelGesture(): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (this.deps.container.hasPointerCapture?.(g.pointerId)) this.deps.container.releasePointerCapture(g.pointerId);
    this.deps.overlays.clearDrafts();
  }

  private drawDraft(): void {
    const g = this.gesture;
    if (!g) return;
    const view = this.viewOf(g.pageId);
    const doc = this.deps.doc();
    if (!view || !doc) return;
    const list = doc.annotationsAt(view.index) ?? [];
    if (g.kind !== 'create') {
      const next = g.moved ? this.dragged(g, view) : g.original!;
      this.deps.overlays.setDraft(view.index, list.map((a) => (a.id === g.id ? next : a)));
      return;
    }
    const draft = this.annotFromGesture(g, view, true);
    this.deps.overlays.setDraft(view.index, draft ? [...list, draft] : list);
  }

  /** The moved or resized annotation for the gesture so far. */
  private dragged(g: Gesture, view: PageView): Annot {
    const a = g.original!;
    if (g.kind === 'move') {
      const p = g.startPdf;
      const q = this.toPdf(view, g.last);
      const d = clampDelta(annotBox(a), { x: q.x - p.x, y: q.y - p.y }, this.pageBox(view));
      return translateAnnot({ ...a, modified: now() }, d.x, d.y);
    }
    const vp = view.viewport;
    const raw = this.toViewport(view, g.last);
    const pt = { x: Math.min(Math.max(raw.x, 0), vp.width), y: Math.min(Math.max(raw.y, 0), vp.height) };
    if (a.kind === 'line' || a.kind === 'arrow') {
      let end = pt;
      if (g.shift) {
        const [ox, oy] = vp.convertToViewportPoint(...((g.handle === 'from' ? [a.to.x, a.to.y] : [a.from.x, a.from.y]) as [number, number])) as [number, number];
        const step = Math.PI / 4;
        const angle = Math.round(Math.atan2(pt.y - oy, pt.x - ox) / step) * step;
        const len = Math.hypot(pt.x - ox, pt.y - oy);
        end = { x: ox + len * Math.cos(angle), y: oy + len * Math.sin(angle) };
      }
      const [x, y] = vp.convertToPdfPoint(Math.min(Math.max(end.x, 0), vp.width), Math.min(Math.max(end.y, 0), vp.height)) as [number, number];
      return { ...a, [g.handle === 'from' ? 'from' : 'to']: { x, y }, modified: now() };
    }
    const box = annotBox(a);
    const r = viewRect(vp, box);
    const h = g.handle ?? '';
    let { left, top, right, bottom } = r;
    if (h.includes('w')) left = pt.x;
    if (h.includes('e')) right = pt.x;
    if (h.includes('n')) top = pt.y;
    if (h.includes('s')) bottom = pt.y;
    const w0 = r.right - r.left;
    const h0 = r.bottom - r.top;
    if (g.shift && w0 > 0 && h0 > 0) {
      if (h.length === 2) {
        // Corner: scale about the opposite corner.
        const ax = h.includes('w') ? r.right : r.left;
        const ay = h.includes('n') ? r.bottom : r.top;
        const k = Math.max(Math.abs(pt.x - ax) / w0, Math.abs(pt.y - ay) / h0);
        const side = (d: number, away: number) => (d === 0 ? away : Math.sign(d));
        const x2 = ax + side(pt.x - ax, h.includes('w') ? -1 : 1) * k * w0;
        const y2 = ay + side(pt.y - ay, h.includes('n') ? -1 : 1) * k * h0;
        [left, right] = [Math.min(ax, x2), Math.max(ax, x2)];
        [top, bottom] = [Math.min(ay, y2), Math.max(ay, y2)];
      } else if (h === 'e' || h === 'w') {
        const k = Math.abs(right - left) / w0;
        const cy = (r.top + r.bottom) / 2;
        [top, bottom] = [cy - (h0 * k) / 2, cy + (h0 * k) / 2];
      } else {
        const k = Math.abs(bottom - top) / h0;
        const cx = (r.left + r.right) / 2;
        [left, right] = [cx - (w0 * k) / 2, cx + (w0 * k) / 2];
      }
    }
    const min = MIN_BOX * vp.scale;
    if (Math.abs(right - left) < min) right = left + (h.includes('w') ? -min : min);
    if (Math.abs(bottom - top) < min) bottom = top + (h.includes('n') ? -min : min);
    const [ax, ay] = vp.convertToPdfPoint(left, top) as [number, number];
    const [bx, by] = vp.convertToPdfPoint(right, bottom) as [number, number];
    const next = resizeAnnot({ ...a, modified: now() }, box, normRect({ x: ax, y: ay }, { x: bx, y: by }));
    return next.kind === 'text' ? fitText(next) : next;
  }

  private finishGesture(g: Gesture): void {
    this.gesture = null;
    if (this.deps.container.hasPointerCapture?.(g.pointerId)) this.deps.container.releasePointerCapture(g.pointerId);
    this.deps.overlays.clearDrafts();
    const view = this.viewOf(g.pageId);
    if (!view) return;
    if (g.kind !== 'create') {
      const a = g.original!;
      if (g.moved) this.replace(g.pageId, this.dragged(g, view));
      else if (g.kind === 'move' && a.kind === 'note') this.startEditing(view, a, false);
      return;
    }
    const state = this.deps.state;
    if (g.tool === 'text') {
      state.setTool('select');
      this.startEditing(view, this.newTextBox(g, view), true);
      return;
    }
    if (g.tool === 'note') {
      state.setTool('select');
      this.startEditing(view, this.newNote(g, view), true);
      return;
    }
    const a = this.annotFromGesture(g, view, false);
    if (!a) return;
    if (g.tool === 'draw') {
      this.add(g.pageId, a, false);
      return;
    }
    state.setTool('select');
    this.add(g.pageId, a);
  }

  // ---- building annotations ---------------------------------------------------------------

  private annotFromGesture(g: Gesture, view: PageView, draft: boolean): Annot | null {
    const s = this.deps.state.styles;
    const base = { id: g.id, color: s.stroke, opacity: 1, modified: now() };
    if (g.tool === 'draw') {
      const pts = draft ? g.ink : finishInk(g.ink);
      return pts.length > 0 ? { ...base, kind: 'ink', paths: [pts], width: s.width } : null;
    }
    if (g.tool === 'text') {
      return draft && g.moved ? { ...this.newTextBox(g, view), text: '' } : null;
    }
    if (g.tool === 'note') return null;
    if (!SHAPE_TOOLS.includes(g.tool)) return null;
    const tool = g.tool as ShapeTool;
    if (tool === 'line' || tool === 'arrow') {
      const [from, to] = this.lineEnds(g, view);
      return { ...base, kind: tool, from, to, width: s.width };
    }
    const rect = this.shapeRect(g, view);
    return { ...base, kind: tool === 'oval' ? 'oval' : 'rect', rect, fill: s.fill, width: s.width, rounded: tool === 'rounded' };
  }

  /** Dragged box (Shift: square on screen), or a default-size box centered on a click. */
  private shapeRect(g: Gesture, view: PageView): PdfRect {
    const k = this.pxPerPt(view);
    const s = this.anchor(g, view);
    const at = (p: Client) => this.toPdfOnPage(view, p);
    if (!g.moved) {
      const hw = (CLICK_SHAPE.width / 2) * k;
      const hh = (CLICK_SHAPE.height / 2) * k;
      return normRect(at({ x: s.x - hw, y: s.y - hh }), at({ x: s.x + hw, y: s.y + hh }));
    }
    let end = g.last;
    if (g.shift) {
      const dx = end.x - s.x;
      const dy = end.y - s.y;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      end = { x: s.x + (dx < 0 ? -m : m), y: s.y + (dy < 0 ? -m : m) };
    }
    return normRect(at(s), at(end));
  }

  /** Dragged line (Shift: snapped to 45°), or a default-length horizontal line centered on a click. */
  private lineEnds(g: Gesture, view: PageView): [PdfPoint, PdfPoint] {
    const s = this.anchor(g, view);
    const at = (p: Client) => this.toPdfOnPage(view, p);
    if (!g.moved) {
      const half = (CLICK_LINE / 2) * this.pxPerPt(view);
      return [at({ x: s.x - half, y: s.y }), at({ x: s.x + half, y: s.y })];
    }
    let end = g.last;
    if (g.shift) {
      const dx = end.x - s.x;
      const dy = end.y - s.y;
      const step = Math.PI / 4;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      const len = Math.hypot(dx, dy);
      end = { x: s.x + len * Math.cos(angle), y: s.y + len * Math.sin(angle) };
    }
    return [at(s), at(end)];
  }

  private newTextBox(g: Gesture, view: PageView): TextBoxAnnot {
    const s = this.deps.state.styles;
    const k = this.pxPerPt(view);
    const lineBox = s.fontSize * TEXT_LINE_HEIGHT + 2 * TEXT_PADDING;
    const page = view.el.getBoundingClientRect();
    const start = this.anchor(g, view);
    let a = start;
    let b: Client;
    if (g.moved) {
      a = { x: Math.min(start.x, g.last.x), y: Math.min(start.y, g.last.y) };
      b = { x: Math.max(start.x, g.last.x), y: Math.max(start.y, g.last.y, a.y + lineBox * k) };
      b.x = Math.max(b.x, a.x + 2 * s.fontSize * k);
    } else {
      // A click puts the box's top-left corner there; it is as wide as fits, up to TEXT_BOX_WIDTH.
      const room = (page.right - a.x) / k - 4;
      const width = Math.max(4 * s.fontSize, Math.min(TEXT_BOX_WIDTH, room));
      b = { x: a.x + width * k, y: a.y + lineBox * k };
    }
    return {
      id: g.id,
      kind: 'text',
      color: s.textColor,
      opacity: 1,
      modified: now(),
      rect: normRect(this.toPdfOnPage(view, a), this.toPdfOnPage(view, b)),
      // The placeholder a new box starts with, selected so typing replaces it.
      text: t('chrome.mk.text'),
      fontSize: s.fontSize,
      fill: null,
      border: null,
      borderWidth: 1,
      angle: upright(view),
    };
  }

  private newNote(g: Gesture, view: PageView): NoteAnnot {
    const h = NOTE_SIZE / 2;
    const pb = this.pageBox(view);
    const keep = (v: number, lo: number, hi: number) => (hi - lo < NOTE_SIZE ? v : Math.min(Math.max(v, lo + h), hi - h));
    const c = { x: keep(g.startPdf.x, pb.x0, pb.x1), y: keep(g.startPdf.y, pb.y0, pb.y1) };
    return {
      id: g.id,
      kind: 'note',
      color: NOTE_COLOR,
      opacity: 1,
      modified: now(),
      rect: { x0: c.x - h, y0: c.y - h, x1: c.x + h, y1: c.y + h },
      text: '',
      angle: upright(view),
    };
  }

  // ---- text box and note editing ------------------------------------------------------------

  /** Opens the in-place editor for a text box, or the popup of a note. */
  startEditing(view: PageView, annot: TextBoxAnnot | NoteAnnot, isNew: boolean): void {
    if (this.editing) this.endEditing('outside');
    const doc = this.deps.doc();
    const pageId = doc?.pages[view.index]?.id;
    if (pageId === undefined) return;
    const ref = { pageId, annotId: annot.id };
    const input = document.createElement('textarea');
    input.spellcheck = false;
    input.value = annot.text;
    let el: HTMLElement;
    let host: HTMLElement;
    if (annot.kind === 'text') {
      input.className = 'mk-text mk-text-editor';
      input.style.fontSize = `${annot.fontSize}px`;
      input.style.color = annot.color;
      input.style.background = annot.fill ?? 'transparent';
      if (annot.border && annot.borderWidth > 0) input.style.border = `${annot.borderWidth}px solid ${annot.border}`;
      input.setAttribute('aria-label', t('chrome.mk.textBox'));
      el = input;
      host = view.el;
    } else {
      el = document.createElement('div');
      el.className = 'mk-note-popup';
      el.style.setProperty('--note', annot.color);
      input.setAttribute('aria-label', t('chrome.mk.note'));
      input.placeholder = t('chrome.mk.note');
      el.append(input);
      host = view.el.parentElement ?? view.el;
    }
    host.append(el);
    const editing: Editing = { ref, annot, isNew, el, input, host, cleanup: [] };
    this.editing = editing;
    this.placeEditor(editing, view);
    this.select(null);
    // A text box is replaced by its editor; a note keeps its icon next to the popup.
    if (annot.kind === 'text') this.deps.overlays.setEditing(ref);
    else if (isNew) this.deps.overlays.setPending(pageId, annot);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        this.endEditing('keep');
      }
    };
    // A press elsewhere in the document ends editing; one on the toolbars, a menu or a popover
    // (to restyle the box, say) keeps the box selected.
    const onOutside = (e: PointerEvent) => {
      if (el.contains(e.target as Node)) return;
      this.endEditing(this.deps.container.contains(e.target as Node) ? 'outside' : 'keep');
    };
    input.addEventListener('keydown', onKey);
    input.addEventListener('input', () => this.grow());
    document.addEventListener('pointerdown', onOutside, true);
    editing.cleanup.push(
      () => document.removeEventListener('pointerdown', onOutside, true),
      this.deps.viewer.onPageView((v) => {
        if (this.editing === editing && this.deps.doc()?.pages[v.index]?.id === pageId) this.placeEditor(editing, v);
      }),
      this.deps.viewer.onPageGone((gone) => {
        if (this.editing === editing && gone === view.el) this.endEditing('outside');
      }),
    );
    input.focus({ preventScroll: true });
    if (isNew && annot.kind === 'text') input.select();
  }

  private placeEditor(e: Editing, view: PageView): void {
    if (e.annot.kind === 'text') {
      placeBox(e.el, view.viewport, e.annot.rect, e.annot.angle);
      return;
    }
    // The popup sits beside the icon, upright, in the page layer so the page edge does not clip it.
    const icon = viewRect(view.viewport, e.annot.rect);
    const k = view.el.getBoundingClientRect().width / view.viewport.width || 1;
    const left = view.el.offsetLeft + icon.right * k + NOTE_POPUP.gap;
    const room = (e.host.clientWidth || Infinity) - left;
    const x = room >= NOTE_POPUP.width ? left : view.el.offsetLeft + icon.left * k - NOTE_POPUP.gap - NOTE_POPUP.width;
    e.el.style.left = `${Math.max(0, x)}px`;
    e.el.style.top = `${view.el.offsetTop + icon.top * k}px`;
  }

  /** Grows the text box downward (in its own direction) to fit what was typed. */
  private grow(): void {
    const e = this.editing;
    if (!e || e.annot.kind !== 'text') return;
    const a = e.annot;
    const { height } = localSize(a.rect, a.angle);
    const needed = e.input.scrollHeight + (a.border ? 2 * a.borderWidth : 0);
    if (needed <= height + 0.5) return;
    e.annot = { ...a, rect: growDown(a.rect, a.angle, needed - height) };
    const view = this.viewOf(e.ref.pageId);
    if (view) this.placeEditor(e, view);
  }

  private teardownEditing(): Editing | null {
    const e = this.editing;
    if (!e) return null;
    this.editing = null;
    for (const c of e.cleanup) c();
    e.el.remove();
    if (e.annot.kind === 'text') this.deps.overlays.setEditing(null);
    else if (e.isNew) this.deps.overlays.setPending(e.ref.pageId, null);
    return e;
  }

  /** Commits the editor: one undo step, or none when nothing changed; an empty box or note is removed. */
  private endEditing(how: 'keep' | 'outside'): void {
    if (this.editing) this.grow();
    const e = this.teardownEditing();
    if (!e) return;
    const text = e.input.value;
    const { ref } = e;
    if (text.trim() === '') {
      if (!e.isNew) this.updatePage(ref.pageId, (list) => list.filter((a) => a.id !== ref.annotId));
    } else {
      const next = { ...e.annot, text, modified: now() } as TextBoxAnnot | NoteAnnot;
      if (e.isNew) {
        this.add(ref.pageId, next, false);
      } else {
        const old = this.find(ref);
        if (old && (old.kind !== next.kind || old.text !== text || old.rect !== next.rect)) {
          this.updatePage(ref.pageId, (list) => list.map((a) => (a.id === ref.annotId ? next : a)));
        }
      }
      if (how === 'keep') this.select(ref);
    }
    if (e.input === document.activeElement || !document.activeElement || document.activeElement === document.body) {
      this.deps.container.focus({ preventScroll: true });
    }
  }
}

/** `d` reduced so that `box` moved by it stays inside `page` (on an axis where it fits). */
function clampDelta(box: PdfRect, d: PdfPoint, page: PdfRect): PdfPoint {
  const axis = (lo: number, hi: number, min: number, max: number, v: number) =>
    hi - lo > max - min ? v : Math.min(Math.max(v, min - lo), max - hi);
  return { x: axis(box.x0, box.x1, page.x0, page.x1, d.x), y: axis(box.y0, box.y1, page.y0, page.y1, d.y) };
}

/** Extends `r` by `d` points on the side that is down for text turned `angle`. */
function growDown(r: PdfRect, angle: TextAngle, d: number): PdfRect {
  switch (angle) {
    case 0:
      return { ...r, y0: r.y0 - d };
    case 90:
      return { ...r, x1: r.x1 + d };
    case 180:
      return { ...r, y1: r.y1 + d };
    case 270:
      return { ...r, x0: r.x0 - d };
  }
}

/** Grows a text box downward until its text fits (laid out like the overlay draws it). */
export function fitText(a: TextBoxAnnot): TextBoxAnnot {
  const { width, height } = localSize(a.rect, a.angle);
  const probe = document.createElement('div');
  probe.className = 'mk-text';
  probe.style.cssText = `visibility:hidden;left:-10000px;top:0;transform:none;width:${width}px;height:auto;font-size:${a.fontSize}px`;
  if (a.border && a.borderWidth > 0) probe.style.border = `${a.borderWidth}px solid`;
  // A trailing line break still takes a line, as in the editor.
  probe.textContent = a.text.endsWith('\n') ? `${a.text}\u200b` : a.text || '\u200b';
  document.body.append(probe);
  const needed = probe.offsetHeight;
  probe.remove();
  return needed > height + 0.5 ? { ...a, rect: growDown(a.rect, a.angle, needed - height) } : a;
}

/** `a` with the styles in `patch` applied where they mean something for its kind; `a` itself when nothing changes. */
function restyle(a: Annot, patch: Partial<Styles>, s: Styles): Annot {
  const has = (k: keyof Styles) => k in patch;
  let next: Annot = a;
  const set = <T extends Annot>(cur: T, change: Partial<T>): T => {
    const keys = Object.keys(change) as (keyof T)[];
    return keys.some((k) => cur[k] !== change[k]) ? { ...cur, ...change } : cur;
  };
  switch (a.kind) {
    case 'rect':
    case 'oval':
      next = set(a, {
        ...(has('stroke') ? { color: s.stroke } : {}),
        ...(has('fill') ? { fill: s.fill } : {}),
        ...(has('width') ? { width: s.width } : {}),
      });
      break;
    case 'line':
    case 'arrow':
    case 'ink':
      next = set(a, { ...(has('stroke') ? { color: s.stroke } : {}), ...(has('width') ? { width: s.width } : {}) });
      break;
    case 'text':
      next = set(a, {
        ...(has('stroke') ? { border: s.stroke } : {}),
        ...(has('width') ? { borderWidth: s.width } : {}),
        ...(has('fill') ? { fill: s.fill } : {}),
        ...(has('textColor') ? { color: s.textColor } : {}),
        ...(has('fontSize') ? { fontSize: s.fontSize } : {}),
      });
      break;
    default:
      break;
  }
  return next === a ? a : { ...next, modified: now() };
}

/** Light smoothing of a freehand stroke, then thinning so points are at least INK_MIN_STEP apart. */
export function finishInk(points: readonly PdfPoint[]): PdfPoint[] {
  if (points.length <= 2) return thin(points);
  const smooth: PdfPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    smooth.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 });
  }
  smooth.push(points[points.length - 1]!);
  return thin(smooth);
}

function thin(input: readonly PdfPoint[]): PdfPoint[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  const points = input.map((p) => ({ x: round(p.x), y: round(p.y) }));
  const out: PdfPoint[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= INK_MIN_STEP) out.push(p);
    else if (out.length > 1 && p === points[points.length - 1]) out[out.length - 1] = p;
  }
  // Replacing the last kept point may bring it closer than the step to the one before.
  while (out.length > 2) {
    const a = out[out.length - 2]!;
    const b = out[out.length - 1]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) >= INK_MIN_STEP) break;
    out.splice(out.length - 2, 1);
  }
  return out;
}
