import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFStream, PDFString } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { describe, expect, test } from 'vitest';
import { annotBounds } from '../../src/annot/geometry';
import type { Annot, ShapeAnnot } from '../../src/annot/types';
import { readOwnAnnotations } from '../../src/annot/reader';
import { writePdf, type WriterSource } from '../../src/edit/writer';
import { base, sample } from './annotSamples';

const fx = async (name: string) => new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
const PY = '/home/ssafy/miniforge3/envs/pdftools/bin/python';
const PDFIUM = fileURLToPath(new URL('../../scripts/pdfium-render.py', import.meta.url));
const MALGUN = '/mnt/c/Windows/Fonts/malgun.ttf';

const src = (bytes: Uint8Array, id = 0): WriterSource => ({ id, bytes });
const write = (bytes: Uint8Array, pages: Array<{ src: number; index: number; annots?: readonly Annot[] }>, font?: () => Promise<Uint8Array | null>) =>
  writePdf([src(bytes)], pages, { outline: [], ...(font ? { font } : {}) });

async function annotsOf(bytes: Uint8Array, page = 0): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes);
  const arr = doc.getPages()[page]!.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!arr) return [];
  return arr.asArray().map((e) => doc.context.lookup(e) as PDFDict);
}

const name = (d: PDFDict, key: string) => d.get(PDFName.of(key))?.toString();
const nums = (d: PDFDict, key: string) =>
  (d.lookup(PDFName.of(key), PDFArray) as PDFArray).asArray().map((v) => (v as PDFNumber).asNumber());
const text = (d: PDFDict, key: string) => {
  const v = d.lookup(PDFName.of(key));
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
};
const own = (d: PDFDict) => d.has(PDFName.of('PFW'));


/** Loads `bytes`, lets `edit` change page 1's annotation dictionaries, and saves (object streams off). */
async function tamper(bytes: Uint8Array, edit: (doc: PDFDocument, arr: PDFArray, dict: (nm: string) => PDFDict) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const arr = doc.getPages()[0]!.node.lookup(PDFName.of('Annots'), PDFArray);
  const dict = (nm: string) =>
    arr.asArray().map((e) => doc.context.lookup(e) as PDFDict).find((d) => text(d, 'NM') === nm)!;
  edit(doc, arr, dict);
  return doc.save({ useObjectStreams: false });
}

const nms = async (bytes: Uint8Array, page = 0) => (await annotsOf(bytes, page)).map((d) => text(d, 'NM'));

