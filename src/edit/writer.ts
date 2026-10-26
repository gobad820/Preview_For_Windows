import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFObject,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { PdfOpenError, type OutlineNode } from '../pdf/document';

/** One input file. `id` matches `PageRef.src`. */
export interface WriterSource {
  id: number;
  bytes: Uint8Array;
  password?: string | undefined;
}

export interface WriteOptions {
  /** Outline for the output, with `pageIndex` as output positions and `top` in PDF points from the page top. */
  outline: OutlineNode[];
  /** Source whose title, author, subject, keywords and creation date are kept; defaults to the first page's source. */
  metaFrom?: number;
}

type PageSpec = { readonly src: number; readonly index: number };

const N = {
  Annots: PDFName.of('Annots'),
  P: PDFName.of('P'),
  B: PDFName.of('B'),
  Subtype: PDFName.of('Subtype'),
  Link: PDFName.of('Link'),
  Dest: PDFName.of('Dest'),
  A: PDFName.of('A'),
  S: PDFName.of('S'),
  GoTo: PDFName.of('GoTo'),
  D: PDFName.of('D'),
  Dests: PDFName.of('Dests'),
  Names: PDFName.of('Names'),
  Kids: PDFName.of('Kids'),
  Outlines: PDFName.of('Outlines'),
  Type: PDFName.of('Type'),
  Title: PDFName.of('Title'),
  Parent: PDFName.of('Parent'),
  First: PDFName.of('First'),
  Last: PDFName.of('Last'),
  Next: PDFName.of('Next'),
  Prev: PDFName.of('Prev'),
  Count: PDFName.of('Count'),
  XYZ: PDFName.of('XYZ'),
  Fit: PDFName.of('Fit'),
};

/** What the pre-pass learned about one annotation, in the page's /Annots order. */
interface AnnotInfo {
  hadP: boolean;
  /** Set for GoTo links: target page in the same source (null = unresolvable) and the rest of the destination. */
  link: { via: 'Dest' | 'A'; target: number | null; rest: PDFObject[] } | null;
}

interface Prepared {
  doc: PDFDocument;
  annots: AnnotInfo[][];
}

/**
 * Builds a new PDF from `pages` (an ordered list of source pages). Deleted pages leave no
 * objects behind, internal links follow their target pages or are removed, the outline is
 * written from `opts.outline`, and the output is never encrypted.
 */
export async function writePdf(
  sources: WriterSource[],
  pages: ReadonlyArray<PageSpec>,
  opts: WriteOptions,
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.');
  const byId = new Map(sources.map((s) => [s.id, s]));
  const prepared = new Map<number, Prepared>();
  for (const id of new Set(pages.map((p) => p.src))) {
    const src = byId.get(id);
    if (!src) throw new Error(`Unknown source ${id}`);
    prepared.set(id, prepare(await loadSource(src)));
  }

  const out = await PDFDocument.create({ updateMetadata: false });

  // Copy pages. A page used k times is copied in k separate rounds so copies share no
  // annotation objects; within a round one copyPages call per source keeps shared resources shared.
  const occurrence = new Map<string, number>();
  const rounds: Array<Map<number, number[]>> = [];
  const slot: Array<{ round: number; src: number; pos: number }> = [];
  for (const p of pages) {
    const key = `${p.src}:${p.index}`;
    const round = occurrence.get(key) ?? 0;
    occurrence.set(key, round + 1);
    const perSource = (rounds[round] ??= new Map());
    const list = perSource.get(p.src) ?? [];
    perSource.set(p.src, list);
    slot.push({ round, src: p.src, pos: list.length });
    list.push(p.index);
  }
  const copied: Array<Map<number, PDFPage[]>> = [];
  for (const [r, perSource] of rounds.entries()) {
    const m = new Map<number, PDFPage[]>();
    for (const [src, indices] of perSource) m.set(src, await out.copyPages(prepared.get(src)!.doc, indices));
    copied[r] = m;
  }
  const outPages = slot.map((s) => out.addPage(copied[s.round]!.get(s.src)![s.pos]!));

  // First output position of every source page, for link targets.
  const firstPos = new Map<string, number>();
  pages.forEach((p, i) => {
    const key = `${p.src}:${p.index}`;
    if (!firstPos.has(key)) firstPos.set(key, i);
  });

  // Post-pass: restore /P and retarget or remove links.
  pages.forEach((p, i) => {
    const infos = prepared.get(p.src)!.annots[p.index] ?? [];
    if (infos.length === 0) return;
    const page = outPages[i]!;
    const annots = page.node.lookupMaybe(N.Annots, PDFArray);
    if (!annots) return;
    const keep: PDFObject[] = [];
    infos.forEach((info, k) => {
      const entry = annots.get(k);
      const annot = entry ? out.context.lookupMaybe(entry, PDFDict) : undefined;
      if (!entry || !annot) return;
      if (info.hadP) annot.set(N.P, page.ref);
      if (info.link) {
        const pos = info.link.target === null ? undefined : firstPos.get(`${p.src}:${info.link.target}`);
        if (pos === undefined) return; // target page is not in the output: drop the link
        const dest = out.context.obj([outPages[pos]!.ref, ...info.link.rest]);
        if (info.link.via === 'Dest') annot.set(N.Dest, dest);
        else annot.lookup(N.A, PDFDict).set(N.D, dest);
      }
      keep.push(entry);
    });
    page.node.set(N.Annots, out.context.obj(keep));
  });

  writeOutline(out, outPages, opts.outline);

  const metaSrc = prepared.get(opts.metaFrom ?? pages[0]!.src)?.doc;
  if (metaSrc) copyMetadata(metaSrc, out);

  return out.save();
}

