/**
 * Draws this app's annotations over a page (document view or thumbnail). Marks and shapes are
 * SVG under the viewport's transform, so the model's PDF coordinates are used directly; text
 * boxes and notes are HTML laid out in points (1 pt = 1 px) and scaled as a whole, so their line
 * breaks never depend on the zoom. Nothing here takes pointer events except selection handles.
 */
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport';
import { annotBounds, annotBox, arrowHead, quadPolygon } from '../annot/geometry';
import type { Annot, PdfPoint, PdfRect, Quad, TextAngle } from '../annot/types';
import type { EditableDocument } from '../edit/document';
import type { PageGoneListener, PageView, PageViewListener } from '../viewer/viewer';

const SVG_NS = 'http://www.w3.org/2000/svg';

export { markThickness, roundedRadius, STRIKEOUT_AT, TEXT_FONT, TEXT_LINE_HEIGHT, TEXT_PADDING, UNDERLINE_AT } from '../annot/style';
import { markThickness, roundedRadius, STRIKEOUT_AT, UNDERLINE_AT } from '../annot/style';

export interface OverlayOptions {
  /** An annotation being edited in place (text box or note); the editor draws it instead. */
  editing?: string | null;
}

/** Where an annotation is: the page (by `PageRef.id`) and its id. */
export interface AnnotRef {
  readonly pageId: number;
  readonly annotId: string;
}

/** Screen rect (CSS px, relative to the page element) of a PDF rect. */
export function viewRect(vp: PageViewport, r: PdfRect): { left: number; top: number; right: number; bottom: number } {
  const [ax, ay] = vp.convertToViewportPoint(r.x0, r.y0) as [number, number];
  const [bx, by] = vp.convertToViewportPoint(r.x1, r.y1) as [number, number];
  return { left: Math.min(ax, bx), top: Math.min(ay, by), right: Math.max(ax, bx), bottom: Math.max(ay, by) };
}

/** Clockwise degrees the text of a box with `angle` is turned on screen. */
export function screenAngle(vp: PageViewport, angle: TextAngle): number {
  return (((vp.rotation - angle) % 360) + 360) % 360;
}

