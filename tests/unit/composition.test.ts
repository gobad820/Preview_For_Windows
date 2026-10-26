import { describe, expect, test } from 'vitest';
import {
  canDelete,
  deletePages,
  fromSource,
  idSource,
  insertPages,
  movePages,
  samePages,
  type Composition,
} from '../../src/edit/composition';

const ids = (c: Composition) => c.map((p) => p.id);

/** Pages with ids 1..6 from source 0. */
const six = () => fromSource(0, 6, idSource());

describe('idSource', () => {
  test('counts up from 1 by default', () => {
    const next = idSource();
    expect([next(), next(), next()]).toEqual([1, 2, 3]);
  });

  test('starts at the given number', () => {
    const next = idSource(10);
    expect([next(), next()]).toEqual([10, 11]);
  });
});

describe('fromSource', () => {
  test('creates one ref per page with fresh ids', () => {
    const next = idSource();
    const c = fromSource(2, 3, next);
    expect(c).toEqual([
      { id: 1, src: 2, index: 0 },
      { id: 2, src: 2, index: 1 },
      { id: 3, src: 2, index: 2 },
    ]);
    expect(next()).toBe(4);
  });
});

describe('movePages', () => {
  test('moves a selection to the very start', () => {
    expect(ids(movePages(six(), new Set([2, 3]), 0))).toEqual([2, 3, 1, 4, 5, 6]);
  });

  test('moves a selection to the very end', () => {
    expect(ids(movePages(six(), new Set([2, 3]), 6))).toEqual([1, 4, 5, 6, 2, 3]);
  });

  test('moves a selection before the last page', () => {
    expect(ids(movePages(six(), new Set([2, 3]), 5))).toEqual([1, 4, 5, 2, 3, 6]);
  });

  test('gathers a non-contiguous selection into the target gap, keeping its order', () => {
    // Gap 3 lies between the original pages 3 and 4.
    expect(ids(movePages(six(), new Set([5, 2]), 3))).toEqual([1, 3, 2, 5, 4, 6]);
  });

  test('gathers a non-contiguous selection at the gap after its first page', () => {
    expect(ids(movePages(six(), new Set([2, 5]), 2))).toEqual([1, 2, 5, 3, 4, 6]);
  });

  test('dropping into a gap inside or next to the selection returns the same instance', () => {
    const c = six();
    for (const gap of [1, 2, 3]) expect(movePages(c, new Set([2, 3]), gap)).toBe(c);
  });

  test('moving every page returns the same instance', () => {
    const c = six();
    expect(movePages(c, new Set([1, 2, 3, 4, 5, 6]), 0)).toBe(c);
    expect(movePages(c, new Set([1, 2, 3, 4, 5, 6]), 6)).toBe(c);
  });

  test('an empty or unknown selection returns the same instance', () => {
    const c = six();
    expect(movePages(c, new Set(), 0)).toBe(c);
    expect(movePages(c, new Set([99]), 0)).toBe(c);
  });

  test('clamps the gap into range', () => {
    expect(ids(movePages(six(), new Set([1]), 99))).toEqual([2, 3, 4, 5, 6, 1]);
    expect(ids(movePages(six(), new Set([6]), -5))).toEqual([6, 1, 2, 3, 4, 5]);
  });

  test('does not mutate the input', () => {
    const c = six();
    movePages(c, new Set([2, 3]), 0);
    expect(ids(c)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('deletePages', () => {
  test('removes the given pages', () => {
    expect(ids(deletePages(six(), new Set([2])))).toEqual([1, 3, 4, 5, 6]);
    expect(ids(deletePages(six(), new Set([1, 6])))).toEqual([2, 3, 4, 5]);
  });

  test('deleting every page returns the same instance', () => {
    const c = six();
    expect(deletePages(c, new Set([1, 2, 3, 4, 5, 6]))).toBe(c);
  });

  test('an empty or unknown selection returns the same instance', () => {
    const c = six();
    expect(deletePages(c, new Set())).toBe(c);
    expect(deletePages(c, new Set([99]))).toBe(c);
  });
});

describe('canDelete', () => {
  test('is true when some but not all pages are selected', () => {
    expect(canDelete(six(), new Set([2, 3]))).toBe(true);
  });

  test('is false for an empty, unknown or complete selection', () => {
    const c = six();
    expect(canDelete(c, new Set())).toBe(false);
    expect(canDelete(c, new Set([99]))).toBe(false);
    expect(canDelete(c, new Set([1, 2, 3, 4, 5, 6]))).toBe(false);
  });

  test('is false for the last remaining page', () => {
    expect(canDelete(fromSource(0, 1, idSource()), new Set([1]))).toBe(false);
  });
});

describe('insertPages', () => {
  test('inserts refs at the gap with new ids', () => {
    const next = idSource();
    const c = fromSource(0, 6, next);
    const { pages, ids: added } = insertPages(c, 1, [{ src: 1, index: 0 }, { src: 1, index: 4 }], next);
    expect(added).toEqual([7, 8]);
    expect(ids(pages)).toEqual([1, 7, 8, 2, 3, 4, 5, 6]);
    expect(pages[1]).toEqual({ id: 7, src: 1, index: 0 });
    expect(pages[2]).toEqual({ id: 8, src: 1, index: 4 });
    expect(ids(c)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('inserting the same page twice yields distinct ids', () => {
    const next = idSource();
    const c = fromSource(0, 2, next);
    const once = insertPages(c, 2, [{ src: 0, index: 0 }], next);
    const twice = insertPages(once.pages, 3, [{ src: 0, index: 0 }], next);
    expect(once.ids).toEqual([3]);
    expect(twice.ids).toEqual([4]);
    expect(ids(twice.pages)).toEqual([1, 2, 3, 4]);
    expect(new Set(ids(twice.pages)).size).toBe(4);
  });

  test('clamps the gap into range', () => {
    const next = idSource();
    const c = fromSource(0, 2, next);
    expect(ids(insertPages(c, 99, [{ src: 0, index: 1 }], next).pages)).toEqual([1, 2, 3]);
    expect(ids(insertPages(c, -1, [{ src: 0, index: 1 }], next).pages)).toEqual([4, 1, 2]);
  });

  test('inserting nothing returns the same instance', () => {
    const next = idSource();
    const c = fromSource(0, 2, next);
    const r = insertPages(c, 1, [], next);
    expect(r.pages).toBe(c);
    expect(r.ids).toEqual([]);
  });
});

describe('samePages', () => {
  test('compares ids in order', () => {
    const c = six();
    expect(samePages(c, [...c])).toBe(true);
    expect(samePages(c, movePages(c, new Set([1]), 6))).toBe(false);
    expect(samePages(c, deletePages(c, new Set([6])))).toBe(false);
  });

  test('treats separate arrays with the same ids as the same', () => {
    const a: Composition = [{ id: 1, src: 0, index: 0 }];
    const b: Composition = [{ id: 1, src: 0, index: 0 }];
    expect(samePages(a, b)).toBe(true);
  });
});
