import type { Commands } from '../commands';
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

let open: HTMLElement | null = null;

/**
 * Help › Keyboard Shortcuts: a Lion panel (grey title bar, red close button, #ececec body)
 * listing the shortcuts of the commands in the menus. Modal; Esc, Enter or the close button
 * closes it and focus returns where it was.
 */
export function showShortcuts(menus: readonly MenuSpec[], commands: Commands): void {
  if (open) return;
  const previousFocus = document.activeElement;
  const scrim = document.createElement('div');
  scrim.className = 'lion-scrim';
  const panel = document.createElement('div');
  panel.className = 'lion-panel ks-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'ks-title');
  panel.tabIndex = -1;

  const bar = document.createElement('div');
  bar.className = 'lion-titlebar';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'lion-close';
  closeButton.setAttribute('aria-label', 'Close');
  const heading = document.createElement('h2');
  heading.className = 'lion-title';
  heading.id = 'ks-title';
  heading.textContent = 'Keyboard Shortcuts';
  bar.append(closeButton, heading);

  const body = document.createElement('div');
  body.className = 'lion-panel-body';
  for (const section of shortcutSections(menus, commands)) {
    const sec = document.createElement('section');
    sec.className = 'ks-section';
    const h = document.createElement('h3');
    h.textContent = section.title;
    sec.append(h);
    for (const r of section.rows) {
      const row = document.createElement('div');
      row.className = 'ks-row';
      const label = document.createElement('span');
      label.className = 'ks-label';
      label.textContent = r.label;
      const key = document.createElement('kbd');
      key.textContent = r.shortcut;
      row.append(label, key);
      sec.append(row);
    }
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
