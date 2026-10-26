/**
 * Appearance streams for this app's annotations: what every PDF viewer draws for them. The form
 * space of each stream is page user space (its /BBox is the annotation's /Rect and its /Matrix
 * the identity), so model coordinates are used as they are. Pure: no pdf-lib here.
 */
import { annotBounds, arrowHead, quadPolygon } from './geometry';
import { markThickness, roundedRadius, STRIKEOUT_AT, TEXT_LINE_HEIGHT, TEXT_PADDING, UNDERLINE_AT } from './style';
import type {
  Annot,
  Color,
  InkAnnot,
  LineAnnot,
  MarkupAnnot,
  NoteAnnot,
  PdfPoint,
  PdfRect,
  ShapeAnnot,
  TextAngle,
  TextBoxAnnot,
} from './types';

/** A font as the text box appearance needs it; the writer adapts an embedded pdf-lib font. */
export interface AppearanceFont {
  /** Resource name the content refers to (`/<name> size Tf`). */
  readonly name: string;
  /** The text as a hex string operand for `Tj`, or null when the font cannot show a character. */
  encode(text: string): string | null;
  widthOf(text: string, size: number): number;
  /** Ascent and descent as fractions of the font size (descent is negative). */
  readonly ascent: number;
  readonly descent: number;
}

export interface Appearance {
  /** The annotation's /Rect, also the form's /BBox. */
  readonly rect: PdfRect;
  readonly content: string;
  /** Present when the content selects `/GS0` (opacity, and Multiply blending for highlights). */
  readonly extGState?: { readonly opacity: number; readonly multiply: boolean };
  /** True when the content selects the font. */
  readonly usesFont: boolean;
}


const n = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const pt = (p: PdfPoint) => `${n(p.x)} ${n(p.y)}`;

export function hexToRgb(c: Color): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}

const rgb = (c: Color) => hexToRgb(c).map(n).join(' ');

/** Bezier constant for quarter circles. */
const K = 0.5523;

/** Path operators (no painting) for a polyline; a single point becomes a dot. */
function polyline(points: readonly PdfPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `${pt(points[0]!)} m ${pt(points[0]!)} l`;
  return `${pt(points[0]!)} m ${points.slice(1).map((p) => `${pt(p)} l`).join(' ')}`;
}

function roundedRectPath(r: PdfRect, radius: number): string {
  const { x0, y0, x1, y1 } = r;
  const k = radius * (1 - K);
  return [
    `${n(x0 + radius)} ${n(y0)} m`,
    `${n(x1 - radius)} ${n(y0)} l`,
    `${n(x1 - k)} ${n(y0)} ${n(x1)} ${n(y0 + k)} ${n(x1)} ${n(y0 + radius)} c`,
    `${n(x1)} ${n(y1 - radius)} l`,
    `${n(x1)} ${n(y1 - k)} ${n(x1 - k)} ${n(y1)} ${n(x1 - radius)} ${n(y1)} c`,
    `${n(x0 + radius)} ${n(y1)} l`,
    `${n(x0 + k)} ${n(y1)} ${n(x0)} ${n(y1 - k)} ${n(x0)} ${n(y1 - radius)} c`,
    `${n(x0)} ${n(y0 + radius)} l`,
    `${n(x0)} ${n(y0 + k)} ${n(x0 + k)} ${n(y0)} ${n(x0 + radius)} ${n(y0)} c`,
    'h',
  ].join(' ');
}

function ovalPath(r: PdfRect): string {
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const rx = (r.x1 - r.x0) / 2;
  const ry = (r.y1 - r.y0) / 2;
  const ox = rx * K;
  const oy = ry * K;
  return [
    `${n(cx + rx)} ${n(cy)} m`,
    `${n(cx + rx)} ${n(cy + oy)} ${n(cx + ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c`,
    `${n(cx - ox)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + oy)} ${n(cx - rx)} ${n(cy)} c`,
    `${n(cx - rx)} ${n(cy - oy)} ${n(cx - ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c`,
    `${n(cx + ox)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - oy)} ${n(cx + rx)} ${n(cy)} c`,
    'h',
  ].join(' ');
}

