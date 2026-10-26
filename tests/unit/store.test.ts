import { describe, expect, test, vi } from 'vitest';
import { createStore, initialState, type ViewerState } from '../../src/store';

interface Counter {
  count: number;
  label: string;
}

const make = () => createStore<Counter>({ count: 0, label: 'a' });

describe('createStore', () => {
  test('get returns the initial state', () => {
    const store = make();
    expect(store.get()).toEqual({ count: 0, label: 'a' });
  });

  test('set shallow-merges the patch and notifies with (state, prev)', () => {
    const store = make();
    const fn = vi.fn();
    store.subscribe(fn);

    store.set({ count: 1 });

    expect(store.get()).toEqual({ count: 1, label: 'a' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ count: 1, label: 'a' }, { count: 0, label: 'a' });
  });

  test('set does not mutate the previous state object', () => {
    const store = make();
    const before = store.get();
    store.set({ count: 5 });
    expect(before).toEqual({ count: 0, label: 'a' });
    expect(store.get()).not.toBe(before);
  });

  test('set with identical values does not notify', () => {
    const store = make();
    const fn = vi.fn();
    store.subscribe(fn);

    store.set({ count: 0, label: 'a' });
    store.set({});

    expect(fn).not.toHaveBeenCalled();
    expect(store.get()).toEqual({ count: 0, label: 'a' });
  });

  test('set notifies when at least one key changed by Object.is', () => {
    const store = createStore<{ n: number }>({ n: NaN });
    const fn = vi.fn();
    store.subscribe(fn);

    store.set({ n: NaN });
    expect(fn).not.toHaveBeenCalled();

    store.set({ n: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('subscribe returns an unsubscribe function', () => {
    const store = make();
    const fn = vi.fn();
    const unsubscribe = store.subscribe(fn);

    store.set({ count: 1 });
    unsubscribe();
    store.set({ count: 2 });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('select fires immediately with the current value', () => {
    const store = make();
    const fn = vi.fn();
    store.select('count', fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(0);
  });

  test('select fires only when its key changes', () => {
    const store = make();
    const fn = vi.fn();
    store.select('count', fn);
    fn.mockClear();

    store.set({ label: 'b' });
    expect(fn).not.toHaveBeenCalled();

    store.set({ count: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);

    store.set({ count: 3, label: 'c' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('select returns an unsubscribe function', () => {
    const store = make();
    const fn = vi.fn();
    const unsubscribe = store.select('count', fn);
    fn.mockClear();

    unsubscribe();
    store.set({ count: 9 });

    expect(fn).not.toHaveBeenCalled();
  });
});

describe('initialState', () => {
  test('matches the spec defaults', () => {
    const expected: ViewerState = {
      filePath: null,
      fileName: null,
      numPages: 0,
      currentPage: 0,
      zoomMode: 'fit-width',
      scale: 1,
      rotation: 0,
      sidebarOpen: false,
      sidebarTab: 'thumbnails',
      findOpen: false,
      findQuery: '',
      findTotal: 0,
      findIndex: -1,
      status: 'empty',
      error: null,
      dirty: false,
      markupOpen: false,
      displayMode: 'continuous',
      bookMode: false,
    };
    expect(initialState).toEqual(expected);
  });

  test('can seed a viewer store', () => {
    const store = createStore<ViewerState>(initialState);
    store.set({ status: 'loading', fileName: 'a.pdf' });
    expect(store.get().status).toBe('loading');
    expect(store.get().fileName).toBe('a.pdf');
    expect(initialState.status).toBe('empty');
  });
});
