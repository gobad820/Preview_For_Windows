/** Pure geometry over the annotation model, in PDF user space. Shared by the overlay and the writer. */
import type { Annot, PdfPoint, PdfRect, Quad } from './types';

/** Arrowhead length in points for a stroke width. */
export const ARROW_LEN = (width: number): number => Math.max(6, 3 * width);
/** Angle between the shaft and each side of the arrowhead, radians. */
export const ARROW_ANGLE = Math.PI / 6;

export function normRect(a: PdfPoint, b: PdfPoint): PdfRect {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

/** The two open ends of the arrowhead at `to`, or null for a zero-length line. */
export function arrowHead(from: PdfPoint, to: PdfPoint, width: number): [PdfPoint, PdfPoint] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const back = Math.atan2(-dy, -dx);
  const l = ARROW_LEN(width);
  const wing = (a: number): PdfPoint => ({ x: to.x + l * Math.cos(a), y: to.y + l * Math.sin(a) });
  return [wing(back + ARROW_ANGLE), wing(back - ARROW_ANGLE)];
}

/** The quad's corners in drawing order (top-left, top-right, bottom-right, bottom-left). */
export function quadPolygon(q: Quad): PdfPoint[] {
  return [
    { x: q[0], y: q[1] },
    { x: q[2], y: q[3] },
    { x: q[6], y: q[7] },
    { x: q[4], y: q[5] },
  ];
}

function boundsOf(points: Iterable<PdfPoint>, grow = 0): PdfRect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0: x0 - grow, y0: y0 - grow, x1: x1 + grow, y1: y1 + grow };
}

function grown(r: PdfRect, by: number): PdfRect {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by };
}

/** Points that define the annotation's geometry (for bounds and boxes). */
function* pointsOf(a: Annot): Generator<PdfPoint> {
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      for (const q of a.quads) yield* quadPolygon(q);
      return;
    case 'rect':
    case 'oval':
    case 'text':
    case 'note':
      yield { x: a.rect.x0, y: a.rect.y0 };
      yield { x: a.rect.x1, y: a.rect.y1 };
      return;
    case 'line':
    case 'arrow':
      yield a.from;
      yield a.to;
      return;
    case 'ink':
      for (const path of a.paths) yield* path;
      return;
  }
}

/** Everything the annotation paints, including half the stroke width and arrowheads; the writer's /Rect. */
export function annotBounds(a: Annot): PdfRect {
  switch (a.kind) {
    case 'rect':
    case 'oval':
      return grown(a.rect, a.width / 2);
    case 'text':
    case 'note':
      return a.rect;
    case 'line':
    case 'arrow': {
      const pts = [a.from, a.to];
      const head = a.kind === 'arrow' ? arrowHead(a.from, a.to, a.width) : null;
      if (head) pts.push(...head);
      return boundsOf(pts, a.width / 2);
    }
    case 'ink':
      return boundsOf(pointsOf(a), a.width / 2);
    default:
      return boundsOf(pointsOf(a));
  }
}

/** The box resize handles act on: the geometry without stroke allowances. */
export function annotBox(a: Annot): PdfRect {
  return boundsOf(pointsOf(a));
}

function mapAnnot<T extends Annot>(a: T, f: (p: PdfPoint) => PdfPoint): T {
  const rect = (r: PdfRect) => normRect(f({ x: r.x0, y: r.y0 }), f({ x: r.x1, y: r.y1 }));
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return {
        ...a,
        quads: a.quads.map((q) => {
          const out: number[] = [];
          for (let i = 0; i < 8; i += 2) {
            const p = f({ x: q[i]!, y: q[i + 1]! });
            out.push(p.x, p.y);
          }
          return out as unknown as Quad;
        }),
      };
    case 'rect':
    case 'oval':
    case 'text':
    case 'note':
      return { ...a, rect: rect(a.rect) };
    case 'line':
    case 'arrow':
      return { ...a, from: f(a.from), to: f(a.to) };
    case 'ink':
      return { ...a, paths: a.paths.map((path) => path.map(f)) };
  }
}

