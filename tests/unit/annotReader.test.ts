import { readdir, readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { describe, expect, test } from 'vitest';
import { hasOwnMarker, parseAnnot, readOwnAnnotations } from '../../src/annot/reader';
import type { Annot } from '../../src/annot/types';
import { writePdf } from '../../src/edit/writer';
import { sample } from './annotSamples';

const fx = async (name: string) => new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
const write = (bytes: Uint8Array, pages: Array<{ src: number; index: number; annots?: readonly Annot[] }>) =>
  writePdf([{ id: 0, bytes }], pages, { outline: [] });

describe('hasOwnMarker', () => {
  test('is false for every fixture made by other tools and true once we wrote annotations', async () => {
    const names = (await readdir(new URL('../fixtures/', import.meta.url))).filter((n) => n.endsWith('.pdf'));
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) expect(hasOwnMarker(await fx(name)), name).toBe(false);
    const out = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [sample()[3]!] }]);
    expect(hasOwnMarker(out)).toBe(true);
  });
});

describe('readOwnAnnotations', () => {
  test('reads back exactly what was written, with the ids pdf.js uses', async () => {
    const annots = sample();
    const out = await write(await fx('annotated.pdf'), [
      { src: 0, index: 0, annots },
      { src: 0, index: 1 },
      { src: 0, index: 2, annots: [annots[0]!] },
    ]);
    const pages = await readOwnAnnotations(out);
    expect(pages.length).toBe(3);
    expect(pages[0]!.map((p) => p.annot)).toEqual(annots);
    expect(pages[1]).toEqual([]);
    expect(pages[2]!.map((p) => p.annot)).toEqual([annots[0]]);

    const pdf = await pdfjs.getDocument({ data: out.slice() }).promise;
    const ids = (await (await pdf.getPage(1)).getAnnotations()).map((a: { id: string }) => a.id);
    // pdf.js also lists the foreign highlight, note, reply and popup (popups last).
    expect(ids.length).toBe(annots.length + 4);
    for (const { ref } of pages[0]!) expect(ids).toContain(ref);
    expect(pages[0]!.map((p) => p.ref)).not.toContain(ids[0]);
    await pdf.loadingTask.destroy();
  });

  test('skips annotations whose appearance lost the marker or whose model is invalid', async () => {
    const out = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: sample().slice(0, 3) }]);
    const doc = await PDFDocument.load(out);
    const arr = doc.getPages()[0]!.node.lookup(PDFName.of('Annots'), PDFArray);
    const dict = (i: number) => doc.context.lookup(arr.get(i)) as PDFDict;
    dict(0).set(PDFName.of('AP'), doc.context.obj({ N: doc.context.register(doc.context.stream('', { BBox: [0, 0, 1, 1] })) }));
    dict(1).set(PDFName.of('PFW'), PDFHexString.fromText('{not json'));
    const pages = await readOwnAnnotations(await doc.save());
    expect(pages[0]!.map((p) => p.annot.id)).toEqual(['so']);
  });
});

describe('parseAnnot', () => {
  test('accepts every sample kind and rejects malformed models', () => {
    for (const a of sample()) expect(parseAnnot(JSON.parse(JSON.stringify(a)))).toEqual(a);
    const rect = sample()[3]!;
    expect(parseAnnot({ ...rect, kind: 'banana' })).toBeNull();
    expect(parseAnnot({ ...rect, color: 'red' })).toBeNull();
    expect(parseAnnot({ ...rect, rect: { x0: 0, y0: 0, x1: 'a', y1: 1 } })).toBeNull();
    expect(parseAnnot({ ...rect, width: Number.NaN })).toBeNull();
    expect(parseAnnot({ ...sample()[0]!, quads: [[1, 2, 3]] })).toBeNull();
    expect(parseAnnot({ ...sample()[8]!, angle: 45 })).toBeNull();
    expect(parseAnnot(null)).toBeNull();
    expect(parseAnnot('x')).toBeNull();
  });
});
