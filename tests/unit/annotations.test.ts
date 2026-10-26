import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import type { Annot, ShapeAnnot } from '../../src/annot/types';
import { deletePages, fromSource, idSource, movePages, sameOrder, samePages, setPageAnnots } from '../../src/edit/composition';
import { EditableDocument } from '../../src/edit/document';
import type { PdfAssets } from '../../src/pdf/document';

const fx = async (name: string) => new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
const nm = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url));
const assets: PdfAssets = { cMapUrl: `${nm}cmaps/`, standardFontDataUrl: `${nm}standard_fonts/`, wasmUrl: `${nm}wasm/` };
const open = async (name: string) => EditableDocument.open(await fx(name), { assets });

const shape = (id: string): ShapeAnnot => ({
  id,
  kind: 'rect',
  color: '#ff3b30',
  opacity: 1,
  modified: '2026-10-26T00:00:00.000Z',
  rect: { x0: 10, y0: 10, x1: 60, y1: 40 },
  fill: null,
  width: 2,
  rounded: false,
});

describe('composition with annotations', () => {
  test('samePages also compares annotation lists; sameOrder does not', () => {
    const c = fromSource(0, 3, idSource());
    const marked = setPageAnnots(c, new Map([[1, [shape('a')] as readonly Annot[]]]));
    expect(marked).not.toBe(c);
    expect(marked[1]!.id).toBe(c[1]!.id);
    expect(samePages(c, marked)).toBe(false);
    expect(sameOrder(c, marked)).toBe(true);
    expect(setPageAnnots(marked, new Map([[1, marked[1]!.annots!]]))).toBe(marked);
  });

  test('moving and deleting pages keeps their annotations with them', () => {
    const c = setPageAnnots(fromSource(0, 3, idSource()), new Map([[0, [shape('a')] as readonly Annot[]]]));
    const moved = movePages(c, new Set([c[0]!.id]), 3);
    expect(moved[2]!.annots?.[0]?.id).toBe('a');
    expect(deletePages(moved, new Set([moved[0]!.id]))[1]!.annots?.[0]?.id).toBe('a');
  });
});

describe('EditableDocument annotations', () => {
  test('setAnnotations is one undoable step that marks the document edited', async () => {
    const doc = await open('simple.pdf');
    const onChange = vi.fn();
    doc.onChange(onChange);
    expect(doc.annotationsAt(0)).toEqual([]);
    const list = [shape('a')];
    expect(doc.setAnnotations(0, list)).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith('annotations', [0]);
    expect(doc.annotationsAt(0)).toBe(list);
    expect(doc.dirty).toBe(true);
    expect(doc.setAnnotations(0, list)).toBe(false);
    expect(doc.undo()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith('annotations', [0]);
    expect(doc.annotationsAt(0)).toEqual([]);
    expect(doc.dirty).toBe(false);
    expect(doc.redo()).toBe(true);
    expect(doc.annotationsAt(0)).toBe(list);
    await expect(doc.loadAnnotations(0)).resolves.toBe(list);
    expect(doc.hideGeneration(0)).toBe(0);
    await doc.destroy();
  });

  test('updateAnnotations over several pages is a single undo step', async () => {
    const doc = await open('simple.pdf');
    expect(doc.updateAnnotations(new Map([[0, [shape('a')]], [2, [shape('b')]]]))).toBe(true);
    expect(doc.annotationsAt(2)?.[0]?.id).toBe('b');
    expect(doc.undo()).toBe(true);
    expect(doc.annotationsAt(0)).toEqual([]);
    expect(doc.annotationsAt(2)).toEqual([]);
    expect(doc.canUndo).toBe(false);
    await doc.destroy();
  });

  test('undoing a page move after marking reports a structure change and keeps the marks', async () => {
    const doc = await open('simple.pdf');
    doc.setAnnotations(0, [shape('a')]);
    doc.apply(movePages(doc.pages, new Set([doc.pages[0]!.id]), 3));
    expect(doc.annotationsAt(2)?.[0]?.id).toBe('a');
    const onChange = vi.fn();
    doc.onChange(onChange);
    doc.undo();
    expect(onChange).toHaveBeenLastCalledWith('structure');
    expect(doc.annotationsAt(0)?.[0]?.id).toBe('a');
    doc.apply(deletePages(doc.pages, new Set([doc.pages[0]!.id])));
    doc.undo();
    expect(doc.annotationsAt(0)?.[0]?.id).toBe('a');
    await doc.destroy();
  });

  test('new annotation ids are unique', async () => {
    const doc = await open('simple.pdf');
    const a = doc.newAnnotId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc.newAnnotId()).not.toBe(a);
    await doc.destroy();
  });
});
