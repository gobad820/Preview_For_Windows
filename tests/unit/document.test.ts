import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { PdfDocument, PdfOpenError, type PdfAssets } from '../../src/pdf/document';

const fixture = async (name: string) =>
  new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));

const nodeModules = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url));
const assets: PdfAssets = {
  cMapUrl: `${nodeModules}cmaps/`,
  standardFontDataUrl: `${nodeModules}standard_fonts/`,
  wasmUrl: `${nodeModules}wasm/`,
};

const open = async (name: string, password?: string) =>
  PdfDocument.load(await fixture(name), { password, assets });

describe('PdfDocument', () => {
  test('loads simple.pdf with page count and first page size', async () => {
    const doc = await open('simple.pdf');
    expect(doc.numPages).toBe(3);
    expect(doc.sizes).toHaveLength(3);
    expect(doc.sizes[0]!.width).toBeCloseTo(595.28, 1);
    expect(doc.sizes[0]!.height).toBeCloseTo(841.89, 1);
    await doc.destroy();
  });

  test('sizes default to page 1 until loadSizes resolves the rest', async () => {
    const doc = await open('mixed.pdf');
    expect(doc.sizes[1]).toEqual(doc.sizes[0]);
    const batches: Array<[number, number]> = [];
    await doc.loadSizes((from, to) => batches.push([from, to]));
    expect(doc.sizes[1]!.width).toBeGreaterThan(doc.sizes[1]!.height);
    expect(doc.sizes[2]).toEqual({ width: 200, height: 200 });
    expect(batches).toEqual([[1, 2]]);
    await doc.destroy();
  });

  test('resolves a nested outline to page indices', async () => {
    const doc = await open('outline.pdf');
    const outline = await doc.getOutline();
    expect(outline.map((o) => o.title)).toEqual(['Chapter 1', 'Chapter 2', 'Appendix']);
    expect(outline[0]!.children.map((c) => c.title)).toEqual(['Section 1.1', 'Section 1.2']);
    expect(outline[0]!.pageIndex).toBe(0);
    expect(outline[0]!.children[0]!.pageIndex).toBe(1);
    expect(outline[2]!.pageIndex).toBe(5);
    await doc.destroy();
  });

  test('returns an empty outline when the document has none', async () => {
    const doc = await open('simple.pdf');
    expect(await doc.getOutline()).toEqual([]);
    await doc.destroy();
  });

  test('rejects an encrypted document without a password', async () => {
    await expect(open('encrypted.pdf')).rejects.toMatchObject({ kind: 'password' });
    await expect(open('encrypted.pdf')).rejects.toBeInstanceOf(PdfOpenError);
  });

  test('opens an encrypted document with the right password', async () => {
    const doc = await open('encrypted.pdf', 'secret');
    expect(doc.numPages).toBe(1);
    await doc.destroy();
  });

  test('rejects a file that is not a PDF', async () => {
    await expect(open('broken.pdf')).rejects.toMatchObject({ kind: 'invalid' });
  });

  test('extracts page text items', async () => {
    const doc = await open('simple.pdf');
    const items = await doc.getPageText(0);
    expect(items.some((i) => i.str.includes('Hello world page 1'))).toBe(true);
    expect(await doc.getPageText(0)).toBe(items); // memoised
    await doc.destroy();
  });

  test('extracts Korean text from embedded and CID-font pages', async () => {
    const doc = await open('한글 문서.pdf');
    const p1 = (await doc.getPageText(0)).map((i) => i.str).join('');
    const p2 = (await doc.getPageText(1)).map((i) => i.str).join('');
    expect(p1).toContain('미리보기');
    expect(p2).toContain('미리보기');
    await doc.destroy();
  });
});
