/**
 * Pure text index + matcher for find-in-document. No DOM, no pdf.js imports:
 * callers pass pdf.js text items in and get back offsets into the page text.
 */

export interface TextItemLike {
  str: string;
  hasEOL?: boolean;
}

export interface PageTextIndex {
  pageIndex: number;
  /** Item strings joined, with '\n' appended after every item that has `hasEOL`. */
  text: string;
  /** `itemStarts[i]` is the offset of item i's string inside `text`. */
  itemStarts: number[];
}

export interface Match {
  pageIndex: number;
  /** Offsets into `PageTextIndex.text` (end exclusive). */
  start: number;
  end: number;
}

export interface ItemSpan {
  item: number;
  /** Offsets relative to that item's own string (end exclusive). */
  start: number;
  end: number;
}

export function buildPageIndex(pageIndex: number, items: TextItemLike[]): PageTextIndex {
  const parts: string[] = [];
  const itemStarts: number[] = [];
  let offset = 0;
  for (const item of items) {
    itemStarts.push(offset);
    parts.push(item.str);
    offset += item.str.length;
    if (item.hasEOL) {
      parts.push('\n');
      offset += 1;
    }
  }
  return { pageIndex, text: parts.join(''), itemStarts };
}

/**
 * NFKC + lower-cased copy of a page text, plus a map from every code unit of
 * the copy back to the original run it came from. Normalisation can change
 * string length (ligatures, fullwidth forms, some case mappings), so matches
 * found in the copy are mapped back through `starts`/`ends`.
 */
interface NormalisedText {
  source: string;
  norm: string;
  starts: number[];
  ends: number[];
}

/**
 * Runs: an ASCII stretch (not followed by a combining mark), a base character
 * with its combining marks, or leading orphan marks. Every code unit of the
 * input belongs to exactly one run.
 */
const RUN_RE = /([\x00-\x7F]+)(?!\p{M})|\P{M}\p{M}*|\p{M}+/gu;

function normaliseText(source: string): NormalisedText {
  const parts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (const m of source.matchAll(RUN_RE)) {
    const run = m[0];
    const runStart = m.index;
    const runEnd = runStart + run.length;
    if (m[1] !== undefined) {
      // ASCII run: lower-casing is 1:1, so map each unit to itself.
      parts.push(run.toLowerCase());
      for (let i = runStart; i < runEnd; i++) {
        starts.push(i);
        ends.push(i + 1);
      }
      continue;
    }
    const n = run.normalize('NFKC').toLowerCase();
    parts.push(n);
    for (let i = 0; i < n.length; i++) {
      starts.push(runStart);
      ends.push(runEnd);
    }
  }
  return { source, norm: parts.join(''), starts, ends };
}

const normalisedCache = new WeakMap<PageTextIndex, NormalisedText>();

function normalised(page: PageTextIndex): NormalisedText {
  const cached = normalisedCache.get(page);
  if (cached && cached.source === page.text) return cached;
  const nt = normaliseText(page.text);
  normalisedCache.set(page, nt);
  return nt;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive, NFKC-normalised, non-overlapping matches. Any whitespace
 * run in the query matches any whitespace run (newlines included) in the text.
 */
export function findMatches(query: string, pages: PageTextIndex[]): Match[] {
  const tokens = query.normalize('NFKC').toLowerCase().split(/\s+/u).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  const re = new RegExp(tokens.map(escapeRegExp).join('\\s+'), 'gu');
  const out: Match[] = [];
  for (const page of pages) {
    const nt = normalised(page);
    for (const m of nt.norm.matchAll(re)) {
      const s = m.index;
      const e = s + m[0].length;
      out.push({ pageIndex: page.pageIndex, start: nt.starts[s]!, end: nt.ends[e - 1]! });
    }
  }
  out.sort((a, b) => a.pageIndex - b.pageIndex || a.start - b.start);
  return out;
}

/** Index of the last item whose start is <= `offset` (0 when none). */
function itemAt(itemStarts: number[], offset: number): number {
  let lo = 0;
  let hi = itemStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (itemStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Splits a match across the items it covers; offsets are relative to each item's string. */
export function matchToItemSpans(index: PageTextIndex, m: Match): ItemSpan[] {
  const { itemStarts, text } = index;
  const spans: ItemSpan[] = [];
  for (let i = itemAt(itemStarts, m.start); i < itemStarts.length; i++) {
    const itemStart = itemStarts[i]!;
    if (itemStart >= m.end) break;
    let itemEnd = i + 1 < itemStarts.length ? itemStarts[i + 1]! : text.length;
    // The '\n' appended for hasEOL belongs to no item.
    if (itemEnd > itemStart && text.charCodeAt(itemEnd - 1) === 0x0a) itemEnd--;
    const start = Math.max(m.start, itemStart) - itemStart;
    const end = Math.min(m.end, itemEnd) - itemStart;
    if (end > start) spans.push({ item: i, start, end });
  }
  return spans;
}
