/**
 * A document's page order as an immutable list of page references. Every
 * operation is pure and returns the input instance when nothing changes, so
 * callers can skip history entries and re-renders by identity.
 */

/** One page position: page `index` of source `src`. `id` is unique per window session. */
export interface PageRef {
  readonly id: number;
  readonly src: number;
  readonly index: number;
}

export type Composition = readonly PageRef[];

/** Returns a counter yielding `start`, `start + 1`, … (ids are never reused). */
export function idSource(start = 1): () => number {
  let next = start;
  return () => next++;
}

export function fromSource(src: number, count: number, nextId: () => number): Composition {
  return Array.from({ length: count }, (_, index) => ({ id: nextId(), src, index }));
}

const clampGap = (c: Composition, gap: number) => Math.max(0, Math.min(c.length, gap));

/**
 * Moves the pages whose ids are in `ids` (keeping their relative order) into gap `gap`
 * of the ORIGINAL composition (0 = before the first page, length = after the last).
 * Returns the same array instance when nothing changes.
 */
export function movePages(c: Composition, ids: ReadonlySet<number>, gap: number): Composition {
  const at = clampGap(c, gap);
  const moved = c.filter((p) => ids.has(p.id));
  if (moved.length === 0) return c;
  const before = c.slice(0, at).filter((p) => !ids.has(p.id));
  const after = c.slice(at).filter((p) => !ids.has(p.id));
  const next = [...before, ...moved, ...after];
  return samePages(c, next) ? c : next;
}

export function canDelete(c: Composition, ids: ReadonlySet<number>): boolean {
  const count = c.reduce((n, p) => (ids.has(p.id) ? n + 1 : n), 0);
  return count > 0 && count < c.length;
}

/** Returns the same instance when `ids` is empty or would delete every page. */
export function deletePages(c: Composition, ids: ReadonlySet<number>): Composition {
  if (!canDelete(c, ids)) return c;
  return c.filter((p) => !ids.has(p.id));
}

/** Inserts new refs (fresh ids, in order) into gap `gap`; returns the new composition and the new ids. */
export function insertPages(
  c: Composition,
  gap: number,
  refs: ReadonlyArray<{ src: number; index: number }>,
  nextId: () => number,
): { pages: Composition; ids: number[] } {
  if (refs.length === 0) return { pages: c, ids: [] };
  const added = refs.map(({ src, index }) => ({ id: nextId(), src, index }));
  const at = clampGap(c, gap);
  return { pages: [...c.slice(0, at), ...added, ...c.slice(at)], ids: added.map((p) => p.id) };
}

/** Same ids in the same order. */
export function samePages(a: Composition, b: Composition): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((p, i) => p.id === b[i]?.id);
}
