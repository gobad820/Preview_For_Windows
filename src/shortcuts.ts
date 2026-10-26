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
  | 'scroll-up'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'close-window'
  | 'select-all-pages'
  | 'copy-pages'
  | 'cut-pages'
  | 'paste-pages'
  | 'delete-pages';

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
  /** Focus is inside the sidebar (`#sidebar`), which edits pages. */
  inSidebar: boolean;
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
  // Text fields keep their own undo, redo, paste and selection.
  const pages = k.inSidebar && !k.inTextField;
  if (k.shiftKey) {
    if (ch === 'l') return 'rotate-ccw';
    if (ch === 's') return 'save-as';
    if (ch === 'z') return k.inTextField ? null : 'redo';
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
    case 's': return 'save';
    case 'w': return 'close-window';
    case 'z': return k.inTextField ? null : 'undo';
    case 'y': return k.inTextField ? null : 'redo';
    case 'v': return k.inTextField ? null : 'paste-pages';
    case 'a': return pages ? 'select-all-pages' : null;
    case 'c': return pages ? 'copy-pages' : null;
    case 'x': return pages ? 'cut-pages' : null;
    default: return null;
  }
}

/** Ctrl+Alt+S toggles the sidebar; other Alt combos are left alone. Not in text fields, where Ctrl+Alt is AltGr. */
function resolveCtrlAlt(k: KeyLike): Action | null {
  return !k.shiftKey && !k.inTextField && keyChar(k) === 's' ? 'toggle-sidebar' : null;
}

export function resolveShortcut(k: KeyLike): Action | null {
  if (k.metaKey) return null;
  if (k.altKey) return k.ctrlKey ? resolveCtrlAlt(k) : null;
  if (k.ctrlKey) return resolveCtrl(k);
  if (k.key === 'Escape') return k.findFocused || !k.inTextField ? 'close-find' : null;
  if (k.key === 'Enter') return k.findFocused ? (k.shiftKey ? 'find-prev' : 'find-next') : null;
  if (k.inTextField || k.findFocused) return null;
  if (k.key === ' ') return k.shiftKey ? 'scroll-up' : 'scroll-down';
  if (k.shiftKey) return null;
  if (k.inSidebar) {
    // The sidebar moves its selection with arrows, Home and End itself.
    switch (k.key) {
      case 'Delete':
      case 'Backspace':
        return 'delete-pages';
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End':
        return null;
    }
  }
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
  closest?: (selector: string) => unknown;
}

function isTextField(el: ElementLike | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function isFindInput(el: ElementLike | null): boolean {
  return typeof el?.hasAttribute === 'function' && el.hasAttribute('data-find-input');
}

function isInSidebar(el: ElementLike | null): boolean {
  // Only the thumbnail list edits pages; the Contents tab and the tab strip do not.
  return typeof el?.closest === 'function' && el.closest('#sidebar [role="listbox"]') != null;
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
    inSidebar: isInSidebar(el),
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
