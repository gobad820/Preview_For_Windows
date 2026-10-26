import { describe, expect, test } from 'vitest';
import { History } from '../../src/edit/history';

describe('History', () => {
  test('starts at the initial value with nothing to undo or redo', () => {
    const h = new History('a');
    expect(h.current).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
    expect(h.current).toBe('a');
  });

  test('push, undo and redo walk the entries', () => {
    const h = new History('a');
    h.push('b');
    h.push('c');
    expect(h.current).toBe('c');
    expect(h.canUndo).toBe(true);
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeNull();
    expect(h.current).toBe('a');
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.redo()).toBeNull();
    expect(h.current).toBe('c');
  });

  test('push after undo drops the redo entries', () => {
    const h = new History('a');
    h.push('b');
    h.push('c');
    h.undo();
    h.push('d');
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
  });

  test('keeps at most `limit` undo steps', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 5; i++) h.push(i);
    expect(h.undo()).toBe(4);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBeNull();
    expect(h.current).toBe(2);
  });

  test('defaults to 200 undo steps', () => {
    const h = new History(0);
    for (let i = 1; i <= 250; i++) h.push(i);
    let steps = 0;
    while (h.undo() !== null) steps++;
    expect(steps).toBe(200);
    expect(h.current).toBe(50);
  });

  describe('dirty', () => {
    test('is clean initially, dirty after a push and clean after markSaved', () => {
      const h = new History('a');
      expect(h.dirty).toBe(false);
      h.push('b');
      expect(h.dirty).toBe(true);
      h.markSaved();
      expect(h.dirty).toBe(false);
    });

    test('undo past the save is dirty; redo back to it is clean', () => {
      const h = new History('a');
      h.push('b');
      h.markSaved();
      h.undo();
      expect(h.dirty).toBe(true);
      h.redo();
      expect(h.dirty).toBe(false);
    });

    test('undoing back to the opened state is clean when nothing was saved', () => {
      const h = new History('a');
      h.push('b');
      h.undo();
      expect(h.dirty).toBe(false);
    });

    test('compares entries, not values: pushing an equal value is still dirty', () => {
      const h = new History('a');
      h.push('a');
      expect(h.dirty).toBe(true);
    });

    test('stays dirty once the saved entry is dropped by a push after undo', () => {
      const h = new History('a');
      h.push('b');
      h.markSaved();
      h.undo();
      h.push('c');
      expect(h.dirty).toBe(true);
      h.undo();
      expect(h.dirty).toBe(true);
      h.redo();
      expect(h.dirty).toBe(true);
      h.markSaved();
      expect(h.dirty).toBe(false);
    });

    test('stays dirty once the saved entry is dropped by the limit', () => {
      const h = new History(0, 2);
      h.markSaved();
      h.push(1);
      h.push(2);
      h.push(3);
      while (h.undo() !== null);
      expect(h.current).toBe(1);
      expect(h.dirty).toBe(true);
      h.markSaved();
      expect(h.dirty).toBe(false);
    });
  });

  test('reset starts a clean history with empty stacks', () => {
    const h = new History('a');
    h.push('b');
    h.push('c');
    h.undo();
    h.reset('x');
    expect(h.current).toBe('x');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.dirty).toBe(false);
    h.push('y');
    expect(h.dirty).toBe(true);
    expect(h.undo()).toBe('x');
    expect(h.dirty).toBe(false);
  });
});
