/**
 * Finds this app's annotations in a file. A byte search for the appearance-stream marker
 * decides whether parsing is needed at all, so ordinary PDFs open without pdf-lib.
 */
import { EncryptedPDFError, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, ParseSpeeds } from '@cantoo/pdf-lib';
import { t } from '../i18n';
import { PdfOpenError } from '../pdf/document';
import { ownModel } from './own';
export { parseAnnot } from './validate';
import type { Annot } from './types';

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
      throw new PdfOpenError('password', t('dlg.error.passwordProtected'));
    }
    throw e;
  }
  const annots = PDFName.of('Annots');
  return doc.getPages().map((page) => {
    const out: OwnAnnotation[] = [];
    for (const entry of page.node.lookupMaybe(annots, PDFArray)?.asArray() ?? []) {
      const annot = ownModel(entry, doc.context);
      if (annot && entry instanceof PDFRef) out.push({ annot, ref: pdfjsId(entry) });
    }
    return out;
  });
}

