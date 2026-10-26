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
    inSidebar: false,
    ...mods,
  };
}

const ctrl = (k: string, mods: Partial<KeyLike> = {}): KeyLike => key(k, { ctrlKey: true, ...mods });
const inField = (k: string, mods: Partial<KeyLike> = {}): KeyLike => key(k, { inTextField: true, ...mods });
const inFind = (k: string, mods: Partial<KeyLike> = {}): KeyLike =>
  key(k, { inTextField: true, findFocused: true, ...mods });
const inSidebar = (k: string, mods: Partial<KeyLike> = {}): KeyLike => key(k, { inSidebar: true, ...mods });

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
    ['Ctrl+S → save', ctrl('s'), 'save'],
    ['Ctrl+Shift+S → save-as', ctrl('S', { shiftKey: true }), 'save-as'],
    ['Ctrl+Alt+S → toggle-sidebar', ctrl('s', { altKey: true }), 'toggle-sidebar'],
    ['Ctrl+Alt+S with a Korean IME key value resolves via code', ctrl('ㄴ', { code: 'KeyS', altKey: true }), 'toggle-sidebar'],
    ['Ctrl+Alt+Shift+S → null', ctrl('S', { altKey: true, shiftKey: true }), null],
    ['Alt+S → null', key('s', { altKey: true }), null],
    ['Ctrl+Z → undo', ctrl('z'), 'undo'],
    ['Ctrl+Z with a Korean IME key value resolves via code', ctrl('ㅋ', { code: 'KeyZ' }), 'undo'],
    ['Ctrl+Y → redo', ctrl('y'), 'redo'],
    ['Ctrl+Shift+Z → redo', ctrl('Z', { shiftKey: true }), 'redo'],
    ['Ctrl+Shift+Y → null', ctrl('Y', { shiftKey: true }), null],
    ['Ctrl+W → close-window', ctrl('w'), 'close-window'],
    ['Ctrl+V → paste-pages', ctrl('v'), 'paste-pages'],
    ['Ctrl+A outside the sidebar → null', ctrl('a'), null],
    ['Ctrl+C outside the sidebar → null', ctrl('c'), null],
    ['Ctrl+X outside the sidebar → null', ctrl('x'), null],
    ['Delete outside the sidebar → delete-annotation', key('Delete'), 'delete-annotation'],
    ['Backspace outside the sidebar → delete-annotation', key('Backspace'), 'delete-annotation'],
    ['Delete in a text field → null', inField('Delete'), null],
    ['Backspace in a text field → null', inField('Backspace'), null],
    ['Backspace in find → null', inFind('Backspace'), null],
    ['Shift+Delete outside the sidebar → null', key('Delete', { shiftKey: true }), null],
    ['Ctrl+Shift+A → toggle-markup', ctrl('A', { shiftKey: true }), 'toggle-markup'],
    ['Ctrl+Shift+A with a Korean IME key value resolves via code', ctrl('ㅁ', { shiftKey: true, code: 'KeyA' }), 'toggle-markup'],
    ['Ctrl+Shift+A in a text field → toggle-markup', inField('A', { ctrlKey: true, shiftKey: true }), 'toggle-markup'],
    ['Ctrl+Shift+A in the sidebar → toggle-markup', inSidebar('A', { ctrlKey: true, shiftKey: true }), 'toggle-markup'],
    ['Ctrl+D → duplicate-annotation', ctrl('d'), 'duplicate-annotation'],
    ['Ctrl+D with a Korean IME key value resolves via code', ctrl('ㅇ', { code: 'KeyD' }), 'duplicate-annotation'],
    ['Ctrl+D in a text field → null', inField('d', { ctrlKey: true }), null],
    ['Ctrl+D in find → null', inFind('d', { ctrlKey: true }), null],
    ['Ctrl+Shift+D → null', ctrl('D', { shiftKey: true }), null],
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
    ['Ctrl+S in a text field → save', inField('s', { ctrlKey: true }), 'save'],
    ['Ctrl+Shift+S in a text field → save-as', inField('S', { ctrlKey: true, shiftKey: true }), 'save-as'],
    ['Ctrl+W in a text field → close-window', inField('w', { ctrlKey: true }), 'close-window'],
    ['Ctrl+Z in a text field → null', inField('z', { ctrlKey: true }), null],
    ['Ctrl+Y in a text field → null', inField('y', { ctrlKey: true }), null],
    ['Ctrl+Shift+Z in a text field → null', inField('Z', { ctrlKey: true, shiftKey: true }), null],
    ['Ctrl+V in a text field → null', inField('v', { ctrlKey: true }), null],
    ['Ctrl+Alt+S in a text field (AltGr) → null', inField('s', { ctrlKey: true, altKey: true }), null],
    ['Escape in a text field → null', inField('Escape'), null],
    ['Enter in find → find-next', inFind('Enter'), 'find-next'],
    ['Shift+Enter in find → find-prev', inFind('Enter', { shiftKey: true }), 'find-prev'],
    ['Escape in find → close-find', inFind('Escape'), 'close-find'],
    ['Space in find → null', inFind(' '), null],
    ['Ctrl+F in find → find', inFind('f', { ctrlKey: true }), 'find'],
    ['Ctrl+Z in find → null', inFind('z', { ctrlKey: true }), null],
    ['Ctrl+V in find → null', inFind('v', { ctrlKey: true }), null],
    ['Ctrl+A in the sidebar → select-all-pages', inSidebar('a', { ctrlKey: true }), 'select-all-pages'],
    ['Ctrl+C in the sidebar → copy-pages', inSidebar('c', { ctrlKey: true }), 'copy-pages'],
    ['Ctrl+X in the sidebar → cut-pages', inSidebar('x', { ctrlKey: true }), 'cut-pages'],
    ['Ctrl+V in the sidebar → paste-pages', inSidebar('v', { ctrlKey: true }), 'paste-pages'],
    ['Ctrl+C in the sidebar with a Korean IME key value resolves via code', inSidebar('ㅊ', { ctrlKey: true, code: 'KeyC' }), 'copy-pages'],
    ['Ctrl+Shift+C in the sidebar → null', inSidebar('C', { ctrlKey: true, shiftKey: true }), null],
    ['Ctrl+Z in the sidebar → undo', inSidebar('z', { ctrlKey: true }), 'undo'],
    ['Ctrl+Alt+S in the sidebar → toggle-sidebar', inSidebar('s', { ctrlKey: true, altKey: true }), 'toggle-sidebar'],
    ['Ctrl+A in a text field in the sidebar → null', inSidebar('a', { ctrlKey: true, inTextField: true }), null],
    ['Ctrl+C in a text field in the sidebar → null', inSidebar('c', { ctrlKey: true, inTextField: true }), null],
    ['Delete in the sidebar → delete-pages', inSidebar('Delete'), 'delete-pages'],
    ['Backspace in the sidebar → delete-pages', inSidebar('Backspace'), 'delete-pages'],
    ['Shift+Delete in the sidebar → null', inSidebar('Delete', { shiftKey: true }), null],
    ['Ctrl+Delete in the sidebar → null', inSidebar('Delete', { ctrlKey: true }), null],
    ['Delete in a text field in the sidebar → null', inSidebar('Delete', { inTextField: true }), null],
    ['ArrowDown in the sidebar → null', inSidebar('ArrowDown'), null],
    ['ArrowUp in the sidebar → null', inSidebar('ArrowUp'), null],
    ['ArrowRight in the sidebar → null', inSidebar('ArrowRight'), null],
    ['ArrowLeft in the sidebar → null', inSidebar('ArrowLeft'), null],
    ['Shift+ArrowDown in the sidebar → null', inSidebar('ArrowDown', { shiftKey: true }), null],
    ['Home in the sidebar → null', inSidebar('Home'), null],
    ['End in the sidebar → null', inSidebar('End'), null],
    ['Space in the sidebar → scroll-down', inSidebar(' '), 'scroll-down'],
    ['PageDown in the sidebar → scroll-down', inSidebar('PageDown'), 'scroll-down'],
    ['Escape in the sidebar → close-find', inSidebar('Escape'), 'close-find'],
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
  /** Ancestors matched by `closest`, e.g. '#sidebar'. */
  within?: string[];
}

