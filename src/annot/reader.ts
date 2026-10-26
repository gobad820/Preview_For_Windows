/**
 * Finds this app's annotations in a file. A byte search for the appearance-stream marker
 * decides whether parsing is needed at all, so ordinary PDFs open without pdf-lib.
 */
import { EncryptedPDFError, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, ParseSpeeds } from '@cantoo/pdf-lib';
import { PdfOpenError } from '../pdf/document';
import { isOwnAnnotation } from './pdfWrite';
import type { Annot, PdfPoint, PdfRect, Quad, TextAngle } from './types';

export { hasOwnMarker } from './marker';

export interface OwnAnnotation {
  annot: Annot;
  /** The annotation's id as pdf.js reports it ("12R", or "12R3" for generation 3). */
  ref: string;
}

const pdfjsId = (ref: PDFRef) => (ref.generationNumber === 0 ? `${ref.objectNumber}R` : `${ref.objectNumber}R${ref.generationNumber}`);

/** Our annotations on every page, in /Annots order (one list per page, possibly empty). */
export async function readOwnAnnotations(bytes: Uint8Array, password?: string): Promise<OwnAnnotation[][]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      password: password ?? '',
      updateMetadata: false,
      ignoreEncryption: false,
      // Yield to the event loop while parsing so the window stays responsive.
      parseSpeed: ParseSpeeds.Medium,
    });
  } catch (e) {
    if (e instanceof EncryptedPDFError || /password/i.test(String((e as Error)?.message))) {
      throw new PdfOpenError('password', 'This document is password protected.');
    }
    throw e;
  }
  const annots = PDFName.of('Annots');
  const pfw = PDFName.of('PFW');
  return doc.getPages().map((page) => {
    const out: OwnAnnotation[] = [];
    for (const entry of page.node.lookupMaybe(annots, PDFArray)?.asArray() ?? []) {
      if (!(entry instanceof PDFRef)) continue;
      const dict = doc.context.lookupMaybe(entry, PDFDict);
      if (!dict || !isOwnAnnotation(dict)) continue;
      const json = dict.lookupMaybe(pfw, PDFString, PDFHexString)?.decodeText();
      let annot: Annot | null = null;
      try {
        annot = json === undefined ? null : parseAnnot(JSON.parse(json));
      } catch {
        annot = null;
      }
      if (annot) out.push({ annot, ref: pdfjsId(entry) });
    }
    return out;
  });
}

// ---- validation ----------------------------------------------------------------

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const color = (v: unknown): v is string => str(v) && /^#[0-9a-f]{6}$/i.test(v);
const colorOrNull = (v: unknown): v is string | null => v === null || color(v);

function point(v: unknown): PdfPoint | null {
  return isObj(v) && num(v['x']) && num(v['y']) ? { x: v['x'], y: v['y'] } : null;
}

function rect(v: unknown): PdfRect | null {
  return isObj(v) && num(v['x0']) && num(v['y0']) && num(v['x1']) && num(v['y1'])
    ? { x0: v['x0'], y0: v['y0'], x1: v['x1'], y1: v['y1'] }
    : null;
}

function quad(v: unknown): Quad | null {
  return Array.isArray(v) && v.length === 8 && v.every(num) ? (v.slice() as unknown as Quad) : null;
}

function all<T>(v: unknown, f: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const y = f(x);
    if (y === null) return null;
    out.push(y);
  }
  return out;
}

const angle = (v: unknown): v is TextAngle => v === 0 || v === 90 || v === 180 || v === 270;

/** A validated copy of a stored model (only known fields), or null when anything is off. */
export function parseAnnot(v: unknown): Annot | null {
  if (!isObj(v)) return null;
  const { id, kind, opacity, modified } = v;
  if (!str(id) || !color(v['color']) || !num(opacity) || opacity < 0 || opacity > 1 || !str(modified)) return null;
  const base = { id, color: v['color'] as string, opacity, modified };
  switch (kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout': {
      const quads = all(v['quads'], quad);
      return quads && str(v['text']) ? { ...base, kind, quads, text: v['text'] } : null;
    }
    case 'rect':
    case 'oval': {
      const r = rect(v['rect']);
      return r && colorOrNull(v['fill']) && num(v['width']) && typeof v['rounded'] === 'boolean'
        ? { ...base, kind, rect: r, fill: v['fill'], width: v['width'], rounded: v['rounded'] }
        : null;
    }
    case 'line':
    case 'arrow': {
      const from = point(v['from']);
      const to = point(v['to']);
      return from && to && num(v['width']) ? { ...base, kind, from, to, width: v['width'] } : null;
    }
    case 'ink': {
      const paths = all(v['paths'], (p) => all(p, point));
      return paths && num(v['width']) ? { ...base, kind, paths, width: v['width'] } : null;
    }
    case 'text': {
      const r = rect(v['rect']);
      const { text, fontSize, fill, border, borderWidth } = v;
      return r && str(text) && num(fontSize) && colorOrNull(fill) && colorOrNull(border) && num(borderWidth) && angle(v['angle'])
        ? { ...base, kind, rect: r, text, fontSize, fill, border, borderWidth, angle: v['angle'] }
        : null;
    }
    case 'note': {
      const r = rect(v['rect']);
      return r && str(v['text']) && angle(v['angle']) ? { ...base, kind, rect: r, text: v['text'], angle: v['angle'] } : null;
    }
    default:
      return null;
  }
}
