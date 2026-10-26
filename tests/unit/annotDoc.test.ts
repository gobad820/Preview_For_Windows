import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist';
import { describe, expect, test, vi } from 'vitest';
import { insertPages } from '../../src/edit/composition';
import { EditableDocument } from '../../src/edit/document';
import type { PdfAssets } from '../../src/pdf/document';
import { sample } from './annotSamples';

const fx = async (name: string) => new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
const nm = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url));
const assets: PdfAssets = { cMapUrl: `${nm}cmaps/`, standardFontDataUrl: `${nm}standard_fonts/`, wasmUrl: `${nm}wasm/` };
const open = (data: Uint8Array) => EditableDocument.open(data, { assets });

/** Number of annotations pdf.js would draw on the page right now. */
async function drawn(doc: EditableDocument, index: number): Promise<number> {
  const page = await doc.getPage(index);
  const ops = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE });
  return ops.fnArray.filter((f: number) => f === pdfjs.OPS.beginAnnotation).length;
}

async function savedWith(name: string, pages: Record<number, ReturnType<typeof sample>>): Promise<Uint8Array> {
  const doc = await open(await fx(name));
  doc.updateAnnotations(new Map(Object.entries(pages).map(([k, v]) => [Number(k), v])));
  const out = await doc.save();
  await doc.destroy();
  return out;
}

describe('annotations in opened files', () => {
  test('a file without our annotations needs no reading', async () => {
    const doc = await open(await fx('annotated.pdf'));
    expect(doc.primary.ownMarker).toBe(false);
    expect(doc.annotationsAt(0)).toEqual([]);
    expect(doc.hideGeneration(0)).toBe(0);
    // The foreign highlight, note and reply (the popup has no appearance) stay with pdf.js.
    expect(await drawn(doc, 0)).toBe(3);
    await doc.destroy();
  });

  test('reopening a saved file makes its annotations editable and hides them from pdf.js', async () => {
    const annots = sample();
    const saved = await savedWith('annotated.pdf', { 0: annots });
    const doc = await open(saved);
    expect(doc.primary.ownMarker).toBe(true);
    expect(doc.annotationsAt(0)).toBeNull();
    expect(await drawn(doc, 0)).toBe(3 + annots.length);
    const onChange = vi.fn();
    doc.onChange(onChange);
    expect(await doc.loadAnnotations(0)).toEqual(annots);
    expect(onChange).toHaveBeenCalledWith('annotations', [0, 1, 2]);
    expect(doc.annotationsAt(0)).toEqual(annots);
    expect(doc.annotationsAt(1)).toEqual([]);
    expect(doc.hideGeneration(0)).toBe(1);
    expect(await drawn(doc, 0)).toBe(3);
    expect(doc.dirty).toBe(false);

    // Saving again without touching them writes the same annotations once.
    const again = await open(await doc.save());
    await again.readAnnotations();
    expect(again.annotationsAt(0)).toEqual(annots);
    await again.destroy();

    // Editing after reading keeps the others.
    const rest = annots.slice(1);
    expect(doc.setAnnotations(0, rest)).toBe(true);
    const edited = await open(await doc.save());
    expect(await edited.loadAnnotations(0)).toEqual(rest);
    expect(await drawn(edited, 0)).toBe(3);
    await edited.destroy();
    await doc.destroy();
  });

  test('a page whose annotations are not read yet cannot be edited blindly', async () => {
    const saved = await savedWith('simple.pdf', { 0: sample().slice(0, 2) });
    const doc = await open(saved);
    expect(doc.setAnnotations(0, [])).toBe(false);
    expect(doc.dirty).toBe(false);
    await doc.loadAnnotations(0);
    expect(doc.setAnnotations(0, [])).toBe(true);
    await doc.destroy();
  });

  test('pages copied to another window arrive with editable annotations', async () => {
    const annots = sample().slice(3, 6);
    const doc = await open(await fx('simple.pdf'));
    doc.setAnnotations(1, annots);
    const copied = await doc.extract([{ src: 0, index: 1, annots }]);
    const other = await open(await fx('mixed.pdf'));
    const src = await other.addSource(copied);
    const { pages } = insertPages(other.pages, 0, [{ src, index: 0 }], other.nextId);
    other.apply(pages);
    expect(await other.loadAnnotations(0)).toEqual(annots);
    expect(other.hideGeneration(0)).toBe(1);
    expect(other.hideGeneration(1)).toBe(0);
    await other.destroy();
    await doc.destroy();
  });

  test('merging a file this app annotated keeps its annotations editable', async () => {
    const saved = await savedWith('simple.pdf', { 2: sample().slice(0, 1) });
    const doc = await open(await fx('mixed.pdf'));
    const src = await doc.addSource(saved);
    const { pages } = insertPages(doc.pages, doc.numPages, [0, 1, 2].map((index) => ({ src, index })), doc.nextId);
    doc.apply(pages);
    const last = doc.numPages - 1;
    expect(await doc.loadAnnotations(last)).toEqual(sample().slice(0, 1));
    expect(await doc.loadAnnotations(last - 1)).toEqual([]);
    await doc.destroy();
  });
});
