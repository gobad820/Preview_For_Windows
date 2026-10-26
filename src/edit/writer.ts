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
  PDFStream,
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
  /** Page label of every output page (as shown by viewers), or omitted when no source has labels. */
  pageLabels?: Array<string | null>;
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
  AA: PDFName.of('AA'),
  Next: PDFName.of('Next'),
  Widget: PDFName.of('Widget'),
  URI: PDFName.of('URI'),
  PageLabels: PDFName.of('PageLabels'),
  Nums: PDFName.of('Nums'),
};

/** A key in a dictionary or an index in an array, on the way from an annotation to an action. */
type Step = PDFName | number;

/** A GoTo action found under an annotation, with the source page it pointed at. */
interface ActionInfo {
  path: Step[];
  target: number | null;
  rest: PDFObject[];
}

/** What the pre-pass learned about one annotation, in the page's /Annots order. */
interface AnnotInfo {
  hadP: boolean;
  isLink: boolean;
  /** A link's own /Dest: target page in the same source (null = unresolvable) and the rest of it. */
  dest: { target: number | null; rest: PDFObject[] } | null;
  /** GoTo actions in /A, /AA and /Next chains. */
  actions: ActionInfo[];
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

  // Post-pass: restore /P, retarget destinations and actions, or remove what pointed at dropped pages.
  pages.forEach((p, i) => {
    const infos = prepared.get(p.src)!.annots[p.index] ?? [];
    if (infos.length === 0) return;
    const page = outPages[i]!;
    const annots = page.node.lookupMaybe(N.Annots, PDFArray);
    if (!annots) return;
    const keep: PDFObject[] = [];
    const posOf = (target: number | null) =>
      target === null ? undefined : firstPos.get(`${p.src}:${target}`);
    infos.forEach((info, k) => {
      const entry = annots.get(k);
      const annot = entry ? out.context.lookupMaybe(entry, PDFDict) : undefined;
      if (!entry || !annot) return;
      if (info.hadP) annot.set(N.P, page.ref);
      let drop = false;
      if (info.dest) {
        const pos = posOf(info.dest.target);
        if (pos === undefined) drop = true;
        else annot.set(N.Dest, out.context.obj([outPages[pos]!.ref, ...info.dest.rest]));
      }
      // Deepest paths first, so removing an array entry never shifts one still to be visited.
      const actions = [...info.actions].sort((a, b) => b.path.length - a.path.length || compareSteps(b.path, a.path));
      for (const action of actions) {
        const at = followPath(out, annot, action.path);
        if (!at) continue;
        const pos = posOf(action.target);
        if (pos !== undefined) {
          at.dict.set(N.D, out.context.obj([outPages[pos]!.ref, ...action.rest]));
        } else if (info.isLink && action.path.length === 1) {
          drop = true; // a link whose own action leads nowhere
        } else if (at.parent instanceof PDFDict) {
          at.parent.delete(at.step as PDFName);
        } else {
          at.parent.remove(at.step as number);
        }
      }
      if (!drop) keep.push(entry);
    });
    page.node.set(N.Annots, out.context.obj(keep));
  });

  writeOutline(out, outPages, opts.outline);
  if (opts.pageLabels?.some((l) => l !== null)) writePageLabels(out, opts.pageLabels);

  const metaSrc = prepared.get(opts.metaFrom ?? pages[0]!.src)?.doc;
  if (metaSrc) copyMetadata(metaSrc, out);

  sweepUnreachable(out);
  return out.save();
}