function markup(a: MarkupAnnot): string {
  const ops: string[] = [];
  if (a.kind === 'highlight') {
    ops.push(`${rgb(a.color)} rg`);
    for (const q of a.quads) {
      const [p0, p1, p2, p3] = quadPolygon(q);
      ops.push(`${pt(p0!)} m ${pt(p1!)} l ${pt(p2!)} l ${pt(p3!)} l h f`);
    }
    return ops.join('\n');
  }
  ops.push(`${rgb(a.color)} RG 0 J`);
  for (const q of a.quads) {
    const tl = { x: q[0], y: q[1] };
    const bl = { x: q[4], y: q[5] };
    const br = { x: q[6], y: q[7] };
    const ux = tl.x - bl.x;
    const uy = tl.y - bl.y;
    const h = Math.hypot(ux, uy);
    if (h === 0) continue;
    const width = markThickness(h);
    const t = a.kind === 'underline' ? UNDERLINE_AT : STRIKEOUT_AT;
    const from = { x: bl.x + ux * t, y: bl.y + uy * t };
    const to = { x: br.x + ux * t, y: br.y + uy * t };
    ops.push(`${n(width)} w ${pt(from)} m ${pt(to)} l S`);
  }
  return ops.join('\n');
}

function shape(a: ShapeAnnot): string {
  const r = a.rect;
  const paint = a.fill !== null ? 'B' : 'S';
  // Round caps and joins, as the overlay strokes shapes.
  const head = [`1 J 1 j ${n(a.width)} w ${rgb(a.color)} RG`];
  if (a.fill !== null) head.push(`${rgb(a.fill)} rg`);
  let path: string;
  if (a.kind === 'oval') path = ovalPath(r);
  else if (a.rounded) path = roundedRectPath(r, roundedRadius(r));
  else path = `${n(r.x0)} ${n(r.y0)} ${n(r.x1 - r.x0)} ${n(r.y1 - r.y0)} re`;
  return `${head.join(' ')}\n${path} ${paint}`;
}

function line(a: LineAnnot): string {
  const ops = [`1 J 1 j ${n(a.width)} w ${rgb(a.color)} RG`, `${pt(a.from)} m ${pt(a.to)} l S`];
  const head = a.kind === 'arrow' ? arrowHead(a.from, a.to, a.width) : null;
  if (head) ops.push(`${pt(head[0])} m ${pt(a.to)} l ${pt(head[1])} l S`);
  return ops.join('\n');
}

function ink(a: InkAnnot): string {
  const ops = [`1 J 1 j ${n(a.width)} w ${rgb(a.color)} RG`];
  for (const path of a.paths) if (path.length > 0) ops.push(`${polyline(path)} S`);
  return ops.join('\n');
}

/** Unit vectors of a text frame rotated by `angle`: baseline direction and up direction. */
function frame(angle: TextAngle): { b: PdfPoint; u: PdfPoint } {
  const rad = (angle * Math.PI) / 180;
  const c = Math.round(Math.cos(rad));
  const s = Math.round(Math.sin(rad));
  return { b: { x: c, y: s }, u: { x: -s, y: c } };
}

/** The rect corner at the start of the first line (top-left as the text reads). */
function frameOrigin(r: PdfRect, angle: TextAngle): PdfPoint {
  const { b, u } = frame(angle);
  const corners = [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x0, y: r.y1 },
    { x: r.x1, y: r.y1 },
  ];
  let best = corners[0]!;
  let score = Infinity;
  for (const c of corners) {
    const s = c.x * b.x + c.y * b.y - (c.x * u.x + c.y * u.y);
    if (s < score) {
      score = s;
      best = c;
    }
  }
  return best;
}

/** Width of a text box along its baseline (the box is stored in page space). */
export function textFrameWidth(r: PdfRect, angle: TextAngle): number {
  return angle % 180 === 0 ? r.x1 - r.x0 : r.y1 - r.y0;
}


/**
 * Breaks `text` into lines no wider than `width`, like the overlay's CSS (`white-space:
 * pre-wrap; word-break: keep-all; overflow-wrap: anywhere`): hard breaks at newlines, soft
 * breaks at spaces only (Hangul words stay whole), a word longer than a line split by
 * character, trailing spaces hang.
 */
