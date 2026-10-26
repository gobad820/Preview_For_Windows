/**
 * Markup interaction on the document view: creation tools, in-place text and note editing,
 * and the selected annotation. Every committed change is one `EditableDocument` update, so it
 * is one undo step; gestures in progress are only drafts on the overlay.
 */
import { normRect } from '../annot/geometry';
import {
  NOTE_SIZE,
  type Annot,
  type NoteAnnot,
  type PdfPoint,
  type PdfRect,
  type TextAngle,
  type TextBoxAnnot,
} from '../annot/types';
import type { EditableDocument } from '../edit/document';
import type { Store, ViewerState } from '../store';
import type { PageView, PdfViewer } from '../viewer/viewer';
import { localSize, placeBox, TEXT_LINE_HEIGHT, TEXT_PADDING, viewRect, type AnnotRef, type OverlayHost } from './overlay';
import { NOTE_COLOR, type MarkupState, type Tool } from './state';

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
export const PLACEHOLDER = 'Text';
const NOTE_POPUP = { width: 220, height: 150, gap: 8 } as const;

export interface MarkupDeps {
  doc(): EditableDocument | null;
  viewer: PdfViewer;
  /** The viewer's scroll container; pointer input on pages arrives here. */
  container: HTMLElement;
  state: MarkupState;
  store: Store<ViewerState>;
  overlays: OverlayHost;
}

type ShapeTool = 'line' | 'arrow' | 'rect' | 'rounded' | 'oval';
const SHAPE_TOOLS: readonly Tool[] = ['line', 'arrow', 'rect', 'rounded', 'oval'];

interface Client {
  x: number;
  y: number;
}

interface Gesture {
  pointerId: number;
  tool: Tool;
  pageId: number;
  id: string;
  start: Client;
  last: Client;
  shift: boolean;
  moved: boolean;
  ink: PdfPoint[];
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
const upright = (view: PageView): TextAngle => ((((view.viewport.rotation % 360) + 360) % 360) as TextAngle);

export class MarkupController {
  private gesture: Gesture | null = null;
  private editing: Editing | null = null;
  private selection: AnnotRef | null = null;

  constructor(private readonly deps: MarkupDeps) {
    const c = deps.container;
    c.addEventListener('pointerdown', this.onPointerDown, true);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerCancel);
    // Selection and focus changes come from mousedown; a press markup handles must not make them.
    c.addEventListener('mousedown', this.onMouseDown, true);
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
    this.deps.overlays.setSelected(ref);
  }

