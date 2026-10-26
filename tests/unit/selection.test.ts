import { describe, expect, test } from 'vitest';
import { Selection } from '../../src/edit/selection';

const order = [1, 2, 3, 4, 5, 6];
const plain = { ctrl: false, shift: false };
const ctrl = { ctrl: true, shift: false };
const shift = { ctrl: false, shift: true };
const both = { ctrl: true, shift: true };

const sorted = (s: Selection) => [...s.ids].sort((a, b) => a - b);

describe('Selection', () => {
  test('starts empty', () => {
    const s = new Selection();
    expect(s.size).toBe(0);
    expect(s.anchor).toBeNull();
    expect(s.has(1)).toBe(false);
  });

  describe('click', () => {
    test('plain click selects only that id and anchors there', () => {
      const s = new Selection();
      s.click(2, order, plain);
      s.click(4, order, plain);
      expect(sorted(s)).toEqual([4]);
      expect(s.anchor).toBe(4);
    });

    test('ctrl click toggles the id and moves the anchor', () => {
      const s = new Selection();
      s.click(2, order, plain);
      s.click(4, order, ctrl);
      expect(sorted(s)).toEqual([2, 4]);
      expect(s.anchor).toBe(4);
      s.click(2, order, ctrl);
      expect(sorted(s)).toEqual([4]);
      expect(s.anchor).toBe(2);
    });

    test('shift click replaces the selection with the range from the anchor', () => {
      const s = new Selection();
      s.click(5, order, plain);
      s.click(1, order, ctrl);
      s.click(3, order, shift);
      expect(sorted(s)).toEqual([1, 2, 3]);
      expect(s.anchor).toBe(1);
      s.click(5, order, shift);
      expect(sorted(s)).toEqual([1, 2, 3, 4, 5]);
      expect(s.anchor).toBe(1);
    });

    test('ranges follow the given order, not id values', () => {
      const s = new Selection();
      const shuffled = [4, 1, 6, 2, 5, 3];
      s.click(1, shuffled, plain);
      s.click(2, shuffled, shift);
      expect(sorted(s)).toEqual([1, 2, 6]);
    });

    test('ctrl+shift click adds the range to the selection', () => {
      const s = new Selection();
      s.click(1, order, plain);
      s.click(4, order, ctrl);
      s.click(6, order, both);
      expect(sorted(s)).toEqual([1, 4, 5, 6]);
      expect(s.anchor).toBe(4);
    });

    test('shift click without an anchor acts as a plain click', () => {
      const s = new Selection();
      s.click(3, order, shift);
      expect(sorted(s)).toEqual([3]);
      expect(s.anchor).toBe(3);
    });

    test('shift click with an anchor that left the order acts as a plain click', () => {
      const s = new Selection();
      s.click(2, order, plain);
      s.click(5, [1, 3, 4, 5, 6], shift);
      expect(sorted(s)).toEqual([5]);
      expect(s.anchor).toBe(5);
    });
  });

  test('selectOnly, set, selectAll and clear', () => {
    const s = new Selection();
    s.selectOnly(3);
    expect(sorted(s)).toEqual([3]);
    expect(s.anchor).toBe(3);

    s.set([5, 6, 2]);
    expect(sorted(s)).toEqual([2, 5, 6]);
    expect(s.anchor).toBe(5);
    s.set([1, 2], 2);
    expect(s.anchor).toBe(2);
    s.set([]);
    expect(s.size).toBe(0);
    expect(s.anchor).toBeNull();

    s.selectAll(order);
    expect(sorted(s)).toEqual(order);
    expect(s.size).toBe(6);
    expect(s.anchor).toBe(1);

    s.clear();
    expect(s.size).toBe(0);
    expect(s.anchor).toBeNull();
  });

  test('ids is a snapshot that later changes do not mutate', () => {
    const s = new Selection();
    s.set([1, 2]);
    const before = s.ids;
    s.click(3, order, ctrl);
    expect([...before]).toEqual([1, 2]);
    expect(s.has(3)).toBe(true);
  });

  describe('step', () => {
    test('without a selection selects the first or last id', () => {
      const s = new Selection();
      expect(s.step(1, order, false)).toBe(1);
      expect(sorted(s)).toEqual([1]);
      s.clear();
      expect(s.step(-1, order, true)).toBe(6);
      expect(sorted(s)).toEqual([6]);
      expect(s.anchor).toBe(6);
    });

    test('moves to the neighbour and selects only it', () => {
      const s = new Selection();
      s.click(3, order, plain);
      expect(s.step(1, order, false)).toBe(4);
      expect(sorted(s)).toEqual([4]);
      expect(s.anchor).toBe(4);
      expect(s.step(-1, order, false)).toBe(3);
      expect(sorted(s)).toEqual([3]);
    });

    test('stays on the first or last id at the edges', () => {
      const s = new Selection();
      s.click(6, order, plain);
      expect(s.step(1, order, false)).toBe(6);
      expect(sorted(s)).toEqual([6]);
      s.click(1, order, plain);
      expect(s.step(-1, order, false)).toBe(1);
    });

    test('moves from the last clicked id, not the anchor', () => {
      const s = new Selection();
      s.click(2, order, plain);
      s.click(4, order, shift);
      expect(s.focus).toBe(4);
      expect(s.step(1, order, false)).toBe(5);
      expect(sorted(s)).toEqual([5]);
      expect(s.focus).toBe(5);
    });

    test('with extend grows and shrinks the range around the anchor', () => {
      const s = new Selection();
      s.click(3, order, plain);
      expect(s.step(1, order, true)).toBe(4);
      expect(s.step(1, order, true)).toBe(5);
      expect(sorted(s)).toEqual([3, 4, 5]);
      expect(s.anchor).toBe(3);
      expect(s.step(-1, order, true)).toBe(4);
      expect(s.step(-1, order, true)).toBe(3);
      expect(s.step(-1, order, true)).toBe(2);
      expect(sorted(s)).toEqual([2, 3]);
      expect(s.anchor).toBe(3);
    });

    test('with extend continues a shift-click range from its far end', () => {
      const s = new Selection();
      s.click(2, order, plain);
      s.click(4, order, shift);
      expect(s.step(1, order, true)).toBe(5);
      expect(sorted(s)).toEqual([2, 3, 4, 5]);
    });

    test('after selectAll, extend shrinks from the end', () => {
      const s = new Selection();
      s.selectAll(order);
      expect(s.step(-1, order, true)).toBe(5);
      expect(sorted(s)).toEqual([1, 2, 3, 4, 5]);
    });

    test('returns null for an empty order', () => {
      const s = new Selection();
      expect(s.step(1, [], false)).toBeNull();
      expect(s.size).toBe(0);
    });

    test('falls back to the anchor when the focused id left the order', () => {
      const s = new Selection();
      s.click(2, order, plain);
      s.click(3, order, shift);
      s.prune([1, 2, 4, 5, 6]);
      expect(s.step(1, [1, 2, 4, 5, 6], false)).toBe(4);
    });

    test('falls back to the selected pages when focus and anchor left the order', () => {
      const rest = [1, 2, 4, 5, 6];
      const s = new Selection();
      s.set([2, 3], 3);
      s.prune(rest);
      expect(s.anchor).toBeNull();
      expect(s.step(1, rest, false)).toBe(4);
      s.set([2, 3], 3);
      s.prune(rest);
      expect(s.step(-1, rest, false)).toBe(1);
    });
  });

  test('prune drops ids that are gone, and the anchor with them', () => {
    const s = new Selection();
    s.click(2, order, plain);
    s.click(4, order, ctrl);
    s.prune([1, 2, 3, 5, 6]);
    expect(sorted(s)).toEqual([2]);
    expect(s.anchor).toBeNull();
    s.prune([1, 2, 3]);
    expect(sorted(s)).toEqual([2]);
  });
});
