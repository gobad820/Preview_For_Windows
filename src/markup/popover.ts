/**
 * Small anchored popovers for the markup toolbar's color and text style controls, in the
 * same material as menus. One at a time; closes on an outside press, Esc, window blur or resize.
 */
import { closeMenus } from '../ui/menu';
import { PALETTE, type NamedColor } from './state';
import type { Color } from '../annot/types';

const GAP = 6;
const EDGE = 6;
const COLUMNS = 6;

let closeCurrent: (() => void) | null = null;

export function closePopovers(): void {
  closeCurrent?.();
}

/**
 * Shows `content` below `anchor` (the button). Resolves when closed. `build` gets a `close`
 * function for controls that finish the interaction.
 */
export function showPopover(anchor: HTMLElement, build: (close: () => void) => HTMLElement, label: string): Promise<void> {
  closeMenus();
  closePopovers();
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const pop = document.createElement('div');
    pop.className = 'markup-palette';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', label);
    pop.tabIndex = -1;
    anchor.setAttribute('aria-expanded', 'true');

    const close = () => {
      if (closeCurrent !== close) return;
      closeCurrent = null;
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      anchor.setAttribute('aria-expanded', 'false');
      const hadFocus = pop.contains(document.activeElement);
      pop.remove();
      if (hadFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      resolve();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      const grid = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.palette-grid');
      if (grid && pop.contains(grid) && moveInGrid(grid, e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (pop.contains(target)) return;
      if (anchor.contains(target)) {
        // The anchor's own click would reopen it: swallow that click.
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 600);
      }
      close();
    };
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };

    pop.append(build(close));
    pop.addEventListener('contextmenu', (e) => e.preventDefault());
    pop.style.visibility = 'hidden';
    document.body.append(pop);
    place(pop, anchor.getBoundingClientRect());
    pop.style.visibility = '';

    closeCurrent = close;
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    const first = pop.querySelector<HTMLElement>('[aria-checked="true"]') ?? pop.querySelector<HTMLElement>('button');
    (first ?? pop).focus({ preventScroll: true });
  });
}

/** A grid of color swatches; `current` gets a ring. */
export function colorGrid(current: Color | null, pick: (c: Color) => void, colors: readonly NamedColor[] = PALETTE): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'palette-grid';
  grid.setAttribute('role', 'radiogroup');
  grid.style.setProperty('--columns', String(COLUMNS));
  for (const { name, color } of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'palette-swatch';
    b.dataset['color'] = color;
    b.title = name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', name);
    b.setAttribute('aria-checked', String(current !== null && current.toLowerCase() === color));
    b.tabIndex = -1;
    b.style.setProperty('--swatch', color);
    b.addEventListener('click', () => pick(color));
    grid.append(b);
  }
  return grid;
}

function moveInGrid(grid: HTMLElement, key: string): boolean {
  const cells = Array.from(grid.querySelectorAll<HTMLElement>('button'));
  const i = cells.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return false;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[key];
  if (step === undefined) return false;
  const next = cells[Math.min(cells.length - 1, Math.max(0, i + step))];
  next?.focus({ preventScroll: true });
  return true;
}

function place(pop: HTMLElement, at: DOMRect): void {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const { width, height } = pop.getBoundingClientRect();
  let x = at.left + at.width / 2 - width / 2;
  let y = at.bottom + GAP;
  if (y + height > vh - EDGE && at.top - GAP - height >= EDGE) y = at.top - GAP - height;
  x = Math.min(Math.max(EDGE, x), vw - EDGE - width);
  y = Math.min(Math.max(EDGE, y), vh - EDGE - height);
  pop.style.left = `${Math.round(x)}px`;
  pop.style.top = `${Math.round(y)}px`;
}