function fakeEvent(init: Partial<KeyboardEvent> & { key: string }, target: FakeTarget | null = { tagName: 'DIV' }) {
  const el =
    target === null
      ? null
      : {
          tagName: target.tagName,
          isContentEditable: target.isContentEditable ?? false,
          hasAttribute: (name: string) => (target.attrs ?? []).includes(name),
          closest: (selector: string) => ((target.within ?? []).includes(selector) ? {} : null),
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
  it('Delete deletes pages in the thumbnail list and the selected annotation elsewhere', () => {
    const { win, dispatch } = fakeWindow();
    const handler = vi.fn();
    bindShortcuts(win, handler);
    dispatch(fakeEvent({ key: 'Delete' }, { tagName: 'DIV', within: ['#sidebar [role="listbox"]'] }));
    dispatch(fakeEvent({ key: 'Delete' }, { tagName: 'MAIN' }));
    dispatch(fakeEvent({ key: 'Backspace' }, { tagName: 'TEXTAREA' }));
    expect(handler.mock.calls.map((c) => c[0])).toEqual(['delete-pages', 'delete-annotation']);
  });

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

  it('treats only the thumbnail list as the page editor', () => {
    const { win, dispatch } = fakeWindow();
    const handler = vi.fn();
    bindShortcuts(win, handler);
    dispatch(fakeEvent({ key: 'Delete' }, { tagName: 'DIV' }));
    // The Contents tab and the tab strip are in #sidebar but must not delete pages.
    dispatch(fakeEvent({ key: 'Delete' }, { tagName: 'BUTTON', within: ['#sidebar'] }));
    expect(handler.mock.calls.map((c) => c[0])).toEqual(['delete-annotation', 'delete-annotation']);
    const e = fakeEvent({ key: 'Delete' }, { tagName: 'DIV', within: ['#sidebar', '#sidebar [role="listbox"]'] });
    dispatch(e);
    expect(handler).toHaveBeenCalledWith('delete-pages', e);
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
