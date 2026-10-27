import type { Commands } from '../commands';
import { icons } from '../ui/icons';
import { SEPARATOR, type MenuSpec } from './menus';

export interface ShortcutSection {
  title: string;
  rows: { label: string; shortcut: string }[];
}

/**
 * The commands that have a shortcut, grouped by menu. A command named in several menus is listed
 * once, under the last: the application menu comes first and repeats commands (Close Window) that
 * people look for under File.
 */
export function shortcutSections(menus: readonly MenuSpec[], commands: Commands): ShortcutSection[] {
  const owner = new Map<string, MenuSpec>();
  for (const menu of menus) for (const id of menu.items) owner.set(id, menu);
  const seen = new Set<string>();
  const sections: ShortcutSection[] = [];
  for (const menu of menus) {
    const rows: ShortcutSection['rows'] = [];
    for (const id of menu.items) {
      const shortcut = id === SEPARATOR ? undefined : commands.get(id)?.shortcut;
      if (!shortcut || owner.get(id) !== menu || seen.has(id)) continue;
      seen.add(id);
      rows.push({ label: commands.label(id), shortcut });
    }
    if (rows.length > 0) sections.push({ title: menu.title, rows });
  }
  return sections;
}

/** The keys of a shortcut, one key cap each: 'Ctrl+Shift+S' → Ctrl, Shift, S; a '+' at the end is the key itself. */
export function shortcutKeys(shortcut: string): string[] {
  return shortcut.split(/\+(?=.)/);
}

let open: HTMLElement | null = null;

/**
 * Help › Keyboard Shortcuts: a panel in the alerts' look, with a close button at the top left,
 * listing the shortcuts of the commands in the menus as grouped lists with key caps. Modal; Esc,
 * Enter or the close button closes it and focus returns where it was.
 */
export function showShortcuts(menus: readonly MenuSpec[], commands: Commands): void {
  if (open) return;
  const previousFocus = document.activeElement;
  const scrim = document.createElement('div');
  scrim.className = 'ks-scrim';
  const panel = document.createElement('div');
  panel.className = 'ks-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'ks-title');
  panel.tabIndex = -1;

  const bar = document.createElement('div');
  bar.className = 'ks-titlebar';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'ks-close';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.innerHTML = icons.closeSmall;
  const heading = document.createElement('h2');
  heading.className = 'ks-title';
  heading.id = 'ks-title';
  heading.textContent = 'Keyboard Shortcuts';
  bar.append(closeButton, heading);

  const body = document.createElement('div');
  body.className = 'ks-body';
  for (const section of shortcutSections(menus, commands)) {
    const sec = document.createElement('section');
    sec.className = 'ks-section';
    const h = document.createElement('h3');
    h.textContent = section.title;
    const group = document.createElement('div');
    group.className = 'ks-group';
    for (const r of section.rows) {
      const row = document.createElement('div');
      row.className = 'ks-row';
      const label = document.createElement('span');
      label.className = 'ks-label';
      label.textContent = r.label;
      // A key combination: one key cap per key, joined by '+' (HTML's nested <kbd>).
      const keys = document.createElement('kbd');
      shortcutKeys(r.shortcut).forEach((k, i) => {
        const cap = document.createElement('kbd');
        cap.textContent = k;
        keys.append(...(i > 0 ? ['+', cap] : [cap]));
      });
      row.append(label, keys);
      group.append(row);
    }
    sec.append(h, group);
    body.append(sec);
  }
  panel.append(bar, body);
  scrim.append(panel);

  const close = () => {
    if (open !== scrim) return;
    open = null;
    window.removeEventListener('keydown', onKey, true);
    scrim.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  };
  // Modal: no key reaches the app, and none does its browser default (reload, print, page zoom).
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') close();
    else if (e.key === 'Tab') closeButton.focus();
  };
  closeButton.addEventListener('click', close);
  // Presses outside the panel neither reach the window nor take focus away.
  scrim.addEventListener('pointerdown', (e) => {
    if (!panel.contains(e.target as Node)) e.preventDefault();
  });
  scrim.addEventListener('mousedown', (e) => {
    if (!panel.contains(e.target as Node)) e.preventDefault();
  });

  open = scrim;
  document.body.append(scrim);
  window.addEventListener('keydown', onKey, true);
  panel.focus({ preventScroll: true });
}