export function wrapText(text: string, width: number, size: number, font: Pick<AppearanceFont, 'widthOf'>): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const t of para.match(/\s+|\S+/gu) ?? []) {
      if (/^\s+$/u.test(t)) {
        line += t;
        continue;
      }
      if (font.widthOf(line + t, size) <= width) {
        line += t;
        continue;
      }
      if (line.trim() !== '') out.push(line.trimEnd());
      line = '';
      if (font.widthOf(t, size) <= width) {
        line = t;
        continue;
      }
      for (const ch of Array.from(t)) {
        if (line !== '' && font.widthOf(line + ch, size) > width) {
          out.push(line);
          line = '';
        }
        line += ch;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * A text box: fill, border and the wrapped text. Without a font that can show the text only the
 * box is drawn (the text stays in /Contents), so the annotation keeps its marker and stays editable.
 */
function textBox(a: TextBoxAnnot, font: AppearanceFont | null): { content: string; usesFont: boolean } {
  const r = a.rect;
  const size = a.fontSize;
  let lines = font && a.text.trim() !== '' ? wrapText(a.text, textFrameWidth(r, a.angle) - 2 * TEXT_PADDING, size, font) : [];
  let encoded = lines.map((l) => font?.encode(l) ?? null);
  if (encoded.some((e) => e === null)) {
    lines = [];
    encoded = [];
  }
  const ops = ['q'];
  const box = `${n(r.x0)} ${n(r.y0)} ${n(r.x1 - r.x0)} ${n(r.y1 - r.y0)} re`;
  if (a.fill !== null) ops.push(`${rgb(a.fill)} rg ${box} f`);
  if (a.border !== null && a.borderWidth > 0) {
    const h = a.borderWidth / 2;
    ops.push(
      `${n(a.borderWidth)} w ${rgb(a.border)} RG ${n(r.x0 + h)} ${n(r.y0 + h)} ${n(r.x1 - r.x0 - a.borderWidth)} ${n(r.y1 - r.y0 - a.borderWidth)} re S`,
    );
  }
  if (font && lines.length > 0) {
    ops.push(`${box} W n`);
    const { b, u } = frame(a.angle);
    const o = frameOrigin(r, a.angle);
    ops.push(`${n(b.x)} ${n(b.y)} ${n(u.x)} ${n(u.y)} ${pt(o)} cm`);
    ops.push(`BT /${font.name} ${n(size)} Tf ${rgb(a.color)} rg`);
    // CSS line box: half the leading above the font's ascent.
    const lineH = TEXT_LINE_HEIGHT * size;
    const halfLeading = (lineH - (font.ascent - font.descent) * size) / 2;
    encoded.forEach((hex, i) => {
      if (lines[i] === '') return;
      const y = -(TEXT_PADDING + i * lineH + halfLeading + font.ascent * size);
      ops.push(`1 0 0 1 ${n(TEXT_PADDING)} ${n(y)} Tm ${hex} Tj`);
    });
    ops.push('ET');
  }
  ops.push('Q');
  return { content: ops.join('\n'), usesFont: lines.some((l) => l !== '') };
}

/** A sticky note: a square note with three text lines, turned upright by the stored angle. */
function note(a: NoteAnnot): string {
  const r = a.rect;
  const s = Math.min(r.x1 - r.x0, r.y1 - r.y0) / 20;
  const { b, u } = frame(a.angle);
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  // Local 20×20 frame centered on the box, scaled and rotated.
  const tx = cx - s * (10 * b.x + 10 * u.x);
  const ty = cy - s * (10 * b.y + 10 * u.y);
  const [cr, cg, cb] = hexToRgb(a.color);
  const edge = [cr, cg, cb].map((v) => n(v * 0.62)).join(' ');
  return [
    'q',
    `${n(s * b.x)} ${n(s * b.y)} ${n(s * u.x)} ${n(s * u.y)} ${n(tx)} ${n(ty)} cm`,
    `0.9 w ${rgb(a.color)} rg ${edge} RG`,
    '2.5 1.5 m 13.5 1.5 l 18.5 6.5 l 18.5 18.5 l 2.5 18.5 l h B',
    '13.5 1.5 m 13.5 6.5 l 18.5 6.5 l S',
    '0.3 0.25 0.1 RG 1 w 1 J',
    '5.5 14.5 m 15.5 14.5 l S 5.5 11.5 m 15.5 11.5 l S 5.5 8.5 m 11 8.5 l S',
    'Q',
  ].join('\n');
}

/** The appearance of `a`; `font` is only used by text boxes. */
export function buildAppearance(a: Annot, font: AppearanceFont | null): Appearance {
  let content: string;
  let usesFont = false;
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      content = markup(a);
      break;
    case 'rect':
    case 'oval':
      content = shape(a);
      break;
    case 'line':
    case 'arrow':
      content = line(a);
      break;
    case 'ink':
      content = ink(a);
      break;
    case 'text': {
      const t = textBox(a, font);
      content = t.content;
      usesFont = t.usesFont;
      break;
    }
    case 'note':
      content = note(a);
      break;
  }
  const multiply = a.kind === 'highlight';
  const extGState = multiply || a.opacity < 1 ? { opacity: a.opacity, multiply } : undefined;
  if (extGState) content = `/GS0 gs\n${content}`;
  return extGState ? { rect: annotBounds(a), content, extGState, usesFont } : { rect: annotBounds(a), content, usesFont };
}
