import { describe, expect, test } from 'vitest';
import { Commands } from '../../src/commands';
import { MENUS, SEPARATOR, menuForKey, menuItems, type MenuSpec } from '../../src/menubar/menus';

describe('MENUS', () => {
  test('each access key opens exactly one menu and is a letter of its title', () => {
    const keys = MENUS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of MENUS) expect(m.title.toLowerCase()).toContain(m.key);
  });

  test('separators only sit between items', () => {
    for (const m of MENUS) {
      expect(m.items[0], m.title).not.toBe(SEPARATOR);
      expect(m.items.at(-1), m.title).not.toBe(SEPARATOR);
      m.items.forEach((id, i) => {
        if (id === SEPARATOR) expect(m.items[i + 1], `${m.title} #${i}`).not.toBe(SEPARATOR);
      });
    }
  });

  test('the application menu comes first and is the only bold one', () => {
    expect(MENUS[0]!.app).toBe(true);
    expect(MENUS.slice(1).some((m) => m.app)).toBe(false);
  });
});

describe('menuForKey', () => {
  test('Alt+letter finds the menu whose access key it is', () => {
    expect(MENUS[menuForKey(MENUS, { key: 'f' })]!.title).toBe('File');
    expect(MENUS[menuForKey(MENUS, { key: 'V' })]!.title).toBe('View');
    expect(menuForKey(MENUS, { key: 'q' })).toBe(-1);
    expect(menuForKey(MENUS, { key: 'ArrowDown' })).toBe(-1);
  });

  test('uses the physical key when an IME reports a Hangul letter', () => {
    // Korean 2-set layout: the F key types ㄹ.
    expect(MENUS[menuForKey(MENUS, { key: 'ㄹ', code: 'KeyF' })]!.title).toBe('File');
    expect(menuForKey(MENUS, { key: 'ㅂ', code: 'KeyQ' })).toBe(-1);
  });
});

describe('menuItems', () => {
  const spec: MenuSpec = { title: 'Test', key: 't', items: ['a.save', SEPARATOR, 'a.missing', SEPARATOR, 'a.mode', 'a.grid'] };

  test('reads labels, shortcuts, enabled and checked state at the time it is called', () => {
    const c = new Commands();
    let dirty = false;
    let mode = false;
    c.register(
      { id: 'a.save', label: 'Save', shortcut: 'Ctrl+S', enabled: () => dirty, run: () => {} },
      { id: 'a.mode', label: () => (mode ? 'Hide Mode' : 'Show Mode'), checked: () => mode, run: () => {} },
      { id: 'a.grid', label: 'Grid', radio: true, checked: () => !mode, run: () => {} },
    );
    expect(menuItems(spec, c)).toEqual([
      { id: 'a.save', label: 'Save', shortcut: 'Ctrl+S', enabled: false, checked: undefined, radio: false },
      SEPARATOR,
      { id: 'a.mode', label: 'Show Mode', shortcut: undefined, enabled: true, checked: false, radio: false },
      { id: 'a.grid', label: 'Grid', shortcut: undefined, enabled: true, checked: true, radio: true },
    ]);
    dirty = true;
    mode = true;
    const [save, , toggle, grid] = menuItems(spec, c) as Array<Exclude<ReturnType<typeof menuItems>[number], string>>;
    expect(save!.enabled).toBe(true);
    expect(toggle).toMatchObject({ label: 'Hide Mode', checked: true });
    expect(grid!.checked).toBe(false);
  });

  test('drops ids nobody registered without leaving doubled or dangling separators', () => {
    const c = new Commands();
    c.register({ id: 'a.mode', label: 'Mode', run: () => {} });
    expect(menuItems(spec, c)).toEqual([
      { id: 'a.mode', label: 'Mode', shortcut: undefined, enabled: true, checked: undefined, radio: false },
    ]);
  });
});
