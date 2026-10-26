/**
 * Keyboard shortcut resolution. `resolveShortcut` is pure; `bindShortcuts`
 * adapts DOM keydown events to it.
 */

export type Action =
  | 'open'
  | 'find'
  | 'find-next'
  | 'find-prev'
  | 'close-find'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-100'
  | 'fit-width'
  | 'fit-page'
  | 'rotate-cw'
  | 'rotate-ccw'
  | 'toggle-sidebar'
  | 'goto-page'
  | 'next-page'
  | 'prev-page'
  | 'first-page'
  | 'last-page'
  | 'scroll-down'
  | 'scroll-up';

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** Focus is in an input, textarea or contenteditable element. */
  inTextField: boolean;
  /** Focus is in the find bar's text input. */
  findFocused: boolean;
}

/**
 * Letter or digit identifying the pressed key, independent of Shift and of
 * the active keyboard layout (an IME may report e.g. 'ㅣ' for the L key).
 */
function keyChar(k: KeyLike): string | null {
  if (/^[a-z0-9]$/i.test(k.key)) return k.key.toLowerCase();
  const m = /^(?:Key|Digit)([A-Z0-9])$/.exec(k.code ?? '');
  return m && m[1] ? m[1].toLowerCase() : null;
}

function resolveCtrl(k: KeyLike): Action | null {
  if (k.key === '=' || k.key === '+' || k.code === 'NumpadAdd') return 'zoom-in';
  if (k.key === '-' || k.code === 'NumpadSubtract') return 'zoom-out';
  const ch = keyChar(k);
  if (k.shiftKey) {
    if (ch === 'l') return 'rotate-ccw';
    if (ch === 's') return 'toggle-sidebar';
    return null;
  }
  switch (ch) {
    case 'o': return 'open';
    case 'f': return 'find';
    case 'g': return 'goto-page';
    case 'l': return 'rotate-cw';
    case '0': return 'zoom-100';
    case '1': return 'fit-width';
    case '2': return 'fit-page';
    default: return null;
  }
}

export function resolveShortcut(k: KeyLike): Action | null {
  if (k.altKey || k.metaKey) return null;
  if (k.ctrlKey) return resolveCtrl(k);
  if (k.key === 'Escape') return 'close-find';
  if (k.key === 'Enter') return k.findFocused ? (k.shiftKey ? 'find-prev' : 'find-next') : null;
  if (k.inTextField || k.findFocused) return null;
  if (k.key === ' ') return k.shiftKey ? 'scroll-up' : 'scroll-down';
  if (k.shiftKey) return null;
  switch (k.key) {
    case 'PageDown': return 'scroll-down';
    case 'PageUp': return 'scroll-up';
    case 'Home': return 'first-page';
    case 'End': return 'last-page';
    case 'ArrowRight': return 'next-page';
    case 'ArrowLeft': return 'prev-page';
    default: return null;
  }
}

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  hasAttribute?: (name: string) => boolean;
}

function isTextField(el: ElementLike | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function isFindInput(el: ElementLike | null): boolean {
  return typeof el?.hasAttribute === 'function' && el.hasAttribute('data-find-input');
}

export function keyLikeFromEvent(e: KeyboardEvent): KeyLike {
  const el = (e.target ?? null) as ElementLike | null;
  return {
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    inTextField: isTextField(el),
    findFocused: isFindInput(el),
  };
}

/** Listens for keydown on `target`; calls `handler` (and prevents default) only when an action resolves. */
export function bindShortcuts(target: Window, handler: (a: Action, e: KeyboardEvent) => void): () => void {
  const listener = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const action = resolveShortcut(keyLikeFromEvent(e));
    if (action === null) return;
    e.preventDefault();
    handler(action, e);
  };
  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
}
