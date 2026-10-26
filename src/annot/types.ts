/**
 * Annotation model: plain immutable data. Geometry is in the page's own PDF user space
 * (points, y up, unrotated: the space `/Rect` uses); views convert through the page's pdf.js
 * viewport. Keep this file dependency-free.
 */

/** `#rrggbb`. */
export type Color = string;

export interface PdfPoint {
  readonly x: number;
  readonly y: number;
}

/** Normalized: x0 <= x1, y0 <= y1. */
export interface PdfRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** `/QuadPoints` order: top-left, top-right, bottom-left, bottom-right, as x, y pairs. */
export type Quad = readonly [number, number, number, number, number, number, number, number];

/**
 * Counter-clockwise degrees from page user space to the text's own up direction, chosen so
 * the text was upright on screen when it was created.
 */
export type TextAngle = 0 | 90 | 180 | 270;

interface Base {
  /** Unique among the annotations of one page; written as `/NM`. */
  readonly id: string;
  /** Stroke, mark or text color. */
  readonly color: Color;
  /** 0–1, written as `/CA`. */
  readonly opacity: number;
  /** ISO 8601 time of the last change, written as `/M`. */
  readonly modified: string;
}

export interface MarkupAnnot extends Base {
  readonly kind: 'highlight' | 'underline' | 'strikeout';
  readonly quads: readonly Quad[];
  /** The marked text, written as `/Contents`. */
  readonly text: string;
}

export interface ShapeAnnot extends Base {
  readonly kind: 'rect' | 'oval';
  /** The shape's outline box (the stroke is centered on it). */
  readonly rect: PdfRect;
  readonly fill: Color | null;
  /** Stroke width in points. */
  readonly width: number;
  /** Rounded corners; only meaningful for 'rect'. */
  readonly rounded: boolean;
}

export interface LineAnnot extends Base {
  readonly kind: 'line' | 'arrow';
  readonly from: PdfPoint;
  /** The arrowhead end. */
  readonly to: PdfPoint;
  readonly width: number;
}

export interface InkAnnot extends Base {
  readonly kind: 'ink';
  readonly paths: readonly (readonly PdfPoint[])[];
  readonly width: number;
}

export interface TextBoxAnnot extends Base {
  readonly kind: 'text';
  readonly rect: PdfRect;
  readonly text: string;
  readonly fontSize: number;
  readonly fill: Color | null;
  readonly border: Color | null;
  readonly borderWidth: number;
  readonly angle: TextAngle;
}

export interface NoteAnnot extends Base {
  readonly kind: 'note';
  /** The icon box, `NOTE_SIZE` points square. */
  readonly rect: PdfRect;
  readonly text: string;
  readonly angle: TextAngle;
}

export type Annot = MarkupAnnot | ShapeAnnot | LineAnnot | InkAnnot | TextBoxAnnot | NoteAnnot;

export type AnnotKind = Annot['kind'];

/** Side of a note's icon box in points. */
export const NOTE_SIZE = 20;
