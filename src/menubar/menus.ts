import type { Commands } from '../commands';

/** Marks a separator line between groups of items. */
export const SEPARATOR = '-';

/** One menu of the in-window menu bar. Adding a feature: register a command, name its id here. */
export interface MenuSpec {
  readonly title: string;
  /** The underlined letter: Alt+key opens the menu. Lowercase, a letter of the title. */
  readonly key: string;
  /** The application menu, shown in bold. */
  readonly app?: boolean;
  /** Command ids (`src/app.ts` registers them) and separators, top to bottom. */
  readonly items: readonly string[];
}

const _ = SEPARATOR;

/** Mac OS X Lion Preview's menus, with Windows access keys. */
export const MENUS: readonly MenuSpec[] = [
  { title: 'Preview', key: 'p', app: true, items: ['app.about', _, 'app.preferences', _, 'file.close'] },
  { title: 'File', key: 'f', items: ['file.open', _, 'file.close', 'file.save', 'file.saveAs', _, 'file.print'] },
  {
    title: 'Edit',
    key: 'e',
    items: [
      'edit.undo', 'edit.redo', _,
      'edit.cut', 'edit.copy', 'edit.paste', 'edit.delete', 'edit.duplicate', 'edit.selectAll', _,
      'file.insertPages', _,
      'edit.find',
    ],
  },
  {
    title: 'View',
    key: 'v',
    items: [
      'view.sidebar', 'view.thumbnails', 'view.outline', _,
      'view.continuous', 'view.twoPages', 'view.bookMode', _,
      'view.actualSize', 'view.fitWidth', 'view.fitPage', 'view.zoomIn', 'view.zoomOut', _,
      'view.markupToolbar', 'view.menuBar',
    ],
  },
  { title: 'Go', key: 'g', items: ['go.previous', 'go.next', _, 'go.first', 'go.last', _, 'go.page'] },
  {
    title: 'Tools',
    key: 't',
    items: [
      'view.rotateLeft', 'view.rotateRight', _,
      'tools.select', _,
      'tools.highlight', 'tools.underline', 'tools.strikeout', _,
      'tools.draw', 'tools.line', 'tools.arrow', 'tools.rect', 'tools.rounded', 'tools.oval', _,
      'tools.text', 'tools.note',
    ],
  },
  { title: 'Window', key: 'w', items: ['window.minimize', 'window.zoom'] },
  { title: 'Help', key: 'h', items: ['help.shortcuts', _, 'app.about'] },
];

/** A menu row as shown right now. */
export interface MenuRow {
  id: string;
  label: string;
  shortcut: string | undefined;
  enabled: boolean;
  /** Undefined for plain commands; true or false for toggles and choices. */
  checked: boolean | undefined;
  radio: boolean;
}

export type MenuEntry = MenuRow | typeof SEPARATOR;

/**
 * The rows of `menu` with each command's current label and state. Ids nobody registered are
 * left out, and so are the separators that would then lead, trail or double up.
 */
export function menuItems(menu: MenuSpec, commands: Commands): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const id of menu.items) {
    if (id === SEPARATOR) {
      if (out.length > 0 && out.at(-1) !== SEPARATOR) out.push(SEPARATOR);
      continue;
    }
    const c = commands.get(id);
    if (!c) continue;
    out.push({
      id,
      label: commands.label(id),
      shortcut: c.shortcut,
      enabled: commands.isEnabled(id),
      checked: c.checked?.(),
      radio: !!c.radio,
    });
  }
  if (out.at(-1) === SEPARATOR) out.pop();
  return out;
}

/** The Latin letter a key types; when an IME reports another script (ㄹ for F), the letter on the physical key. */
export function keyLetter(k: { key: string; code?: string }): string | null {
  if (/^[a-z]$/i.test(k.key)) return k.key.toLowerCase();
  return /^Key([A-Z])$/.exec(k.code ?? '')?.[1]?.toLowerCase() ?? null;
}

/** The menu that Alt+`key` opens, or -1. */
export function menuForKey(menus: readonly MenuSpec[], k: { key: string; code?: string }): number {
  const ch = keyLetter(k);
  return ch ? menus.findIndex((m) => m.key === ch) : -1;
}
