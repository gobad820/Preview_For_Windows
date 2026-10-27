import { afterEach, describe, expect, test } from 'vitest';
import { Commands } from '../../src/commands';
import { setLocale } from '../../src/i18n';
import { MENUS, SEPARATOR, accessKey, menuForKey, menuItems, type MenuSpec } from '../../src/menubar/menus';

afterEach(() => setLocale('en'));

describe('MENUS', () => {
  test('each access key opens exactly one menu and is a letter of its English title', () => {
    const keys = MENUS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of MENUS) expect(m.title().toLowerCase()).toContain(m.key);
  });

  test('titles follow the UI language; the application menu keeps the product name', () => {
    expect(MENUS.map((m) => m.title())).toEqual(['Preview', 'File', 'Edit', 'View', 'Go', 'Tools', 'Window', 'Help']);
    setLocale('ko');
    expect(MENUS.map((m) => m.title())).toEqual(['Preview', '파일', '편집', '보기', '이동', '도구', '윈도우', '도움말']);
  });

  test('separators only sit between items', () => {
    for (const m of MENUS) {
      expect(m.items[0], m.title()).not.toBe(SEPARATOR);
      expect(m.items.at(-1), m.title()).not.toBe(SEPARATOR);
      m.items.forEach((id, i) => {
        if (id === SEPARATOR) expect(m.items[i + 1], `${m.title()} #${i}`).not.toBe(SEPARATOR);
      });
    }
  });

  test('the application menu comes first and is the only bold one', () => {
    expect(MENUS[0]!.app).toBe(true);
    expect(MENUS.slice(1).some((m) => m.app)).toBe(false);
  });
});

describe('accessKey', () => {
  test('underlines the access key where the title has that letter', () => {
    expect(accessKey('File', 'f')).toEqual({ before: '', key: 'F', after: 'ile', hint: false });
    expect(accessKey('Preview', 'p')).toEqual({ before: '', key: 'P', after: 'review', hint: false });
    expect(accessKey('Help', 'h')).toEqual({ before: '', key: 'H', after: 'elp', hint: false });
  });

  test('a title without the letter (Korean) gets it in parentheses after it, as on Korean Windows', () => {
    expect(accessKey('파일', 'f')).toEqual({ before: '파일', key: 'F', after: '', hint: true });
    expect(accessKey('도움말', 'h')).toEqual({ before: '도움말', key: 'H', after: '', hint: true });
  });
});

describe('menuForKey', () => {
  test('Alt+letter finds the menu whose access key it is', () => {
    expect(MENUS[menuForKey(MENUS, { key: 'f' })]!.title()).toBe('File');
    expect(MENUS[menuForKey(MENUS, { key: 'V' })]!.title()).toBe('View');
    expect(menuForKey(MENUS, { key: 'q' })).toBe(-1);
    expect(menuForKey(MENUS, { key: 'ArrowDown' })).toBe(-1);
  });

  test('works the same with Korean titles', () => {
    setLocale('ko');
    expect(MENUS[menuForKey(MENUS, { key: 'f' })]!.title()).toBe('파일');
    expect(MENUS[menuForKey(MENUS, { key: 'ㅎ', code: 'KeyG' })]!.title()).toBe('이동');
  });

  test('uses the physical key when an IME reports a Hangul letter', () => {
    // Korean 2-set layout: the F key types ㄹ.
    expect(MENUS[menuForKey(MENUS, { key: 'ㄹ', code: 'KeyF' })]!.title()).toBe('File');
    expect(menuForKey(MENUS, { key: 'ㅂ', code: 'KeyQ' })).toBe(-1);
  });
});

describe('menuItems', () => {
  const spec: MenuSpec = { title: () => 'Test', key: 't', items: ['a.save', SEPARATOR, 'a.missing', SEPARATOR, 'a.mode', 'a.grid'] };

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
