import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { deletePages, insertPages, movePages } from '../../src/edit/composition';
import { EditableDocument } from '../../src/edit/document';
import { PdfDocument, type PdfAssets } from '../../src/pdf/document';

const fx = async (name: string) => new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
const nm = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url));
const assets: PdfAssets = { cMapUrl: `${nm}cmaps/`, standardFontDataUrl: `${nm}standard_fonts/`, wasmUrl: `${nm}wasm/` };
const open = async (name: string, password?: string) => EditableDocument.open(await fx(name), { password, assets });
const text = async (doc: { getPageText(i: number): Promise<Array<{ str: string }>> }, i: number) =>
  (await doc.getPageText(i)).map((t) => t.str).join('').slice(0, 18);
const ids = (doc: EditableDocument, ...positions: number[]) => new Set(positions.map((p) => doc.pages[p]!.id));

describe('EditableDocument', () => {
  test('starts as the opened file, clean', async () => {
    const doc = await open('simple.pdf');
    expect(doc.numPages).toBe(3);
    expect(doc.pageKey(1)).toBe('0:1');
    expect(doc.dirty).toBe(false);
    expect(doc.canUndo).toBe(false);
    expect(await text(doc, 2)).toBe('Hello world page 3');
    await doc.destroy();
  });

  test('applies, undoes and redoes structural edits', async () => {
    const doc = await open('simple.pdf');
    const onChange = vi.fn();
    doc.onChange(onChange);
    expect(doc.apply(movePages(doc.pages, ids(doc, 2), 0))).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith('structure');
    expect(await text(doc, 0)).toBe('Hello world page 3');
    expect(doc.pageKey(0)).toBe('0:2');
    expect(doc.dirty).toBe(true);
    expect(doc.apply(doc.pages)).toBe(false);
    expect(doc.undo()).toBe(true);
    expect(await text(doc, 0)).toBe('Hello world page 1');
    expect(doc.dirty).toBe(false);
    expect(doc.redo()).toBe(true);
    expect(await text(doc, 0)).toBe('Hello world page 3');
    expect(doc.undo() && doc.undo()).toBe(false);
    await doc.destroy();
  });

  test('sizes follow the composition', async () => {
    const doc = await open('mixed.pdf');
    await doc.loadSizes();
    expect(doc.sizes[1]!.width).toBeGreaterThan(doc.sizes[1]!.height);
    doc.apply(movePages(doc.pages, ids(doc, 1), 3));
    expect(doc.sizes[2]!.width).toBeGreaterThan(doc.sizes[2]!.height);
    expect(doc.sizes[1]).toEqual({ width: 200, height: 200 });
    await doc.destroy();
  });

  test('merges another file and saves the result', async () => {
    const doc = await open('simple.pdf');
    const src = await doc.addSource(await fx('한글 문서.pdf'));
    expect(doc.sourcePageCount(src)).toBe(2);
    const { pages } = insertPages(doc.pages, 1, [{ src, index: 0 }, { src, index: 1 }], doc.nextId);
    doc.apply(pages);
    expect(doc.numPages).toBe(5);
    expect(doc.pageKey(1)).toBe(`${src}:0`);
    const saved = await PdfDocument.load(await doc.save(), { assets });
    expect(saved.numPages).toBe(5);
    expect((await saved.getPageText(1)).map((t) => t.str).join('')).toContain('미리보기');
    expect(await text(saved, 3)).toBe('Hello world page 2');
    await saved.destroy();
    await doc.destroy();
  });

  test('outline follows edits and is saved remapped', async () => {
    const doc = await open('outline.pdf');
    doc.apply(movePages(doc.pages, ids(doc, 5), 0)); // Appendix first
    doc.apply(deletePages(doc.pages, ids(doc, 3))); // drop "Section 1.2" (was page 3)
    const outline = await doc.getOutline();
    expect(outline.map((n) => [n.title, n.pageIndex])).toEqual([
      ['Chapter 1', 1],
      ['Chapter 2', 3],
      ['Appendix', 0],
    ]);
    expect(outline[0]!.children.map((n) => n.title)).toEqual(['Section 1.1']);
    const saved = await PdfDocument.load(await doc.save(), { assets });
    const read = await saved.getOutline();
    expect(read.map((n) => [n.title, n.pageIndex])).toEqual([
      ['Chapter 1', 1],
      ['Chapter 2', 3],
      ['Appendix', 0],
    ]);
    await saved.destroy();
    await doc.destroy();
  });

  test('saves a password-protected file without its password', async () => {
    const doc = await open('encrypted.pdf', 'secret');
    const saved = await PdfDocument.load(await doc.save(), { assets });
    expect(await text(saved, 0)).toBe('Encrypted fixture');
    await saved.destroy();
    await doc.destroy();
  });

  test('markSaved clears dirty until the next edit', async () => {
    const doc = await open('simple.pdf');
    doc.apply(deletePages(doc.pages, ids(doc, 0)));
    expect(doc.dirty).toBe(true);
    doc.markSaved();
    expect(doc.dirty).toBe(false);
    doc.undo();
    expect(doc.dirty).toBe(true);
    await doc.destroy();
  });
});