async function loadSource(src: WriterSource): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(src.bytes, {
      password: src.password,
      updateMetadata: false,
      ignoreEncryption: false,
    });
  } catch (e) {
    if (e instanceof EncryptedPDFError || /password/i.test(String((e as Error)?.message))) {
      throw new PdfOpenError('password', 'This document is password protected.');
    }
    throw e;
  }
}

/**
 * Detaches everything that would let the object copier reach other pages: annotation /P
 * back-references, article beads, and GoTo link destinations (remembered for the post-pass).
 */
function prepare(doc: PDFDocument): Prepared {
  const pageIndexByRef = new Map<string, number>();
  const pageList = doc.getPages();
  pageList.forEach((p, i) => pageIndexByRef.set(p.ref.toString(), i));
  const annots: AnnotInfo[][] = pageList.map((page) => {
    page.node.delete(N.B);
    const arr = page.node.lookupMaybe(N.Annots, PDFArray);
    if (!arr) return [];
    const infos: AnnotInfo[] = [];
    for (let k = 0; k < arr.size(); k++) {
      const annot = doc.context.lookupMaybe(arr.get(k), PDFDict);
      if (!annot) {
        infos.push({ hadP: false, link: null });
        continue;
      }
      const hadP = annot.has(N.P);
      annot.delete(N.P);
      let link: AnnotInfo['link'] = null;
      if (annot.get(N.Subtype) === N.Link) {
        const dest = annot.get(N.Dest);
        const action = annot.lookupMaybe(N.A, PDFDict);
        if (dest !== undefined) {
          link = { via: 'Dest', ...resolveDest(doc, dest, pageIndexByRef) };
          annot.set(N.Dest, PDFNull);
        } else if (action && action.get(N.S) === N.GoTo) {
          link = { via: 'A', ...resolveDest(doc, action.get(N.D) ?? PDFNull, pageIndexByRef) };
          action.set(N.D, PDFNull);
        }
      }
      infos.push({ hadP, link });
    }
    return infos;
  });
  return { doc, annots };
}

/** Resolves an explicit, named or string destination to a page index in `doc`. */
function resolveDest(
  doc: PDFDocument,
  dest: PDFObject,
  pageIndexByRef: Map<string, number>,
): { target: number | null; rest: PDFObject[] } {
  const none = { target: null, rest: [] };
  let value: PDFObject | undefined = dest instanceof PDFRef ? doc.context.lookup(dest) : dest;
  for (let depth = 0; depth < 4 && value; depth++) {
    if (value instanceof PDFArray) {
      const first = value.get(0);
      const rest = value.asArray().slice(1);
      if (first instanceof PDFRef) return { target: pageIndexByRef.get(first.toString()) ?? null, rest };
      if (first instanceof PDFNumber) return { target: first.asNumber(), rest };
      return none;
    }
    if (value instanceof PDFDict) {
      value = value.get(N.D);
    } else if (value instanceof PDFName) {
      value = doc.catalog.lookupMaybe(N.Dests, PDFDict)?.get(value);
    } else if (value instanceof PDFString || value instanceof PDFHexString) {
      const names = doc.catalog.lookupMaybe(N.Names, PDFDict)?.lookupMaybe(N.Dests, PDFDict);
      value = names ? lookupNameTree(doc, names, value.decodeText(), 0) : undefined;
    } else {
      return none;
    }
    if (value instanceof PDFRef) value = doc.context.lookup(value);
  }
  return none;
}