export function translateAnnot<T extends Annot>(a: T, dx: number, dy: number): T {
  return mapAnnot(a, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Maps the annotation's geometry from box `from` to box `to` (rectangles, ovals, text boxes,
 * ink points, line ends). Text markup and notes keep their size and only move with the box's
 * x0/y0 corner.
 */
export function resizeAnnot<T extends Annot>(a: T, from: PdfRect, to: PdfRect): T {
  if (a.kind === 'note' || a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout') {
    return translateAnnot(a, to.x0 - from.x0, to.y0 - from.y0);
  }
  const fw = from.x1 - from.x0;
  const fh = from.y1 - from.y0;
  const sx = fw === 0 ? 1 : (to.x1 - to.x0) / fw;
  const sy = fh === 0 ? 1 : (to.y1 - to.y0) / fh;
  return mapAnnot(a, (p) => ({ x: to.x0 + (p.x - from.x0) * sx, y: to.y0 + (p.y - from.y0) * sy }));
}

function distToSegment(p: PdfPoint, a: PdfPoint, b: PdfPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function insidePolygon(p: PdfPoint, poly: PdfPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToPolyline(p: PdfPoint, pts: readonly PdfPoint[], closed: boolean): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let d = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) d = Math.min(d, distToSegment(p, pts[i]!, pts[(i + 1) % pts.length]!));
  return d;
}

const inRect = (p: PdfPoint, r: PdfRect, tol: number) =>
  p.x >= r.x0 - tol && p.x <= r.x1 + tol && p.y >= r.y0 - tol && p.y <= r.y1 + tol;

/**
 * True when `p` is on the annotation: inside filled shapes, text boxes, notes and markup
 * quads; within `tol` points (plus half the stroke width) of strokes otherwise.
 */
export function hitTest(a: Annot, p: PdfPoint, tol: number): boolean {
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return a.quads.some((q) => {
        const poly = quadPolygon(q);
        return insidePolygon(p, poly) || (tol > 0 && distToPolyline(p, poly, true) <= tol);
      });
    case 'text':
    case 'note':
      return inRect(p, a.rect, tol);
    case 'rect': {
      const reach = tol + a.width / 2;
      if (a.fill !== null) return inRect(p, a.rect, reach);
      const { x0, y0, x1, y1 } = a.rect;
      const corners = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      return distToPolyline(p, corners, true) <= reach;
    }
    case 'oval': {
      const reach = tol + a.width / 2;
      const cx = (a.rect.x0 + a.rect.x1) / 2;
      const cy = (a.rect.y0 + a.rect.y1) / 2;
      const rx = (a.rect.x1 - a.rect.x0) / 2;
      const ry = (a.rect.y1 - a.rect.y0) / 2;
      if (rx <= 0 || ry <= 0) return distToSegment(p, { x: a.rect.x0, y: a.rect.y0 }, { x: a.rect.x1, y: a.rect.y1 }) <= reach;
      const k = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      if (a.fill !== null && k <= 1) return true;
      const dist = Math.hypot(p.x - cx, p.y - cy);
      // Distance to the outline along the ray from the center (exact on the axes, close elsewhere).
      const toOutline = k === 0 ? Math.min(rx, ry) : dist * Math.abs(1 - 1 / k);
      return toOutline <= reach;
    }
    case 'line':
    case 'arrow': {
      const reach = tol + a.width / 2;
      if (distToSegment(p, a.from, a.to) <= reach) return true;
      const head = a.kind === 'arrow' ? arrowHead(a.from, a.to, a.width) : null;
      return !!head && head.some((w) => distToSegment(p, a.to, w) <= reach);
    }
    case 'ink': {
      const reach = tol + a.width / 2;
      return a.paths.some((path) => path.length > 0 && distToPolyline(p, path, false) <= reach);
    }
  }
}