async function loadSource(src: WriterSource): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(src.bytes, {
      // Files restricted only by an owner password open with the empty user password.
      password: src.password ?? '',
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
 * back-references, widget links into the form field tree, article beads, page-level actions,
 * link destinations and every GoTo action (remembered for the post-pass).
 */
function prepare(doc: PDFDocument): Prepared {
  const pageIndexByRef = new Map<string, number>();
  const pageList = doc.getPages();
  pageList.forEach((p, i) => pageIndexByRef.set(p.ref.toString(), i));
  // Shared annotations and actions are visited once; later visits reuse what was learned.
  const seenAnnots = new Map<PDFDict, AnnotInfo>();
  const seenActions = new Map<PDFDict, { target: number | null; rest: PDFObject[] }>();

  const collect = (annot: PDFDict): ActionInfo[] => {
    const found: ActionInfo[] = [];
    const visit = (action: PDFDict | undefined, path: Step[], depth: number): void => {
      if (!action || depth > 16) return;
      if (action.get(N.S) === N.GoTo) {
        let known = seenActions.get(action);
        if (!known) {
          known = resolveDest(doc, action.get(N.D) ?? PDFNull, pageIndexByRef);
          seenActions.set(action, known);
          action.set(N.D, PDFNull);
        }
        found.push({ path, ...known });
      }
      const next = lookupAny(doc, action.get(N.Next));
      if (next instanceof PDFDict) visit(next, [...path, N.Next], depth + 1);
      else if (next instanceof PDFArray) {
        for (let i = 0; i < next.size(); i++) {
          visit(doc.context.lookupMaybe(next.get(i), PDFDict), [...path, N.Next, i], depth + 1);
        }
      }
    };
    visit(annot.lookupMaybe(N.A, PDFDict), [N.A], 0);
    const aa = annot.lookupMaybe(N.AA, PDFDict);
    for (const [key] of aa?.entries() ?? []) visit(aa!.lookupMaybe(key, PDFDict), [N.AA, key], 0);
    return found;
  };

  const annots: AnnotInfo[][] = pageList.map((page) => {
    page.node.delete(N.B);
    page.node.delete(N.AA);
    const arr = page.node.lookupMaybe(N.Annots, PDFArray);
    if (!arr) return [];
    const infos: AnnotInfo[] = [];
    for (let k = 0; k < arr.size(); k++) {
      const annot = doc.context.lookupMaybe(arr.get(k), PDFDict);
      if (!annot) {
        infos.push({ hadP: false, isLink: false, dest: null, actions: [] });
        continue;
      }
      const known = seenAnnots.get(annot);
      if (known) {
        infos.push(known);
        continue;
      }
      const hadP = annot.has(N.P);
      annot.delete(N.P);
      const subtype = annot.get(N.Subtype);
      if (subtype === N.Widget) annot.delete(N.Parent); // forms are not kept interactive
      let dest: AnnotInfo['dest'] = null;
      if (subtype === N.Link && annot.get(N.Dest) !== undefined) {
        dest = resolveDest(doc, annot.get(N.Dest)!, pageIndexByRef);
        annot.set(N.Dest, PDFNull);
      }
      const info: AnnotInfo = { hadP, isLink: subtype === N.Link, dest, actions: collect(annot) };
      seenAnnots.set(annot, info);
      infos.push(info);
    }
    return infos;
  });
  return { doc, annots };
}

function lookupAny(doc: PDFDocument, value: PDFObject | undefined): PDFObject | undefined {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

/** Follows `path` from an annotation to an action dictionary in the output. */
function followPath(
  out: PDFDocument,
  annot: PDFDict,
  path: Step[],
): { parent: PDFDict | PDFArray; step: Step; dict: PDFDict } | null {
  let parent: PDFDict | PDFArray = annot;
  let current: PDFObject | undefined = annot;
  let step: Step = path[0]!;
  for (step of path) {
    if (!(current instanceof PDFDict || current instanceof PDFArray)) return null;
    parent = current;
    current = lookupAny(out, typeof step === 'number' ? (current as PDFArray).get(step) : (current as PDFDict).get(step));
  }
  return current instanceof PDFDict ? { parent, step, dict: current } : null;
}

function compareSteps(a: Step[], b: Step[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (typeof x === 'number' && typeof y === 'number' && x !== y) return x - y;
  }
  return 0;
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
    nodes.filter((n) => (n.pageIndex !== null && pages[n.pageIndex]) || !!n.url || usable(n.children).length > 0);
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
      if (n.pageIndex === null && n.url) {
        dict.set(N.A, ctx.obj({ S: 'URI', URI: PDFString.of(n.url) }));
      } else if (page) {
        if (n.top !== null && n.pageIndex !== null) {
          // pdf.js measures `top` from the visible (crop) box.
          const box = page.getCropBox();
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

/** One label per page as a /PageLabels number tree with literal prefixes. */
function writePageLabels(out: PDFDocument, labels: Array<string | null>): void {
  const nums: PDFObject[] = [];
  labels.forEach((label, i) => {
    nums.push(PDFNumber.of(i), out.context.obj({ P: PDFHexString.fromText(label ?? String(i + 1)) }));
  });
  out.catalog.set(N.PageLabels, out.context.obj({ Nums: out.context.obj(nums) }));
}

/** Deletes every indirect object that the trailer cannot reach, so nothing dropped survives. */
function sweepUnreachable(out: PDFDocument): void {
  const ctx = out.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(
    (o): o is PDFObject => o !== undefined,
  );
  while (stack.length > 0) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      stack.push(...o.asArray());
    } else if (o instanceof PDFStream) {
      for (const [, v] of o.dict.entries()) stack.push(v);
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) ctx.delete(ref);
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