function lookupNameTree(doc: PDFDocument, node: PDFDict, key: string, depth: number): PDFObject | undefined {
  if (depth > 32) return undefined;
  const names = node.lookupMaybe(N.Names, PDFArray);
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const k = names.lookup(i);
      if ((k instanceof PDFString || k instanceof PDFHexString) && k.decodeText() === key) return names.get(i + 1);
    }
  }
  const kids = node.lookupMaybe(N.Kids, PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = doc.context.lookupMaybe(kids.get(i), PDFDict);
      const found = kid ? lookupNameTree(doc, kid, key, depth + 1) : undefined;
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function writeOutline(out: PDFDocument, pages: PDFPage[], outline: OutlineNode[]): void {
  const usable = (nodes: OutlineNode[]): OutlineNode[] =>
    nodes.filter((n) => (n.pageIndex !== null && pages[n.pageIndex]) || usable(n.children).length > 0);
  const top = usable(outline);
  if (top.length === 0) return;
  const ctx = out.context;
  const rootRef = ctx.nextRef();

  const build = (nodes: OutlineNode[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = nodes.map(() => ctx.nextRef());
    let total = 0;
    nodes.forEach((n, i) => {
      const dict = ctx.obj({}) as PDFDict;
      dict.set(N.Title, PDFHexString.fromText(n.title));
      dict.set(N.Parent, parent);
      if (i > 0) dict.set(N.Prev, refs[i - 1]!);
      if (i < nodes.length - 1) dict.set(N.Next, refs[i + 1]!);
      const index = n.pageIndex ?? firstPageIndex(n.children);
      const page = index === null ? undefined : pages[index];
      if (page) {
        if (n.top !== null && n.pageIndex !== null) {
          const box = page.getMediaBox();
          const y = box.y + box.height - n.top;
          dict.set(N.Dest, ctx.obj([page.ref, N.XYZ, PDFNull, y, PDFNull]));
        } else {
          dict.set(N.Dest, ctx.obj([page.ref, N.Fit]));
        }
      }
      const kids = usable(n.children);
      if (kids.length > 0) {
        const sub = build(kids, refs[i]!);
        dict.set(N.First, sub.first);
        dict.set(N.Last, sub.last);
        dict.set(N.Count, PDFNumber.of(-kids.length)); // closed; top level stays visible
      }
      ctx.assign(refs[i]!, dict);
      total++;
    });
    return { first: refs[0]!, last: refs[refs.length - 1]!, count: total };
  };

  const { first, last, count } = build(top, rootRef);
  const root = ctx.obj({}) as PDFDict;
  root.set(N.Type, N.Outlines);
  root.set(N.First, first);
  root.set(N.Last, last);
  root.set(N.Count, PDFNumber.of(count));
  ctx.assign(rootRef, root);
  out.catalog.set(N.Outlines, rootRef);
}

function firstPageIndex(nodes: OutlineNode[]): number | null {
  for (const n of nodes) {
    if (n.pageIndex !== null) return n.pageIndex;
    const deeper = firstPageIndex(n.children);
    if (deeper !== null) return deeper;
  }
  return null;
}

function copyMetadata(from: PDFDocument, to: PDFDocument): void {
  const title = from.getTitle();
  const author = from.getAuthor();
  const subject = from.getSubject();
  const keywords = from.getKeywords();
  const created = from.getCreationDate();
  if (title) to.setTitle(title);
  if (author) to.setAuthor(author);
  if (subject) to.setSubject(subject);
  if (keywords) to.setKeywords(keywords.split(/\s+/).filter(Boolean));
  if (created) to.setCreationDate(created);
  to.setProducer('Preview for Windows');
  to.setModificationDate(new Date());
}
