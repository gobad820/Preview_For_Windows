import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { describe, expect, test } from 'vitest';
import { PdfDocument, type OutlineNode, type PdfAssets } from '../../src/pdf/document';
import { writePdf, type WriterSource } from '../../src/edit/writer';

const fx = async (name: string) => new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
const nm = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url));
const assets: PdfAssets = { cMapUrl: `${nm}cmaps/`, standardFontDataUrl: `${nm}standard_fonts/`, wasmUrl: `${nm}wasm/` };
const view = (bytes: Uint8Array) => PdfDocument.load(bytes.slice(), { assets });

async function source(id: number, name: string, password?: string): Promise<WriterSource> {
  return { id, bytes: await fx(name), password };
}
const refs = (src: number, ...indices: number[]) => indices.map((index) => ({ src, index }));

async function firstLines(bytes: Uint8Array): Promise<string[]> {
  const doc = await view(bytes);
  const out: string[] = [];
  for (let i = 0; i < doc.numPages; i++) out.push((await doc.getPageText(i)).map((t) => t.str).join(' ').trim());
  await doc.destroy();
  return out;
}

/** Page dictionaries present in the file but missing from the page tree. */
async function orphanPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  const inTree = new Set(doc.getPages().map((p) => p.ref.toString()));
  let orphans = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Page') && !inTree.has(ref.toString())) orphans++;
  }
  return orphans;
}

/** Target page (0-based) of each link annotation on `page`, in annotation order. */
async function linkTargets(bytes: Uint8Array, page: number): Promise<Array<number | null>> {
  const doc = await view(bytes);
  const annots = await (await doc.getPage(page)).getAnnotations();
  const out: Array<number | null> = [];
  for (const a of annots.filter((x: { subtype: string }) => x.subtype === 'Link')) {
    out.push((await doc.resolveDest(a.dest ?? null))?.pageIndex ?? null);
  }
  await doc.destroy();
  return out;
}


/** Indirect objects that nothing reachable from the trailer refers to. */
async function unreachable(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean) as PDFObject[];
  while (stack.length > 0) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFDict) for (const [, v] of o.entries()) stack.push(v);
    else if (o instanceof PDFArray) stack.push(...o.asArray());
    else if (o instanceof PDFStream) for (const [, v] of o.dict.entries()) stack.push(v);
  }
  // Object and cross-reference streams belong to the file structure, not the document.
  const structural = (o: PDFObject) =>
    o instanceof PDFStream && ['/ObjStm', '/XRef'].includes(String(o.dict.get(PDFName.of('Type'))));
  return ctx.enumerateIndirectObjects().filter(([ref, o]) => !seen.has(ref.tag) && !structural(o)).length;
}

/** Every string and decoded stream in the file, joined, to search for leaked content. */
async function allText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        parts.push(new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode()));
      } catch {
        /* undecodable filters are not text */
      }
      parts.push(obj.dict.toString());
    } else {
      parts.push(obj.toString());
    }
  }
  return parts.join('\n');
}

/** Actions reachable from page `page`'s annotations: [subtype, path, target page or null]. */
async function annotActions(bytes: Uint8Array, page: number): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages().map((p) => p.ref.toString());
  const out: string[] = [];
  const annots = doc.getPages()[page]!.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return out;
  const describe = (action: PDFDict | undefined, path: string) => {
    for (let a = action, p = path; a; ) {
      const d = a.lookupMaybe(PDFName.of('D'), PDFArray);
      const ref = d?.get(0);
      out.push(`${p}->${ref instanceof PDFRef ? pages.indexOf(ref.toString()) : 'none'}`);
      a = a.lookupMaybe(PDFName.of('Next'), PDFDict);
      p += '.Next';
    }
  };
  for (let i = 0; i < annots.size(); i++) {
    const annot = doc.context.lookup(annots.get(i), PDFDict);
    const sub = String(annot.get(PDFName.of('Subtype'))).slice(1);
    describe(annot.lookupMaybe(PDFName.of('A'), PDFDict), `${sub}.A`);
    const aa = annot.lookupMaybe(PDFName.of('AA'), PDFDict);
    for (const [k] of aa?.entries() ?? []) describe(aa!.lookupMaybe(k, PDFDict), `${sub}.AA${k.toString()}`);
  }
  return out;
}