  /** Esc: ends editing, cancels a drag, disarms a tool, then deselects. True when it did one of these. */
  handleEscape(): boolean {
    if (this.editing) {
      this.endEditing('escape');
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

  deleteSelected(): boolean {
    return false;
  }

  duplicateSelected(): boolean {
    return false;
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

  /** Replaces the page's list through `edit`; one undo step. Loads the page's annotations first when needed. */
  private updatePage(pageId: number, edit: (list: readonly Annot[]) => readonly Annot[]): void {
    const doc = this.deps.doc();
    const pos = this.positionOf(pageId);
    if (!doc || pos < 0) return;
    const list = doc.annotationsAt(pos);
    if (list === null) {
      void doc.loadAnnotations(pos).then(() => {
        if (this.deps.doc() === doc && doc.annotationsAt(this.positionOf(pageId)) !== null) this.updatePage(pageId, edit);
      });
      return;
    }
    const next = edit(list);
    if (next !== list) doc.setAnnotations(pos, next);
  }

  private add(pageId: number, a: Annot, select = true): void {
    this.updatePage(pageId, (list) => [...list, a]);
    if (select) this.select({ pageId, annotId: a.id });
  }

  // ---- tool state ---------------------------------------------------------------

  private syncTool(): void {
    const tool = this.deps.state.tool;
    this.deps.container.classList.toggle('mk-armed', tool !== 'select');
    this.deps.container.dataset['tool'] = tool;
    if (tool !== 'select' && this.gesture && this.gesture.tool !== tool) this.cancelGesture();
  }

  // ---- pointer input ------------------------------------------------------------------

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.gesture) e.preventDefault();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary) return;
    const doc = this.deps.doc();
    if (!doc) return;
    const tool = this.deps.state.tool;
    if (tool === 'select') return;
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
      pointerId: e.pointerId,
      tool,
      pageId: ref.id,
      id: doc.newAnnotId(),
      start: p,
      last: p,
      shift: e.shiftKey,
      moved: false,
      ink: tool === 'draw' ? [this.toPdf(view, p)] : [],
    };
    this.drawDraft();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
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
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) >= CLICK_SLOP) g.moved = true;
    if (g.tool !== 'draw') return;
    const view = this.viewOf(g.pageId);
    if (!view) return;
    const q = this.toPdf(view, p);
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
    const draft = this.annotFromGesture(g, view, true);
    const list = doc.annotationsAt(view.index) ?? [];
    this.deps.overlays.setDraft(view.index, draft ? [...list, draft] : list);
  }

  private finishGesture(g: Gesture): void {
    this.gesture = null;
    if (this.deps.container.hasPointerCapture?.(g.pointerId)) this.deps.container.releasePointerCapture(g.pointerId);
    this.deps.overlays.clearDrafts();
    const view = this.viewOf(g.pageId);
    if (!view) return;
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
    if (!g.moved) {
      const hw = (CLICK_SHAPE.width / 2) * k;
      const hh = (CLICK_SHAPE.height / 2) * k;
      const c = g.start;
      return normRect(this.toPdf(view, { x: c.x - hw, y: c.y - hh }), this.toPdf(view, { x: c.x + hw, y: c.y + hh }));
    }
    let end = g.last;
    if (g.shift) {
      const dx = end.x - g.start.x;
      const dy = end.y - g.start.y;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      end = { x: g.start.x + (dx < 0 ? -m : m), y: g.start.y + (dy < 0 ? -m : m) };
    }
    return normRect(this.toPdf(view, g.start), this.toPdf(view, end));
  }

  /** Dragged line (Shift: snapped to 45°), or a default-length horizontal line centered on a click. */
  private lineEnds(g: Gesture, view: PageView): [PdfPoint, PdfPoint] {
    if (!g.moved) {
      const half = (CLICK_LINE / 2) * this.pxPerPt(view);
      return [this.toPdf(view, { x: g.start.x - half, y: g.start.y }), this.toPdf(view, { x: g.start.x + half, y: g.start.y })];
    }
    let end = g.last;
    if (g.shift) {
      const dx = end.x - g.start.x;
      const dy = end.y - g.start.y;
      const step = Math.PI / 4;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      const len = Math.hypot(dx, dy);
      end = { x: g.start.x + len * Math.cos(angle), y: g.start.y + len * Math.sin(angle) };
    }
    return [this.toPdf(view, g.start), this.toPdf(view, end)];
  }

  private newTextBox(g: Gesture, view: PageView): TextBoxAnnot {
    const s = this.deps.state.styles;
    const k = this.pxPerPt(view);
    const lineBox = s.fontSize * TEXT_LINE_HEIGHT + 2 * TEXT_PADDING;
    const page = view.el.getBoundingClientRect();
    let a = g.start;
    let b: Client;
    if (g.moved) {
      a = { x: Math.min(g.start.x, g.last.x), y: Math.min(g.start.y, g.last.y) };
      b = { x: Math.max(g.start.x, g.last.x), y: Math.max(g.start.y, g.last.y, a.y + lineBox * k) };
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
      rect: normRect(this.toPdf(view, a), this.toPdf(view, b)),
      text: PLACEHOLDER,
      fontSize: s.fontSize,
      fill: null,
      border: null,
      borderWidth: 1,
      angle: upright(view),
    };
  }

  private newNote(g: Gesture, view: PageView): NoteAnnot {
    const c = this.toPdf(view, g.start);
    const h = NOTE_SIZE / 2;
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
      input.setAttribute('aria-label', 'Text box');
      el = input;
      host = view.el;
    } else {
      el = document.createElement('div');
      el.className = 'mk-note-popup';
      el.style.setProperty('--note', annot.color);
      input.setAttribute('aria-label', 'Note');
      input.placeholder = 'Note';
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
        this.endEditing('escape');
      }
    };
    const onOutside = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) this.endEditing('outside');
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
    const d = needed - height;
    const r = a.rect;
    const rect: PdfRect =
      a.angle === 0
        ? { ...r, y0: r.y0 - d }
        : a.angle === 90
          ? { ...r, x1: r.x1 + d }
          : a.angle === 180
            ? { ...r, y1: r.y1 + d }
            : { ...r, x0: r.x0 - d };
    e.annot = { ...a, rect };
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
  private endEditing(how: 'escape' | 'outside'): void {
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
      if (how === 'escape') this.select(ref);
    }
    if (e.input === document.activeElement || !document.activeElement || document.activeElement === document.body) {
      this.deps.container.focus({ preventScroll: true });
    }
  }
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