describe('writing annotations', () => {
  test('every kind is written as a standard annotation with an appearance stream and its model', async () => {
    const annots = sample();
    const out = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots }, { src: 0, index: 1 }]);
    const dicts = await annotsOf(out);
    expect(dicts.map((d) => name(d, 'Subtype'))).toEqual([
      '/Highlight', '/Underline', '/StrikeOut', '/Square', '/Circle', '/Line', '/Line', '/Ink', '/FreeText', '/Text',
    ]);
    const doc = await PDFDocument.load(out);
    dicts.forEach((d, i) => {
      const a = annots[i]!;
      const b = annotBounds(a);
      expect(nums(d, 'Rect').map((v) => Math.round(v))).toEqual([b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v)));
      expect(JSON.parse(text(d, 'PFW')!)).toEqual(a);
      expect(text(d, 'NM')).toBe(a.id);
      expect((d.get(PDFName.of('F')) as PDFNumber).asNumber()).toBe(4);
      expect(text(d, 'M')).toMatch(/^D:20261026010203/);
      const ap = (d.lookup(PDFName.of('AP'), PDFDict) as PDFDict).lookup(PDFName.of('N'));
      expect(ap).toBeInstanceOf(PDFStream);
      expect((ap as PDFStream).dict.get(PDFName.of('PFWAnnot'))?.toString()).toBe('true');
      expect(d.get(PDFName.of('P'))).toEqual(doc.getPages()[0]!.ref);
    });
    expect(nums(dicts[0]!, 'QuadPoints')).toEqual([70, 760, 200, 760, 70, 745, 200, 745]);
    expect(text(dicts[0]!, 'Contents')).toBe('Hello');
    expect(nums(dicts[0]!, 'C').map((v) => Math.round(v * 255))).toEqual([255, 214, 10]);
    expect(nums(dicts[4]!, 'IC')).toEqual([0, 1, 0]);
    expect(((dicts[3]!.lookup(PDFName.of('BS'), PDFDict) as PDFDict).get(PDFName.of('W')) as PDFNumber).asNumber()).toBe(3);
    expect(nums(dicts[6]!, 'L')).toEqual([300, 400, 450, 400]);
    expect((dicts[6]!.lookup(PDFName.of('LE'), PDFArray) as PDFArray).asArray().map(String)).toEqual(['/None', '/OpenArrow']);
    const inkList = dicts[7]!.lookup(PDFName.of('InkList'), PDFArray) as PDFArray;
    expect((inkList.lookup(0, PDFArray) as PDFArray).asArray().map((v) => (v as PDFNumber).asNumber())).toEqual([100, 300, 120, 320, 140, 300]);
    expect(text(dicts[8]!, 'Contents')).toBe('Typed comment');
    expect(text(dicts[8]!, 'DA')).toMatch(/12 Tf 0 0 0 rg/);
    expect(text(dicts[9]!, 'Contents')).toBe('A note');
    // Page 2 had no edits and gets nothing.
    expect(await annotsOf(out, 1)).toEqual([]);

    // pdf.js sees the same annotations.
    const pdf = await pdfjs.getDocument({ data: out.slice() }).promise;
    const seen = await (await pdf.getPage(1)).getAnnotations();
    expect(seen.map((a: { subtype: string }) => a.subtype)).toEqual([
      'Highlight', 'Underline', 'StrikeOut', 'Square', 'Circle', 'Line', 'Line', 'Ink', 'FreeText', 'Text',
    ]);
    expect(Array.from(seen[7].inkLists[0])).toEqual([100, 300, 120, 320, 140, 300]);
    await pdf.loadingTask.destroy();
  });

  test('saving again rewrites our annotations in place instead of adding copies', async () => {
    const annots = sample();
    const once = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots }]);
    const twice = await write(once, [{ src: 0, index: 0, annots }]);
    const a = await annotsOf(once);
    const b = await annotsOf(twice);
    expect(b.length).toBe(a.length);
    expect(b.filter(own).length).toBe(annots.length);
    // A page whose annots are not given keeps them exactly as they are.
    const kept = await write(twice, [{ src: 0, index: 0 }]);
    expect((await annotsOf(kept)).map((d) => text(d, 'NM'))).toEqual(annots.map((x) => x.id));
  });

  test('foreign annotations survive, including popups and replies', async () => {
    const rect = sample()[3]!;
    const out = await write(await fx('annotated.pdf'), [{ src: 0, index: 0, annots: [rect] }]);
    const dicts = await annotsOf(out);
    expect(dicts.map((d) => name(d, 'Subtype'))).toEqual(['/Highlight', '/Text', '/Popup', '/Text', '/Square']);
    expect(text(dicts[0]!, 'Contents')).toBe('foreign highlight');
    expect(nums(dicts[0]!, 'Rect')).toEqual([70, 740, 200, 758]);
    expect(text(dicts[3]!, 'Contents')).toBe('foreign reply');
    expect(dicts.filter(own).length).toBe(1);
  });

  test('deleting one of ours also removes popups and replies attached to it, and leaves nothing behind', async () => {
    const annots = sample();
    const once = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots }]);
    // Another app replies to our note and gives it a popup.
    const doc = await PDFDocument.load(once);
    const page = doc.getPages()[0]!;
    const arr = page.node.lookup(PDFName.of('Annots'), PDFArray);
    const noteRef = arr.asArray().find((e) => text(doc.context.lookup(e) as PDFDict, 'NM') === 'nt') as PDFRef;
    const popup = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [520, 600, 600, 720], Parent: noteRef }));
    (doc.context.lookup(noteRef) as PDFDict).set(PDFName.of('Popup'), popup);
    const reply = doc.context.register(
      doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 700, 520, 720], IRT: noteRef, Contents: PDFString.of('SECRET-REPLY') }),
    );
    const replyToReply = doc.context.register(
      doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 700, 520, 720], IRT: reply, Contents: PDFString.of('SECRET-NESTED') }),
    );
    arr.push(popup);
    arr.push(reply);
    arr.push(replyToReply);
    const touched = await doc.save({ useObjectStreams: false });

    // Keeping the note keeps the popup and the replies.
    const kept = await annotsOf(await write(touched, [{ src: 0, index: 0, annots }]));
    expect(kept.length).toBe(annots.length + 3);
    const noteDict = kept.find((d) => text(d, 'NM') === 'nt')!;
    expect(noteDict.get(PDFName.of('Popup'))).toBeInstanceOf(PDFRef);

    const without = await write(touched, [{ src: 0, index: 0, annots: annots.filter((a) => a.id !== 'nt') }]);
    const left = await annotsOf(without);
    expect(left.length).toBe(annots.length - 1);
    expect(left.every(own)).toBe(true);
    const raw = new TextDecoder('latin1').decode(await PDFDocument.load(without).then((d) => d.save({ useObjectStreams: false })));
    expect(raw).not.toContain('SECRET-REPLY');
    expect(raw).not.toContain('SECRET-NESTED');
    // Our strings are UTF-16 hex strings in the file; search for that form too.
    expect(raw).not.toContain('A note');
    expect(raw.toUpperCase()).not.toContain(PDFHexString.fromText('A note').toString().slice(1, -1).toUpperCase());
    expect(raw.toUpperCase()).toContain(PDFHexString.fromText('Typed comment').toString().slice(1, -1).toUpperCase());
  });


  test('our-looking annotations this version cannot read are kept, not deleted, when the page is saved', async () => {
    const [hl, rc] = [sample()[0]!, sample()[3]!];
    const once = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [hl, rc] }]);
    // A newer version wrote a kind this one does not know.
    const future = await tamper(once, (_doc, _arr, dict) => dict('rc').set(PDFName.of('PFW'), PDFHexString.fromText(JSON.stringify({ ...rc, kind: 'polygon' }))));
    expect((await readOwnAnnotations(future))[0]!.map((o) => o.annot.id)).toEqual(['hl']);
    const extra = sample()[5]!;
    expect(await nms(await write(future, [{ src: 0, index: 0, annots: [hl, extra] }]))).toEqual(['hl', 'rc', 'ln']);
    // Another tool inlined the dictionaries into /Annots.
    const inlined = await tamper(once, (doc, arr) => {
      const dicts = arr.asArray().map((e) => doc.context.lookup(e));
      doc.getPages()[0]!.node.set(PDFName.of('Annots'), doc.context.obj(dicts));
    });
    expect((await readOwnAnnotations(inlined))[0]).toEqual([]);
    expect((await nms(await write(inlined, [{ src: 0, index: 0, annots: [extra] }]))).sort()).toEqual(['hl', 'ln', 'rc']);
  });

  test('an annotation another app edited without redrawing it is left as that app left it', async () => {
    const note = sample()[9]! as Extract<Annot, { kind: 'note' }>;
    const rc = sample()[3]!;
    const once = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [note, rc] }]);
    const edited = await tamper(once, (doc, _arr, dict) => {
      dict('nt').set(PDFName.of('Contents'), PDFHexString.fromText('Edited in Acrobat'));
      dict('rc').set(PDFName.of('Rect'), doc.context.obj([10, 10, 50, 50]));
    });
    expect((await readOwnAnnotations(edited))[0]).toEqual([]);
    const out = await annotsOf(await write(edited, [{ src: 0, index: 0, annots: [sample()[5]!] }]));
    expect(out.map((d) => text(d, 'NM'))).toEqual(['nt', 'rc', 'ln']);
    expect(text(out[0]!, 'Contents')).toBe('Edited in Acrobat');
    expect(nums(out[1]!, 'Rect')).toEqual([10, 10, 50, 50]);
  });

  test('a kept annotation stays even when listed twice or replying to one that was deleted', async () => {
    const [hl, ul, so] = sample();
    const once = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [hl!, ul!, so!] }]);
    const twice = await tamper(once, (_doc, arr) => arr.push(arr.get(0)));
    expect(await nms(await write(twice, [{ src: 0, index: 0, annots: [hl!, so!] }]))).toContain('hl');
    const grouped = await tamper(once, (doc, arr, dict) => dict('so').set(PDFName.of('IRT'), arr.get(1)));
    expect(await nms(await write(grouped, [{ src: 0, index: 0, annots: [hl!, so!] }]))).toEqual(['hl', 'so']);
  });

  test('ours are matched by their model id, so a changed /NM keeps replies attached', async () => {
    const note = sample()[9]!;
    const once = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [note] }]);
    const renamed = await tamper(once, (doc, arr, dict) => {
      dict('nt').set(PDFName.of('NM'), PDFString.of('renamed-by-tool'));
      arr.push(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [1, 1, 2, 2], IRT: arr.get(0), Contents: PDFString.of('reply') })));
    });
    const out = await annotsOf(await write(renamed, [{ src: 0, index: 0, annots: [{ ...note, text: 'changed' } as Annot] }]));
    expect(out.map((d) => text(d, 'Contents'))).toEqual(['changed', 'reply']);
  });

  test('an annotation shared by two pages changes only on the page that was edited', async () => {
    const rc = sample()[3]! as ShapeAnnot;
    const once = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [rc] }, { src: 0, index: 1 }]);
    const shared = await (async () => {
      const doc = await PDFDocument.load(once);
      const [p1, p2] = doc.getPages();
      p2!.node.set(PDFName.of('Annots'), doc.context.obj([p1!.node.lookup(PDFName.of('Annots'), PDFArray).get(0)]));
      return doc.save();
    })();
    const moved = { ...rc, rect: { x0: 0, y0: 0, x1: 40, y1: 40 } };
    const out = await write(shared, [{ src: 0, index: 0, annots: [moved] }, { src: 0, index: 1 }]);
    expect(nums((await annotsOf(out, 0))[0]!, 'Rect')).toEqual([-1.5, -1.5, 41.5, 41.5]);
    expect(nums((await annotsOf(out, 1))[0]!, 'Rect')).toEqual([98.5, 498.5, 251.5, 601.5]);
  });

  test('an annotation another app regenerated (no marker in its appearance) is treated as foreign', async () => {
    const once = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [sample()[3]!] }]);
    const doc = await PDFDocument.load(once);
    const arr = doc.getPages()[0]!.node.lookup(PDFName.of('Annots'), PDFArray);
    const dict = doc.context.lookup(arr.get(0)) as PDFDict;
    dict.set(PDFName.of('AP'), doc.context.obj({ N: doc.context.register(doc.context.stream('0 0 m', { BBox: [0, 0, 1, 1] })) }));
    const regenerated = await doc.save();
    const out = await annotsOf(await write(regenerated, [{ src: 0, index: 0, annots: [] }]));
    expect(out.length).toBe(1);
  });

  test('text boxes without a usable font fall back to Helvetica, or to a box without text that stays ours', async () => {
    const box = sample()[8]! as Extract<Annot, { kind: 'text' }>;
    const latin = await annotsOf(await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [box] }]));
    const latinAp = (latin[0]!.lookup(PDFName.of('AP'), PDFDict) as PDFDict).lookup(PDFName.of('N')) as PDFStream;
    expect((latinAp.dict.lookup(PDFName.of('Resources'), PDFDict) as PDFDict).has(PDFName.of('Font'))).toBe(true);
    const out = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [{ ...box, text: '안녕' }] }]);
    const korean = await annotsOf(out);
    const ap = (korean[0]!.lookup(PDFName.of('AP'), PDFDict) as PDFDict).lookup(PDFName.of('N')) as PDFStream;
    expect(ap.dict.get(PDFName.of('PFWAnnot'))?.toString()).toBe('true');
    expect((ap.dict.lookup(PDFName.of('Resources'), PDFDict) as PDFDict).has(PDFName.of('Font'))).toBe(false);
    expect(text(korean[0]!, 'Contents')).toBe('안녕');
    expect((await readOwnAnnotations(out))[0]!.map((o) => o.annot.id)).toEqual(['tx']);
  });

  test.skipIf(!existsSync(MALGUN))('Hangul text embeds a small subset of Malgun Gothic', async () => {
    const box = { ...(sample()[8]! as Extract<Annot, { kind: 'text' }>), text: '안녕 Hello' };
    const font = async () => new Uint8Array(await readFile(MALGUN));
    const out = await write(await fx('simple.pdf'), [{ src: 0, index: 0, annots: [box] }], font);
    const doc = await PDFDocument.load(out);
    const descriptors = [...doc.context.enumerateIndirectObjects()]
      .map(([, o]) => o)
      .filter((o): o is PDFDict => o instanceof PDFDict && o.has(PDFName.of('FontFile2')));
    expect(descriptors.length).toBe(1);
    const file = descriptors[0]!.lookup(PDFName.of('FontFile2')) as PDFStream;
    expect(file.getContentsSize()).toBeLessThan(200_000);
    expect(out.length).toBeLessThan(200_000);
    const dicts = await annotsOf(out);
    expect(dicts[0]!.lookup(PDFName.of('AP'))).toBeInstanceOf(PDFDict);
  }, 30_000);

  test.skipIf(!existsSync(PY))('PDFium draws a saved rectangle where it was drawn on a /Rotate 90 page', async () => {
    // rotated.pdf page 1: user space 842 x 595, shown portrait; user (x, y) is device (y, x) at scale 1.
    const rect: Annot = { ...base, id: 'r', kind: 'rect', color: '#ff0000', rect: { x0: 100, y0: 300, x1: 200, y1: 400 }, fill: null, width: 4, rounded: false };
    const out = await write(await fx('rotated.pdf'), [{ src: 0, index: 0, annots: [rect] }]);
    const dir = await mkdtemp(join(tmpdir(), 'pfw-'));
    const file = join(dir, 'out.pdf');
    await writeFile(file, out);
    const r = spawnSync(PY, [PDFIUM, file, '0', '1', '--probe', '350,100', '350,150', '300,150'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const [size, edge, inside, bottom] = r.stdout.trim().split('\n');
    expect(size).toBe('size 596 842');
    expect(edge).toBe('350,100 255 0 0');
    expect(inside).toBe('350,150 255 255 255');
    expect(bottom).toBe('300,150 255 0 0');
  });
});
