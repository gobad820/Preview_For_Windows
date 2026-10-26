/**
 * How annotations look, shared by the on-screen overlay and the saved appearance streams so
 * other viewers draw exactly what this app shows. Lengths are points.
 */
import type { PdfRect } from './types';

/** Text box typography (the CSS font stack; appearances embed Malgun Gothic). */
export const TEXT_FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
export const TEXT_LINE_HEIGHT = 1.2;
/** Padding inside a text box. */
export const TEXT_PADDING = 2;

/** Underline and strikethrough position: fraction of the quad height above its bottom edge. */
export const UNDERLINE_AT = 0.1;
export const STRIKEOUT_AT = 0.45;
/** Underline and strikethrough thickness for a quad of `height`. */
export const markThickness = (height: number): number => Math.max(0.75, height * 0.075);

/** Corner radius of a rounded rectangle. */
export const roundedRadius = (r: PdfRect): number => Math.min(r.x1 - r.x0, r.y1 - r.y0) * 0.18;
