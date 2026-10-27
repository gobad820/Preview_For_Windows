import type { Commands } from '../commands';
import type { Store, ViewerState } from '../store';
import { icons } from '../ui/icons';
import { closeMenus } from '../ui/menu';
import { AltTap } from './keys';
import { MENUS, SEPARATOR, menuForKey, menuItems, type MenuRow, type MenuSpec } from './menus';

/** Open dialogs and other menus: the menu bar does not open over them. */
const MODAL = '[role="dialog"], [role="alertdialog"], [role="menu"]:not(.mb-menu)';
/** CSS px a drop-down keeps from the bottom of the window. */
const EDGE = 6;
/** The rest of a mouse press that closed a menu or ran an item; it must not reach the document. */
const SWALLOWED = ['mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu'] as const;

type Select = 'none' | 'first' | 'last';

/**
 * The in-window menu bar, Mac OS X Lion style. Mac behaviour with the mouse (press a title to
 * open, slide across titles to switch, press elsewhere or Esc to close, press-drag-release
 * runs an item); Windows behaviour from the keyboard (Alt or F10 focuses the bar, Alt+letter
 * opens a menu, arrows move, Enter runs, Esc steps back). Keyboard focus and selections stay
 * where they were: the bar highlights its titles and items itself.
 */
export class MenuBar {
  private readonly titles: HTMLElement[] = [];
  private readonly tap = new AltTap();
  /** The menu whose title is highlighted (its drop-down is open, or the keyboard is on it); -1 when idle. */
  private current = -1;
  private drop: HTMLElement | null = null;
  private rows: { el: HTMLElement; row: MenuRow }[] = [];
  private active = -1;
  /** Entered from the keyboard: access keys are underlined and Esc steps back to the bar. */
  private keyboard = false;
  private altHeld = false;
  private swallowing = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly commands: Commands,
    private readonly store: Store<ViewerState>,
    readonly menus: readonly MenuSpec[] = MENUS,
  ) {
    host.setAttribute('data-tauri-drag-region', '');
    const strip = document.createElement('div');
    strip.className = 'mb-titles';
    strip.setAttribute('role', 'menubar');
    menus.forEach((m, i) => strip.append(this.title(m, i)));
    const flex = document.createElement('div');
    flex.className = 'mb-flex';
    flex.setAttribute('data-tauri-drag-region', '');
    host.replaceChildren(strip, flex);

    // Registered before any menu or dialog opens, so these see keys first.
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    for (const type of SWALLOWED) window.addEventListener(type, this.onSwallow, true);
    window.addEventListener('blur', () => {
      this.tap.reset();
      this.altHeld = false;
      this.swallowing = false;
      this.close();
    });
    window.addEventListener('resize', () => {
      if (this.drop) this.close();
    });
    store.select('menuBarVisible', () => this.syncHidden());
  }

  // ---- titles -----------------------------------------------------------------

  private title(m: MenuSpec, i: number): HTMLElement {
    const t = document.createElement('span');
    t.className = m.app ? 'mb-title mb-app' : 'mb-title';
    t.id = `mb-title-${i}`;
    t.setAttribute('role', 'menuitem');
    t.setAttribute('aria-haspopup', 'menu');
    t.setAttribute('aria-expanded', 'false');
    t.setAttribute('aria-keyshortcuts', `Alt+${m.key.toUpperCase()}`);
    const at = m.title.toLowerCase().indexOf(m.key);
    const key = document.createElement('span');
    key.className = 'mb-key';
    key.textContent = m.title.charAt(at);
    t.append(m.title.slice(0, at), key, m.title.slice(at + 1));
    t.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (this.drop && this.current === i) this.close();
      else {
        this.keyboard = false;
        this.open(i, 'none');
      }
    });
    // No focus change, no text selection: what was selected stays selected for Copy.
    t.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    t.addEventListener('pointerenter', () => {
      if (this.drop && this.current !== i) this.open(i, 'none');
    });
    this.titles.push(t);
    return t;
  }

  private sync(): void {
    this.titles.forEach((t, i) => {
      const on = i === this.current;
      t.classList.toggle('open', on && !!this.drop);
      t.classList.toggle('focused', on && !this.drop);
      t.setAttribute('aria-expanded', String(on && !!this.drop));
    });
    this.host.classList.toggle('keys', this.keyboard || this.altHeld);
    this.syncHidden();
  }

  /** Hidden by View › Menu Bar, except while it is in use. */
  private syncHidden(): void {
    this.host.hidden = !this.store.get().menuBarVisible && this.current < 0;
  }

  // ---- open and close -----------------------------------------------------------

  /** Highlights title `i` for the keyboard without opening it. */
  private focusBar(i: number): void {
    closeMenus();
    this.removeDrop();
    this.keyboard = true;
    this.current = i;
    this.sync();
  }

  private open(i: number, select: Select): void {
    closeMenus();
    this.removeDrop();
    this.current = i;
    this.sync();
    const drop = this.build(this.menus[i]!);
    drop.setAttribute('aria-labelledby', this.titles[i]!.id);
    drop.style.visibility = 'hidden';
    document.body.append(drop);
    this.drop = drop;
    this.place(drop, this.titles[i]!);
    drop.style.visibility = '';
    this.sync();
    if (select === 'first') this.move(1);
    else if (select === 'last') this.move(-1);
  }

  private removeDrop(): void {
    this.drop?.remove();
    this.drop = null;
    this.rows = [];
    this.active = -1;
  }

  /** Back to idle: no menu, no highlighted title. */
  close(): void {
    if (this.current < 0 && !this.drop) return;
    this.removeDrop();
    this.current = -1;
    this.keyboard = false;
    this.sync();
  }

  private run(index: number): void {
    const r = this.rows[index];
    if (!r?.row.enabled) return;
    this.close();
    this.commands.run(r.row.id);
  }

  // ---- drop-down ----------------------------------------------------------------

  /** The menu's rows, with labels and state read from the commands now. */
  private build(spec: MenuSpec): HTMLElement {
    const drop = document.createElement('div');
    drop.className = 'mb-menu';
    drop.setAttribute('role', 'menu');
    drop.setAttribute('aria-label', spec.title);
    for (const entry of menuItems(spec, this.commands)) {
      if (entry === SEPARATOR) {
        const sep = document.createElement('div');
        sep.className = 'mb-separator';
        sep.setAttribute('role', 'separator');
        drop.append(sep);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'mb-item';
      el.dataset['command'] = entry.id;
      const role = entry.radio ? 'menuitemradio' : entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem';
      el.setAttribute('role', role);
      if (role !== 'menuitem') el.setAttribute('aria-checked', String(!!entry.checked));
      if (!entry.enabled) el.setAttribute('aria-disabled', 'true');
      const check = document.createElement('span');
      check.className = 'mb-check';
      check.setAttribute('aria-hidden', 'true');
      if (entry.checked) check.innerHTML = icons.checkmark;
      const label = document.createElement('span');
      label.className = 'mb-label';
      label.textContent = entry.label;
      el.append(check, label);
      if (entry.shortcut) {
        el.setAttribute('aria-keyshortcuts', entry.shortcut);
        const key = document.createElement('span');
        key.className = 'mb-shortcut';
        key.setAttribute('aria-hidden', 'true');
        key.textContent = entry.shortcut;
        el.append(key);
      }
      drop.append(el);
      this.rows.push({ el, row: entry });
    }

    const rowAt = (target: EventTarget | null) => this.rows.findIndex((r) => r.el.contains(target as Node));
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click'] as const) {
      drop.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'mousedown') e.preventDefault();
      });
    }
    drop.addEventListener('mousemove', (e) => {
      const i = rowAt(e.target);
      this.setActive(i >= 0 && this.rows[i]!.row.enabled ? i : -1);
    });
    drop.addEventListener('mouseleave', () => this.setActive(-1));
    // Release, not click: a press on the title can slide down and release on an item.
    drop.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const i = rowAt(e.target);
      if (i < 0 || !this.rows[i]!.row.enabled) return;
      this.swallowRest(true);
      this.run(i);
    });
    drop.addEventListener('contextmenu', (e) => e.preventDefault());
    return drop;
  }

  /** Square top on the bar's bottom edge, left edge under the title, inside the window. */
  private place(drop: HTMLElement, title: HTMLElement): void {
    const top = this.host.getBoundingClientRect().bottom;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    drop.style.maxHeight = `${Math.max(0, vh - top - EDGE)}px`;
    const width = drop.getBoundingClientRect().width;
    const left = Math.max(0, Math.min(title.getBoundingClientRect().left, vw - width));
    drop.style.left = `${Math.round(left)}px`;
    drop.style.top = `${Math.round(top)}px`;
  }

  private setActive(i: number): void {
    if (i === this.active) return;
    this.rows[this.active]?.el.classList.remove('active');
    this.active = i;
    const el = this.rows[i]?.el;
    el?.classList.add('active');
    el?.scrollIntoView({ block: 'nearest' });
  }

  /** Next (1) or previous (-1) enabled row, wrapping; from nothing, the first or last. */
  private move(delta: 1 | -1): void {
    const n = this.rows.length;
    for (let k = 1; k <= n; k++) {
      const i = (((this.active < 0 ? (delta === 1 ? -1 : n) : this.active) + delta * k) % n + n) % n;
      if (this.rows[i]!.row.enabled) {
        this.setActive(i);
        return;
      }
    }
  }

  /** Type-select: the next enabled row whose label starts with `ch`. */
  private jump(ch: string): void {
    const n = this.rows.length;
    for (let k = 1; k <= n; k++) {
      const i = (Math.max(this.active, -1) + k + n) % n;
      const r = this.rows[i]!;
      if (r.row.enabled && r.row.label.toLowerCase().startsWith(ch)) {
        this.setActive(i);
        return;
      }
    }
  }

  // ---- keyboard -------------------------------------------------------------------

  private blocked(): boolean {
    return document.querySelector(MODAL) !== null;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.tap.feed('down', e);
    if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && e.code !== 'AltRight') {
      this.altHeld = true;
      this.sync();
    }
    if (this.current < 0) {
      this.idleKey(e);
      return;
    }
    // In use: every key belongs to the menu bar, none reaches the document, find bar or markup.
    e.stopPropagation();
    if (e.isComposing || ['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    const n = this.menus.length;
    switch (e.key) {
      case 'Escape':
        if (this.drop && this.keyboard) this.focusBar(this.current);
        else this.close();
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const next = (this.current + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
        if (this.drop) this.open(next, 'first');
        else this.focusBar(next);
        return;
      }
      case 'ArrowDown':
      case 'ArrowUp':
        if (this.drop) this.move(e.key === 'ArrowDown' ? 1 : -1);
        else this.open(this.current, e.key === 'ArrowDown' ? 'first' : 'last');
        return;
      case 'Home':
      case 'End':
        if (this.drop) {
          this.active = -1;
          this.move(e.key === 'Home' ? 1 : -1);
        }
        return;
      case 'Enter':
      case ' ':
        if (!this.drop) this.open(this.current, 'first');
        else if (this.active >= 0) this.run(this.active);
        else this.close();
        return;
      case 'F10':
        this.close();
        return;
    }
    if (!this.drop || e.altKey) {
      const i = menuForKey(this.menus, e);
      if (i >= 0) {
        this.keyboard = true;
        this.open(i, 'first');
      }
    } else if (e.key.length === 1) {
      this.jump(e.key.toLowerCase());
    }
  };

  /** Idle: Alt+letter and F10 enter the menu bar (Alt alone does, on release). */
  private idleKey(e: KeyboardEvent): void {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.shiftKey || this.blocked()) return;
    if (e.key === 'F10' && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      this.focusBar(0);
      return;
    }
    if (!e.altKey || e.repeat) return;
    const i = menuForKey(this.menus, e);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.keyboard = true;
    this.open(i, 'first');
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const tapped = this.tap.feed('up', e);
    if (e.key === 'Alt' && this.altHeld) {
      this.altHeld = false;
      this.sync();
    }
    if (this.current >= 0) e.stopPropagation();
    if (!tapped || (this.current < 0 && this.blocked())) return;
    // Handled here, so the host window does not enter its own menu mode.
    e.preventDefault();
    if (this.current >= 0) this.close();
    else this.focusBar(0);
  };

  // ---- mouse --------------------------------------------------------------------

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.tap.reset();
    if (this.current < 0) return;
    const t = e.target as Node;
    if (this.titles.some((x) => x.contains(t)) || this.drop?.contains(t)) return;
    const hadDrop = !!this.drop;
    this.close();
    // A press that closes an open menu does nothing else, as on the Mac.
    if (hadDrop) {
      e.stopPropagation();
      this.swallowRest();
    }
  };

  /** Swallows the mouse events still to come from the current press (called during its pointerup: just mouseup and click). */
  private swallowRest(released = false): void {
    this.swallowing = true;
    if (released) window.setTimeout(() => (this.swallowing = false));
  }

  private readonly onSwallow = (e: Event): void => {
    if (!this.swallowing) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.type === 'pointerup') window.setTimeout(() => (this.swallowing = false));
  };
}
