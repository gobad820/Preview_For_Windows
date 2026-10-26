import { describe, expect, it, vi } from 'vitest';
import { bindShortcuts, resolveShortcut, type Action, type KeyLike } from '../../src/shortcuts';

function key(k: string, mods: Partial<KeyLike> = {}): KeyLike {
  return {
    key: k,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    inTextField: false,
    findFocused: false,
    ...mods,
  };
}

const ctrl = (k: string, mods: Partial<KeyLike> = {}): KeyLike => key(k, { ctrlKey: true, ...mods });
const inField = (k: string, mods: Partial<KeyLike> = {}): KeyLike => key(k, { inTextField: true, ...mods });
const inFind = (k: string, mods: Partial<KeyLike> = {}): KeyLike =>
  key(k, { inTextField: true, findFocused: true, ...mods });

describe('resolveShortcut', () => {
  const cases: Array<[string, KeyLike, Action | null]> = [
    ['Ctrl+O → open', ctrl('o'), 'open'],
    ['Ctrl+F → find', ctrl('f'), 'find'],
    ['Ctrl+= → zoom-in', ctrl('=', { code: 'Equal' }), 'zoom-in'],
    ['Ctrl++ (numpad) → zoom-in', ctrl('+', { code: 'NumpadAdd' }), 'zoom-in'],
    ['Ctrl+Shift+= → zoom-in', ctrl('+', { code: 'Equal', shiftKey: true }), 'zoom-in'],
    ['Ctrl+- → zoom-out', ctrl('-', { code: 'Minus' }), 'zoom-out'],
    ['Ctrl+- (numpad) → zoom-out', ctrl('-', { code: 'NumpadSubtract' }), 'zoom-out'],
    ['Ctrl+0 → zoom-100', ctrl('0'), 'zoom-100'],
    ['Ctrl+1 → fit-width', ctrl('1'), 'fit-width'],
    ['Ctrl+2 → fit-page', ctrl('2'), 'fit-page'],
    ['Ctrl+L → rotate-cw', ctrl('l'), 'rotate-cw'],
    ['Ctrl+Shift+L → rotate-ccw', ctrl('L', { shiftKey: true }), 'rotate-ccw'],
    ['Ctrl+Shift+S → toggle-sidebar', ctrl('S', { shiftKey: true }), 'toggle-sidebar'],
    ['Ctrl+S → null', ctrl('s'), null],
    ['Ctrl+Shift+O → null', ctrl('O', { shiftKey: true }), null],
    ['Ctrl+G → goto-page', ctrl('g'), 'goto-page'],
    ['Ctrl+L with a Korean IME key value resolves via code', ctrl('ㅣ', { code: 'KeyL' }), 'rotate-cw'],
    ['Space → scroll-down', key(' '), 'scroll-down'],
    ['Shift+Space → scroll-up', key(' ', { shiftKey: true }), 'scroll-up'],
    ['PageDown → scroll-down', key('PageDown'), 'scroll-down'],
    ['PageUp → scroll-up', key('PageUp'), 'scroll-up'],
    ['Home → first-page', key('Home'), 'first-page'],
    ['End → last-page', key('End'), 'last-page'],
    ['ArrowRight → next-page', key('ArrowRight'), 'next-page'],
    ['ArrowLeft → prev-page', key('ArrowLeft'), 'prev-page'],
    ['Shift+ArrowRight → null', key('ArrowRight', { shiftKey: true }), null],
    ['Escape → close-find', key('Escape'), 'close-find'],
    ['Enter outside find → null', key('Enter'), null],
    ['plain letter → null', key('o'), null],
    ['Alt+F → null', key('f', { altKey: true }), null],
    ['Ctrl+Alt+F → null', ctrl('f', { altKey: true }), null],
    ['Meta+O → null', key('o', { metaKey: true }), null],
    ['Space in a text field → null', inField(' '), null],
    ['ArrowRight in a text field → null', inField('ArrowRight'), null],
    ['Enter in a non-find text field → null', inField('Enter'), null],
    ['Ctrl+F in a text field → find', inField('f', { ctrlKey: true }), 'find'],
    ['Ctrl+= in a text field → zoom-in', inField('=', { ctrlKey: true }), 'zoom-in'],
    ['Escape in a text field → null', inField('Escape'), null],
    ['Enter in find → find-next', inFind('Enter'), 'find-next'],
    ['Shift+Enter in find → find-prev', inFind('Enter', { shiftKey: true }), 'find-prev'],
    ['Escape in find → close-find', inFind('Escape'), 'close-find'],
    ['Space in find → null', inFind(' '), null],
    ['Ctrl+F in find → find', inFind('f', { ctrlKey: true }), 'find'],
  ];

  it.each(cases)('%s', (_name, k, expected) => {
    expect(resolveShortcut(k)).toBe(expected);
  });
});

