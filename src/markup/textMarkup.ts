/**
 * Text markup geometry from the browser selection: each client rect of the selected text that
 * lies on a page becomes a rect in that page's PDF space, rects on one line merge, and every
 * merged rect becomes one quad. One entry per page touched.
 */
import type { PdfRect, Quad } from '../annot/types';
import type { PageView } from '../viewer/viewer';

/** Rects closer than this (points) along the line join. */
const JOIN_GAP = 2;
/** Rects join when they share at least this fraction of the smaller one's height. */
const JOIN_OVERLAP = 0.5;

const clean = (n: number) => (n === 0 ? 0 : Math.round(n * 1000) / 1000);

function joins(a: PdfRect, b: PdfRect): boolean {
  const shared = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const smaller = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
  return shared >= JOIN_OVERLAP * smaller - 1e-9 && gap <= JOIN_GAP + 1e-9;
}

const union = (a: PdfRect, b: PdfRect): PdfRect => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/**
 * Merges rects (upright text, y up) that overlap vertically by at least half the smaller
 * height and touch or overlap horizontally within 2 pt; one quad per merged rect, upper lines
 * first, then left to right. Quads are top-left, top-right, bottom-left, bottom-right.
 */
export function quadsForRects(rects: readonly PdfRect[]): Quad[] {
  let groups = rects.filter((r) => r.x1 - r.x0 > 0 && r.y1 - r.y0 > 0).map((r) => ({ ...r }));
  for (let merged = true; merged; ) {
    merged = false;
    const next: PdfRect[] = [];
    for (const r of groups) {
      const i = next.findIndex((g) => joins(g, r));
      if (i < 0) next.push(r);
      else {
        next[i] = union(next[i]!, r);
        merged = true;
      }
    }
    groups = next;
  }
  groups.sort((a, b) => {
    const sameLine = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0;
    return sameLine ? a.x0 - b.x0 : b.y1 - a.y1;
  });
  return groups.map((g) => [g.x0, g.y1, g.x1, g.y1, g.x0, g.y0, g.x1, g.y0].map(clean) as unknown as Quad);
}

type Turn = 0 | 90 | 180 | 270;

/** Rotates a point counter-clockwise by a multiple of 90° (exact, no trigonometry). */
function turn(x: number, y: number, by: Turn): [number, number] {
  switch (by) {
    case 0:
      return [x, y];
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
  }
}

const normTurn = (deg: number): Turn => ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Turn;

/**
 * `quadsForRects` for text turned `angle` degrees counter-clockwise in page space (rounded to
 * a multiple of 90): lines merge along the text direction and each quad's top edge is the
 * text's top.
 */
export function quadsInTextFrame(rects: readonly PdfRect[], angle: number): Quad[] {
  const a = normTurn(angle);
  if (a === 0) return quadsForRects(rects);
  return quadsForRects(rects.map((r) => frameRect(r, a))).map((q) => {
    const out: number[] = [];
    for (let i = 0; i < 8; i += 2) out.push(...turn(q[i]!, q[i + 1]!, a));
    return out.map(clean) as unknown as Quad;
  });
}

export interface PageMarks {
  quads: Quad[];
  /** The selected text on that page, whitespace collapsed. */
  text: string;
}

/** The selected part of one text node. */
interface Piece {
  rects: PdfRect[];
  /** Counter-clockwise page-space angle of its text, a multiple of 90. */
  angle: Turn;
  text: string;
}

/** The selected part [start, end) of a text node, or null when the range does not reach it. */
function clip(range: Range, node: Text): [number, number] | null {
  const len = node.length;
  const start = range.startContainer === node ? range.startOffset : range.comparePoint(node, 0) >= 0 ? 0 : len;
  const end = range.endContainer === node ? range.endOffset : range.comparePoint(node, len) <= 0 ? len : 0;
  return start < end ? [start, end] : null;
}

/** Counter-clockwise page-space angle of the text in a pdf.js text layer span. */
function textAngle(node: Text): number {
  const span = node.parentElement?.closest<HTMLElement>('.textLayer span');
  const css = span ? parseFloat(span.style.getPropertyValue('--rotate')) : 0;
  return Number.isFinite(css) ? -css : 0;
}

/**
 * Splits the selection by page: for every document-view page whose text layer it touches, the
 * quads of the selected lines and the selected text.
 */
export function selectionToMarks(sel: Selection, views: readonly PageView[]): Map<number, PageMarks> {
  const out = new Map<number, PageMarks>();
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i);
    if (range.collapsed) continue;
    for (const view of views) {
      if (!view.interactive) continue;
      const layer = view.el.querySelector<HTMLElement>('.textLayer');
      if (!layer || !range.intersectsNode(layer)) continue;
      const pieces = piecesOn(view, layer, range);
      if (pieces.length === 0) continue;
      const byAngle = new Map<Turn, PdfRect[]>();
      for (const p of pieces) byAngle.set(p.angle, [...(byAngle.get(p.angle) ?? []), ...p.rects]);
      const quads: Quad[] = [];
      for (const [angle, rects] of byAngle) quads.push(...quadsInTextFrame(rects, angle));
      if (quads.length === 0) continue;
      const prev = out.get(view.index);
      const text = joinText(pieces);
      out.set(view.index, prev ? { quads: [...prev.quads, ...quads], text: `${prev.text} ${text}`.trim() } : { quads, text });
    }
  }
  return out;
}

function piecesOn(view: PageView, layer: HTMLElement, range: Range): Piece[] {
  const pieces: Piece[] = [];
  const host = view.el.getBoundingClientRect();
  const vp = view.viewport;
  const kx = host.width > 0 ? vp.width / host.width : 1;
  const ky = host.height > 0 ? vp.height / host.height : 1;
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.parentElement?.closest('.textLayer span')) continue;
    const part = clip(range, node);
    if (!part) continue;
    const text = node.data.slice(part[0], part[1]);
    if (text.trim() === '') continue;
    const sub = document.createRange();
    sub.setStart(node, part[0]);
    sub.setEnd(node, part[1]);
    const rects: PdfRect[] = [];
    for (const r of sub.getClientRects()) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      const [ax, ay] = vp.convertToPdfPoint((r.left - host.left) * kx, (r.top - host.top) * ky) as [number, number];
      const [bx, by] = vp.convertToPdfPoint((r.right - host.left) * kx, (r.bottom - host.top) * ky) as [number, number];
      rects.push({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) });
    }
    if (rects.length > 0) pieces.push({ rects, angle: normTurn(textAngle(node)), text });
  }
  return pieces;
}

/** Joins the pieces' text, with a space where a piece starts a new line. */
function joinText(pieces: readonly Piece[]): string {
  let out = '';
  let prev: PdfRect | null = null;
  for (const p of pieces) {
    const first = frameRect(p.rects[0]!, p.angle);
    if (prev && Math.min(prev.y1, first.y1) - Math.max(prev.y0, first.y0) <= 0) out += ' ';
    out += p.text;
    prev = first;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** A page-space rect in the frame of text turned `angle`, where the text runs along +x. */
function frameRect(r: PdfRect, angle: Turn): PdfRect {
  const back = ((360 - angle) % 360) as Turn;
  const [x0, y0] = turn(r.x0, r.y0, back);
  const [x1, y1] = turn(r.x1, r.y1, back);
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}
