import type { Point } from '../platform/types';
import { icons } from './icons';

export type MenuItem =
  | { label: string; shortcut?: string; disabled?: boolean; checked?: boolean; radio?: boolean; action: () => void }
  | 'separator';

type Entry = Exclude<MenuItem, 'separator'>;

/** CSS px between an anchor and the menu below it. */
const ANCHOR_GAP = 4;
/** CSS px a menu keeps from the viewport edges. */
const EDGE = 6;
/** How long a click that closed an anchored menu may take to arrive and be swallowed. */
const SWALLOW_MS = 600;

let closeCurrent: (() => void) | null = null;

/** Closes the open menu, if any, without running an item. */
export function closeMenus(): void {
  closeCurrent?.();
}

const isRect = (at: DOMRect | Point): at is DOMRect => 'bottom' in at;

/**
 * Opens at `at` (anchor rect: below it, left-aligned; point: at it). Resolves when closed.
 * Mac-style: one menu at a time, keyboard modal while open, closes on outside click, Esc,
 * window blur or resize. An item's action runs after the menu has closed.
 */
export function showMenu(at: DOMRect | Point, items: MenuItem[], opts: { minWidth?: number } = {}): Promise<void> {
  closeMenus();
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;
    if (opts.minWidth) menu.style.minWidth = `${Math.round(opts.minWidth)}px`;

    const rows: { el: HTMLElement; item: Entry }[] = [];
    for (const item of items) {
      if (item === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'menu-separator';
        sep.setAttribute('role', 'separator');
        menu.append(sep);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'menu-item';
      el.tabIndex = -1;
      const role = item.radio ? 'menuitemradio' : item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem';
      el.setAttribute('role', role);
      if (role !== 'menuitem') el.setAttribute('aria-checked', String(!!item.checked));
      if (item.disabled) el.setAttribute('aria-disabled', 'true');
      const check = document.createElement('span');
      check.className = 'menu-check';
      if (item.checked) check.innerHTML = icons.checkmark;
      const label = document.createElement('span');
      label.className = 'menu-label';
      label.textContent = item.label;
      el.append(check, label);
      if (item.shortcut) {
        el.setAttribute('aria-keyshortcuts', item.shortcut);
        const key = document.createElement('span');
        key.className = 'menu-shortcut';
        key.setAttribute('aria-hidden', 'true');
        key.textContent = item.shortcut;
        el.append(key);
      }
      menu.append(el);
      rows.push({ el, item });
    }

    const enabled = () => rows.filter((r) => !r.item.disabled);
    const activeIndex = () => enabled().findIndex((r) => r.el === document.activeElement);
    const move = (delta: 1 | -1) => {
      const list = enabled();
      if (list.length === 0) return;
      const i = activeIndex();
      const next = i < 0 ? (delta === 1 ? 0 : list.length - 1) : (i + delta + list.length) % list.length;
      list[next]!.el.focus();
    };
    const jump = (ch: string) => {
      const list = enabled();
      const start = activeIndex();
      for (let k = 1; k <= list.length; k++) {
        const r = list[(start + k + list.length) % list.length]!;
        if (r.item.label.toLowerCase().startsWith(ch)) {
          r.el.focus();
          return;
        }
      }
    };

    let swallowTimer = 0;
    const swallowClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };

    const close = () => {
      if (closeCurrent !== close) return;
      closeCurrent = null;
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      const hadFocus = menu.contains(document.activeElement);
      menu.remove();
      if (hadFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      resolve();
    };

    const activate = (row: { item: Entry } | undefined) => {
      if (!row || row.item.disabled) return;
      close();
      row.item.action();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      e.stopPropagation();
      if (e.key === 'Tab' || e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
          move(1);
          break;
        case 'ArrowUp':
          move(-1);
          break;
        case 'Home':
          enabled()[0]?.el.focus();
          break;
        case 'End':
          enabled().at(-1)?.el.focus();
          break;
        case 'Enter':
        case ' ':
          activate(rows.find((r) => r.el === document.activeElement));
          break;
        case 'Escape':
          close();
          break;
        default:
          if (e.key.length === 1) jump(e.key.toLowerCase());
          else return;
      }
      e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (menu.contains(e.target as Node)) return;
      // A press on the button that opened the menu closes it; swallow the click so it does not reopen.
      if (isRect(at) && e.clientX >= at.left && e.clientX <= at.right && e.clientY >= at.top && e.clientY <= at.bottom) {
        window.addEventListener('click', swallowClick, { capture: true, once: true });
        clearTimeout(swallowTimer);
        swallowTimer = window.setTimeout(() => window.removeEventListener('click', swallowClick, true), SWALLOW_MS);
      }
      close();
    };

    menu.addEventListener('mousemove', (e) => {
      const row = rows.find((r) => r.el.contains(e.target as Node));
      if (row && !row.item.disabled && document.activeElement !== row.el) row.el.focus({ preventScroll: true });
    });
    menu.addEventListener('mouseleave', () => {
      if (menu.contains(document.activeElement)) menu.focus({ preventScroll: true });
    });
    menu.addEventListener('click', (e) => activate(rows.find((r) => r.el.contains(e.target as Node))));
    menu.addEventListener('contextmenu', (e) => e.preventDefault());

    menu.style.visibility = 'hidden';
    document.body.append(menu);
    place(menu, at);
    menu.style.visibility = '';

    closeCurrent = close;
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    menu.focus({ preventScroll: true });
  });
}

/** Positions `menu` at `at`, flipping or shifting it so it stays inside the viewport. */
function place(menu: HTMLElement, at: DOMRect | Point): void {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  menu.style.maxHeight = `${vh - EDGE * 2}px`;
  const { width, height } = menu.getBoundingClientRect();
  let x: number;
  let y: number;
  if (isRect(at)) {
    x = at.left;
    y = at.bottom + ANCHOR_GAP;
    if (y + height > vh - EDGE && at.top - ANCHOR_GAP - height >= EDGE) y = at.top - ANCHOR_GAP - height;
  } else {
    x = at.x;
    y = at.y;
    if (y + height > vh - EDGE) y = at.y - height;
    if (x + width > vw - EDGE) x = at.x - width;
  }
  x = Math.min(Math.max(EDGE, x), vw - EDGE - width);
  y = Math.min(Math.max(EDGE, y), vh - EDGE - height);
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
}