/** The box's size in its own text direction, points. */
export function localSize(rect: PdfRect, angle: TextAngle): { width: number; height: number } {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  return angle % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

/**
 * Positions `el` (sized in points) so that, rotated and scaled about its center, it covers
 * `rect` on the page.
 */
export function placeBox(el: HTMLElement, vp: PageViewport, rect: PdfRect, angle: TextAngle): void {
  const r = viewRect(vp, rect);
  const { width, height } = localSize(rect, angle);
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.left = `${cx - width / 2}px`;
  el.style.top = `${cy - height / 2}px`;
  el.style.transform = `rotate(${screenAngle(vp, angle)}deg) scale(${vp.scale})`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();
const pt = (p: PdfPoint) => `${fmt(p.x)} ${fmt(p.y)}`;

function polyPath(points: readonly PdfPoint[], closed: boolean): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${pt(points[0]!)}l0 0`;
  return `M${points.map(pt).join('L')}${closed ? 'Z' : ''}`;
}

/** The line across a quad at `t` of its height above the bottom edge, and that height. */
function quadLine(q: Quad, t: number): { from: PdfPoint; to: PdfPoint; height: number } {
  const [tlx, tly, trx, try_, blx, bly, brx, bry] = q;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    from: { x: lerp(blx, tlx), y: lerp(bly, tly) },
    to: { x: lerp(brx, trx), y: lerp(bry, try_) },
    height: Math.hypot(tlx - blx, tly - bly),
  };
}

function group(a: Annot): SVGGElement {
  const g = svgEl('g', { 'data-annot-id': a.id, 'data-kind': a.kind });
  if (a.opacity < 1) g.setAttribute('opacity', String(a.opacity));
  return g;
}

function drawSvg(a: Annot): SVGGElement | null {
  const g = group(a);
  switch (a.kind) {
    case 'highlight':
      g.append(svgEl('path', { d: a.quads.map((q) => polyPath(quadPolygon(q), true)).join(''), fill: a.color }));
      return g;
    case 'underline':
    case 'strikeout': {
      const at = a.kind === 'underline' ? UNDERLINE_AT : STRIKEOUT_AT;
      // The marked area itself is invisible; it gives the group the quads' bounds.
      g.append(svgEl('path', { d: a.quads.map((q) => polyPath(quadPolygon(q), true)).join(''), fill: 'none' }));
      for (const q of a.quads) {
        const { from, to, height } = quadLine(q, at);
        g.append(svgEl('path', { d: `M${pt(from)}L${pt(to)}`, fill: 'none', stroke: a.color, 'stroke-width': fmt(markThickness(height)) }));
      }
      return g;
    }
    case 'rect': {
      const { x0, y0, x1, y1 } = a.rect;
      const radius = a.rounded ? roundedRadius(a.rect) : 0;
      g.append(
        svgEl('rect', {
          x: fmt(x0),
          y: fmt(y0),
          width: fmt(x1 - x0),
          height: fmt(y1 - y0),
          rx: fmt(radius),
          ry: fmt(radius),
          fill: a.fill ?? 'none',
          stroke: a.color,
          'stroke-width': fmt(a.width),
        }),
      );
      return g;
    }
    case 'oval': {
      const { x0, y0, x1, y1 } = a.rect;
      g.append(
        svgEl('ellipse', {
          cx: fmt((x0 + x1) / 2),
          cy: fmt((y0 + y1) / 2),
          rx: fmt((x1 - x0) / 2),
          ry: fmt((y1 - y0) / 2),
          fill: a.fill ?? 'none',
          stroke: a.color,
          'stroke-width': fmt(a.width),
        }),
      );
      return g;
    }
    case 'line':
    case 'arrow': {
      let d = `M${pt(a.from)}L${pt(a.to)}`;
      const head = a.kind === 'arrow' ? arrowHead(a.from, a.to, a.width) : null;
      if (head) d += `M${pt(head[0])}L${pt(a.to)}L${pt(head[1])}`;
      g.append(svgEl('path', { d, fill: 'none', stroke: a.color, 'stroke-width': fmt(a.width) }));
      return g;
    }
    case 'ink':
      g.append(
        svgEl('path', { d: a.paths.map((p) => polyPath(p, false)).join(''), fill: 'none', stroke: a.color, 'stroke-width': fmt(a.width) }),
      );
      return g;
    default:
      return null;
  }
}

function drawHtml(a: Annot, vp: PageViewport): HTMLElement | null {
  if (a.kind === 'text') {
    const el = document.createElement('div');
    el.className = 'mk-text';
    el.dataset['annotId'] = a.id;
    el.dataset['kind'] = a.kind;
    el.textContent = a.text;
    el.style.fontSize = `${a.fontSize}px`;
    el.style.color = a.color;
    if (a.fill) el.style.background = a.fill;
    if (a.border && a.borderWidth > 0) el.style.border = `${a.borderWidth}px solid ${a.border}`;
    if (a.opacity < 1) el.style.opacity = String(a.opacity);
    placeBox(el, vp, a.rect, a.angle);
    return el;
  }
  if (a.kind === 'note') {
    const el = document.createElement('div');
    el.className = 'mk-note';
    el.dataset['annotId'] = a.id;
    el.dataset['kind'] = a.kind;
    el.style.setProperty('--note', a.color);
    if (a.opacity < 1) el.style.opacity = String(a.opacity);
    placeBox(el, vp, a.rect, a.angle);
    return el;
  }
  return null;
}

/** A selection handle: a small dot with a larger invisible grab area. */
function handle(name: string, x: number, y: number): SVGGElement {
  const g = svgEl('g', { 'data-handle': name, class: 'mk-handle' });
  g.append(svgEl('circle', { class: 'mk-handle-hit', cx: fmt(x), cy: fmt(y), r: 8 }), svgEl('circle', { class: 'mk-handle-dot', cx: fmt(x), cy: fmt(y), r: 4 }));
  return g;
}

const isMark = (a: Annot) => a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout';

/** One page's annotation drawing, appended to `PageView.el`. */
export class PageOverlay {
  readonly root: HTMLElement;
  private readonly marks: SVGSVGElement;
  private readonly shapes: SVGSVGElement;
  private readonly html: HTMLElement;
  /** Selection outline and handles (document view only). */
  readonly handles: SVGSVGElement;
  private last: { annots: readonly Annot[] | null; selected: string | null; editing: string | null; vpKey: string } | null = null;

  constructor(view: PageView) {
    this.root = document.createElement('div');
    this.root.className = 'markup-overlay';
    this.marks = svgEl('svg', { class: 'mk-marks', 'aria-hidden': 'true' });
    this.shapes = svgEl('svg', { class: 'mk-shapes', 'aria-hidden': 'true' });
    this.html = document.createElement('div');
    this.html.className = 'mk-html';
    this.handles = svgEl('svg', { class: 'mk-handles' });
    for (const s of [this.marks, this.shapes, this.handles]) s.setAttribute('preserveAspectRatio', 'none');
    this.root.append(this.marks, this.shapes, this.html, this.handles);
    view.el.append(this.root);
  }

  update(view: PageView, annots: readonly Annot[] | null, selected: string | null, opts: OverlayOptions = {}): void {
    const vp = view.viewport;
    const editing = opts.editing ?? null;
    const vpKey = `${vp.transform.join(',')}|${vp.width}|${vp.height}`;
    const l = this.last;
    if (l && l.annots === annots && l.selected === selected && l.editing === editing && l.vpKey === vpKey) return;
    this.last = { annots, selected, editing, vpKey };
    if (this.root.parentElement !== view.el) view.el.append(this.root);

    const box = `0 0 ${fmt(vp.width)} ${fmt(vp.height)}`;
    const matrix = `matrix(${vp.transform.map(fmt).join(' ')})`;
    const marks = svgEl('g', { transform: matrix });
    const shapes = svgEl('g', { transform: matrix });
    const html: HTMLElement[] = [];
    for (const a of annots ?? []) {
      if (a.id === editing) continue;
      if (a.kind === 'text' || a.kind === 'note') {
        const el = drawHtml(a, vp);
        if (el) html.push(el);
        continue;
      }
      const g = drawSvg(a);
      if (g) (isMark(a) ? marks : shapes).append(g);
    }
    for (const s of [this.marks, this.shapes, this.handles]) s.setAttribute('viewBox', box);
    this.marks.replaceChildren(marks);
    this.shapes.replaceChildren(shapes);
    this.html.replaceChildren(...html);
    this.drawSelection(view, annots, selected, editing);
  }

  destroy(): void {
    this.root.remove();
    this.last = null;
  }

  /**
   * Selection: an outline, plus corner and edge handles for boxes (shapes, text boxes,
   * drawings) or two endpoint handles for lines; text markup and notes only get the outline.
   */
  private drawSelection(view: PageView, annots: readonly Annot[] | null, selected: string | null, editing: string | null): void {
    this.handles.replaceChildren();
    if (!view.interactive || !selected || selected === editing) return;
    const a = annots?.find((x) => x.id === selected);
    if (!a) return;
    const vp = view.viewport;
    if (a.kind === 'line' || a.kind === 'arrow') {
      for (const [name, p] of [['from', a.from], ['to', a.to]] as const) {
        const [x, y] = vp.convertToViewportPoint(p.x, p.y) as [number, number];
        this.handles.append(handle(name, x, y));
      }
      return;
    }
    const boxed = a.kind === 'rect' || a.kind === 'oval' || a.kind === 'text' || a.kind === 'ink';
    const r = viewRect(vp, boxed ? annotBox(a) : annotBounds(a));
    const pad = boxed ? 0 : 2;
    this.handles.append(
      svgEl('rect', {
        class: 'mk-outline',
        x: fmt(r.left - pad),
        y: fmt(r.top - pad),
        width: fmt(r.right - r.left + 2 * pad),
        height: fmt(r.bottom - r.top + 2 * pad),
      }),
    );
    if (!boxed) return;
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const spots: Array<[string, number, number]> = [
      ['nw', r.left, r.top],
      ['n', cx, r.top],
      ['ne', r.right, r.top],
      ['e', r.right, cy],
      ['se', r.right, r.bottom],
      ['s', cx, r.bottom],
      ['sw', r.left, r.bottom],
      ['w', r.left, cy],
    ];
    for (const [name, x, y] of spots) this.handles.append(handle(name, x, y));
  }
}

export interface PageViewSource {
  onPageView(cb: PageViewListener): () => void;
  onPageGone(cb: PageGoneListener): () => void;
  getPageViews(): PageView[];
}

/**
 * Keeps one `PageOverlay` per page element of every source (document view, thumbnails) and
 * redraws them from the document's annotations, the selection and in-progress drafts.
 */
export class OverlayHost {
  private readonly overlays = new Map<HTMLElement, PageOverlay>();
  private readonly latest = new Map<HTMLElement, PageView>();
  private selectedRef: AnnotRef | null = null;
  private editingRef: AnnotRef | null = null;
  /** Annotation lists shown instead of the document's while a gesture is in progress (document view only). */
  private readonly drafts = new Map<number, readonly Annot[]>();
  /** An annotation shown before it is committed (a new note while its popup is open). */
  private pending: { pageId: number; annot: Annot } | null = null;

  constructor(
    private readonly doc: () => EditableDocument | null,
    private readonly sources: readonly PageViewSource[],
  ) {
    for (const s of sources) {
      s.onPageView((view) => {
        this.latest.set(view.el, view);
        this.draw(view);
      });
      s.onPageGone((el) => {
        this.overlays.get(el)?.destroy();
        this.overlays.delete(el);
        this.latest.delete(el);
      });
    }
  }

  get selected(): AnnotRef | null {
    return this.selectedRef;
  }

  get editing(): AnnotRef | null {
    return this.editingRef;
  }

  setSelected(ref: AnnotRef | null): void {
    this.selectedRef = ref;
    this.refresh();
  }

  setEditing(ref: AnnotRef | null): void {
    this.editingRef = ref;
    this.refresh();
  }

  /** Shows `annot` on its page (document view only) until cleared with null. */
  setPending(pageId: number, annot: Annot | null): void {
    this.pending = annot ? { pageId, annot } : null;
    this.refresh();
  }

  /** Shows `list` for the page at `position` in the document view until cleared with null. */
  setDraft(position: number, list: readonly Annot[] | null): void {
    if (list) this.drafts.set(position, list);
    else this.drafts.delete(position);
    for (const v of this.sources[0]?.getPageViews() ?? []) if (v.index === position) this.draw(v);
  }

  clearDrafts(): void {
    if (this.drafts.size === 0) return;
    this.drafts.clear();
    this.refresh();
  }

  /** The overlay drawn on a page element, if any. */
  overlayFor(el: HTMLElement): PageOverlay | undefined {
    return this.overlays.get(el);
  }

  /** Redraws every page that is on screen. */
  refresh(): void {
    for (const s of this.sources) for (const v of s.getPageViews()) this.draw(v);
  }

  /** The annotations a view shows, or null when it must draw none. */
  annotsFor(view: PageView): readonly Annot[] | null {
    const doc = this.doc();
    if (!doc || view.canvasGeneration !== doc.hideGeneration(view.index)) return null;
    const list = doc.annotationsAt(view.index);
    if (list === null) return null;
    if (!view.interactive) return list;
    const shown = this.drafts.get(view.index) ?? list;
    const p = this.pending;
    return p && doc.pages[view.index]?.id === p.pageId ? [...shown, p.annot] : shown;
  }

  private draw(view: PageView): void {
    let overlay = this.overlays.get(view.el);
    if (!overlay) {
      overlay = new PageOverlay(view);
      this.overlays.set(view.el, overlay);
    }
    const pageId = this.doc()?.pages[view.index]?.id;
    const on = (ref: AnnotRef | null) => (ref && ref.pageId === pageId ? ref.annotId : null);
    overlay.update(view, this.annotsFor(view), on(this.selectedRef), { editing: on(this.editingRef) });
  }
}