const noOutline = { outline: [] as OutlineNode[] };

describe('writePdf', () => {
  test('reorders pages', async () => {
    const out = await writePdf([await source(0, 'simple.pdf')], refs(0, 2, 0, 1), noOutline);
    const lines = await firstLines(out);
    expect(lines.map((l) => l.slice(0, 18))).toEqual(['Hello world page 3', 'Hello world page 1', 'Hello world page 2']);
  });

  test('deleted pages leave no page objects behind', async () => {
    const keep = Array.from({ length: 300 }, (_, i) => i).filter((i) => i !== 1);
    const out = await writePdf([await source(0, 'long300.pdf')], refs(0, ...keep), noOutline);
    const doc = await view(out);
    expect(doc.numPages).toBe(299);
    expect((await doc.getPageText(1)).map((t) => t.str).join('')).toContain('Page 3 of 300');
    await doc.destroy();
    expect(await orphanPages(out)).toBe(0);
  });

  test('merges files with different page sizes and fonts', async () => {
    const sources = [await source(0, 'simple.pdf'), await source(1, 'mixed.pdf'), await source(2, '한글 문서.pdf')];
    const out = await writePdf(sources, [...refs(0, 0, 1, 2), ...refs(1, 0, 1, 2), ...refs(2, 0, 1)], noOutline);
    const doc = await view(out);
    expect(doc.numPages).toBe(8);
    await doc.loadSizes();
    expect(doc.sizes[4]!.width).toBeGreaterThan(doc.sizes[4]!.height);
    expect(doc.sizes[5]).toEqual({ width: 200, height: 200 });
    expect((await doc.getPageText(6)).map((t) => t.str).join('')).toContain('미리보기');
    expect((await doc.getPageText(7)).map((t) => t.str).join('')).toContain('두 번째 페이지');
    await doc.destroy();
    expect(await orphanPages(out)).toBe(0);
  });

  for (const name of ['links.pdf', 'links-named.pdf']) {
    test(`retargets internal links after a move (${name})`, async () => {
      // Page C first, then Contents, A, B.
      const out = await writePdf([await source(0, name)], refs(0, 3, 0, 1, 2), noOutline);
      expect(await linkTargets(out, 1)).toEqual([2, 3, 0]);
      expect(await orphanPages(out)).toBe(0);
    });

    test(`drops links to deleted pages (${name})`, async () => {
      const out = await writePdf([await source(0, name)], refs(0, 0, 1, 3), noOutline);
      expect(await linkTargets(out, 0)).toEqual([1, 2]);
      expect(await orphanPages(out)).toBe(0);
    });
  }

  test('writes the given outline', async () => {
    const outline: OutlineNode[] = [
      { title: 'Appendix', pageIndex: 0, top: null, children: [] },
      {
        title: 'Chapter 1',
        pageIndex: 1,
        top: 100,
        children: [{ title: '절 1.1', pageIndex: 2, top: null, children: [] }],
      },
    ];
    const out = await writePdf([await source(0, 'outline.pdf')], refs(0, 5, 0, 1, 2, 3, 4), { outline });
    const doc = await view(out);
    const read = await doc.getOutline();
    expect(read.map((n) => [n.title, n.pageIndex])).toEqual([
      ['Appendix', 0],
      ['Chapter 1', 1],
    ]);
    expect(read[1]!.top).toBeCloseTo(100, 0);
    expect(read[1]!.children.map((n) => [n.title, n.pageIndex])).toEqual([['절 1.1', 2]]);
    await doc.destroy();
  });

  test('decrypts a password-protected source', async () => {
    const out = await writePdf([await source(0, 'encrypted.pdf', 'secret')], refs(0, 0), noOutline);
    expect((await firstLines(out))[0]).toContain('Encrypted fixture');
  });

  test('rejects a password-protected source without the password', async () => {
    await expect(writePdf([await source(0, 'encrypted.pdf')], refs(0, 0), noOutline)).rejects.toMatchObject({
      kind: 'password',
    });
  });

  test('duplicates a page into independent copies', async () => {
    const out = await writePdf([await source(0, 'links.pdf')], refs(0, 0, 0, 1), noOutline);
    const doc = await PDFDocument.load(out);
    const [a, b] = doc.getPages();
    expect(a!.ref.toString()).not.toBe(b!.ref.toString());
    // Both copies of Contents keep the link to Page A (output page 2); links to B and C are dropped.
    expect(await linkTargets(out, 0)).toEqual([2]);
    expect(await linkTargets(out, 1)).toEqual([2]);
    expect(await orphanPages(out)).toBe(0);
  });


  for (const name of ['restricted-rc4.pdf', 'restricted-aes.pdf']) {
    test(`saves a file protected only by an owner password (${name})`, async () => {
      const out = await writePdf([await source(0, name)], refs(0, 1, 0), noOutline);
      expect((await firstLines(out)).map((l) => l.slice(0, 18))).toEqual(['Hello world page 2', 'Hello world page 1']);
    });
  }

  test('deleted pages leave nothing behind through actions or form fields', async () => {
    const out = await writePdf([await source(0, 'forms-actions.pdf')], refs(0, 0, 2), noOutline);
    expect(await orphanPages(out)).toBe(0);
    expect(await unreachable(out)).toBe(0);
    const text = await allText(out);
    expect(text).not.toContain('PAGE2-ONLY');
    expect(text).not.toContain('Hello world page 2');
    expect(text).toContain('PAGE1-SHOWN');
    // The link still goes to old page 3 (now 2nd); its chained action to deleted page 2 is gone,
    // and the button's actions to page 2 are removed.
    expect(await annotActions(out, 0)).toEqual(['Link.A->1']);
  });

  test('actions follow moved pages', async () => {
    const out = await writePdf([await source(0, 'forms-actions.pdf')], refs(0, 2, 1, 0), noOutline);
    expect(await annotActions(out, 2)).toEqual(['Link.A->0', 'Link.A.Next->1', 'Widget.A->1', 'Widget.AA/E->1']);
    expect(await orphanPages(out)).toBe(0);
    expect(await unreachable(out)).toBe(0);
  });

  test('keeps outline entries that open a web address', async () => {
    const outline: OutlineNode[] = [
      { title: 'Website', pageIndex: null, top: null, url: 'https://example.com/', children: [] },
      { title: 'Start', pageIndex: 0, top: null, children: [] },
    ];
    const out = await writePdf([await source(0, 'simple.pdf')], refs(0, 0, 1), { outline });
    const doc = await PDFDocument.load(out);
    const root = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    const first = root.lookup(PDFName.of('First'), PDFDict);
    const action = first.lookup(PDFName.of('A'), PDFDict);
    expect(String(action.get(PDFName.of('S')))).toBe('/URI');
    expect((action.lookup(PDFName.of('URI')) as PDFString | PDFHexString).decodeText()).toBe('https://example.com/');
  });

  test('outline offsets are measured from the crop box', async () => {
    const src = await PDFDocument.create();
    const page = src.addPage([600, 800]);
    page.setCropBox(0, 0, 600, 700);
    src.addPage([600, 800]);
    const bytes = await src.save();
    const outline: OutlineNode[] = [{ title: 'Here', pageIndex: 0, top: 100, children: [] }];
    const out = await writePdf([{ id: 0, bytes }], refs(0, 0, 1), { outline });
    const doc = await view(out);
    expect((await doc.getOutline())[0]!.top).toBeCloseTo(100, 0);
    await doc.destroy();
  });

  test('writes page labels', async () => {
    const out = await writePdf([await source(0, 'simple.pdf')], refs(0, 2, 0, 1), {
      outline: [],
      pageLabels: ['1', 'i', 'ii'],
    });
    const doc = await view(out);
    expect(await doc.getPageLabels()).toEqual(['1', 'i', 'ii']);
    await doc.destroy();
  });

  test('keeps document metadata from the first source', async () => {
    const src = await PDFDocument.load(await fx('simple.pdf'));
    src.setTitle('Quarterly report');
    src.setAuthor('Kim');
    const bytes = await src.save();
    const out = await writePdf([{ id: 7, bytes }], refs(7, 0), noOutline);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Quarterly report');
    expect(doc.getAuthor()).toBe('Kim');
  });
});