type Listener = (e: KeyboardEvent) => void;

function fakeWindow() {
  const listeners = new Map<string, Set<Listener>>();
  const win = {
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
  };
  const dispatch = (e: KeyboardEvent) => {
    for (const fn of listeners.get('keydown') ?? []) fn(e);
  };
  const count = () => listeners.get('keydown')?.size ?? 0;
  return { win: win as unknown as Window, dispatch, count };
}

interface FakeTarget {
  tagName?: string;
  isContentEditable?: boolean;
  attrs?: string[];
}

function fakeEvent(init: Partial<KeyboardEvent> & { key: string }, target: FakeTarget | null = { tagName: 'DIV' }) {
  const el =
    target === null
      ? null
      : {
          tagName: target.tagName,
          isContentEditable: target.isContentEditable ?? false,
          hasAttribute: (name: string) => (target.attrs ?? []).includes(name),
        };
  const e = {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    ...init,
    target: el,
    preventDefault: vi.fn(),
  };
  return e as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

describe('bindShortcuts', () => {
  it('calls the handler with the resolved action and prevents default', () => {
    const { win, dispatch } = fakeWindow();
    const handler = vi.fn();
    bindShortcuts(win, handler);
    const e = fakeEvent({ key: 'o', ctrlKey: true });
    dispatch(e);
    expect(handler).toHaveBeenCalledWith('open', e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no action resolves', () => {
    const { win, dispatch } = fakeWindow();
    const handler = vi.fn();
    bindShortcuts(win, handler);
    const e = fakeEvent({ key: 'x' });
    dispatch(e);
    expect(handler).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('treats input, textarea and contenteditable targets as text fields', () => {
    const { win, dispatch } = fakeWindow();
    const handler = vi.fn();
    bindShortcuts(win, handler);
    dispatch(fakeEvent({ key: ' ' }, { tagName: 'INPUT' }));
    dispatch(fakeEvent({ key: ' ' }, { tagName: 'TEXTAREA' }));
    dispatch(fakeEvent({ key: ' ' }, { tagName: 'DIV', isContentEditable: true }));
    expect(handler).not.toHaveBeenCalled();
    dispatch(fakeEvent({ key: 'f', ctrlKey: true }, { tagName: 'INPUT' }));
    expect(handler).toHaveBeenCalledWith('find', expect.anything());
  });

  it('recognises the find input through data-find-input', () => {
    const { win, dispatch } = fakeWindow();
    const handler = vi.fn();
    bindShortcuts(win, handler);
    const e = fakeEvent({ key: 'Enter' }, { tagName: 'INPUT', attrs: ['data-find-input'] });
    dispatch(e);
    expect(handler).toHaveBeenCalledWith('find-next', e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('ignores events with no element target and while an IME is composing', () => {
    const { win, dispatch } = fakeWindow();
    const handler = vi.fn();
    bindShortcuts(win, handler);
    dispatch(fakeEvent({ key: ' ' }, null));
    expect(handler).toHaveBeenCalledWith('scroll-down', expect.anything());
    handler.mockClear();
    dispatch(fakeEvent({ key: ' ', isComposing: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function that removes the listener', () => {
    const { win, dispatch, count } = fakeWindow();
    const handler = vi.fn();
    const unbind = bindShortcuts(win, handler);
    expect(count()).toBe(1);
    unbind();
    expect(count()).toBe(0);
    dispatch(fakeEvent({ key: 'o', ctrlKey: true }));
    expect(handler).not.toHaveBeenCalled();
  });
});
