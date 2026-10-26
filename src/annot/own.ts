/**
 * Which annotations in a file are this app's, editable ones. The reader and the writer share this
 * rule, so the writer never replaces or deletes an annotation the reader could not hand to the
 * user (one written by a newer version, inlined by another tool, or changed by another app).
 */
import { PDFArray, PDFBool, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, type PDFContext, type PDFObject } from '@cantoo/pdf-lib';
import { annotBounds } from './geometry';
import type { Annot } from './types';
import { parseAnnot } from './validate';

const AP = PDFName.of('AP');
const N = PDFName.of('N');
const PFW = PDFName.of('PFW');
const PFW_ANNOT = PDFName.of('PFWAnnot');
const RECT = PDFName.of('Rect');
const CONTENTS = PDFName.of('Contents');

/** True when `dict` carries our model and its current appearance still has our marker. */
export function isOwnAnnotation(dict: PDFDict): boolean {
  if (!dict.has(PFW)) return false;
  const normal = dict.lookupMaybe(AP, PDFDict)?.lookup(N);
  return normal instanceof PDFStream && normal.dict.get(PFW_ANNOT) === PDFBool.True;
}

const decoded = (v: PDFObject | undefined) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined);

/**
 * The model of an /Annots entry that is ours and unchanged since we wrote it, or null: the entry
 * is not an indirect object, not ours, not a model this version understands, or another app
 * moved it (/Rect) or changed its text (/Contents) without redrawing it.
 */
export function ownModel(entry: PDFObject, ctx: PDFContext): Annot | null {
  if (!(entry instanceof PDFRef)) return null;
  const dict = ctx.lookupMaybe(entry, PDFDict);
  if (!dict || !isOwnAnnotation(dict)) return null;
  let annot: Annot | null;
  try {
    annot = parseAnnot(JSON.parse(decoded(dict.lookup(PFW)) ?? ''));
  } catch {
    return null;
  }
  if (!annot) return null;
  const rect = dict.lookupMaybe(RECT, PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN));
  const b = annotBounds(annot);
  if (!rect || rect.length !== 4 || [b.x0, b.y0, b.x1, b.y1].some((v, i) => !(Math.abs(v - rect[i]!) < 0.01))) return null;
  const expected = 'text' in annot ? annot.text : '';
  if ((decoded(dict.lookup(CONTENTS)) ?? '') !== expected) return null;
  return annot;
}
