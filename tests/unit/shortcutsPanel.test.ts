import { expect, test } from 'vitest';
import { Commands } from '../../src/commands';
import { SEPARATOR, type MenuSpec } from '../../src/menubar/menus';
import { shortcutKeys, shortcutSections } from '../../src/menubar/shortcutsPanel';

test('lists each command that has a shortcut once, under the last menu that names it', () => {
  const c = new Commands();
  c.register(
    { id: 'app.about', label: 'About', run: () => {} },
    { id: 'file.open', label: 'Open…', shortcut: 'Ctrl+O', run: () => {} },
    { id: 'file.close', label: 'Close Window', shortcut: 'Ctrl+W', run: () => {} },
    { id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', enabled: () => false, run: () => {} },
    { id: 'view.sidebar', label: () => 'Show Sidebar', shortcut: 'Ctrl+Alt+S', run: () => {} },
  );
  // The application menu repeats Close Window; the reference lists it under File.
  const menus: MenuSpec[] = [
    { title: 'App', key: 'a', app: true, items: ['app.about', SEPARATOR, 'file.close'] },
    { title: 'File', key: 'f', items: ['file.open', 'file.close', SEPARATOR, 'file.save', 'file.unknown', 'file.open'] },
    { title: 'Window', key: 'w', items: ['app.about'] },
    { title: 'View', key: 'v', items: ['view.sidebar'] },
  ];
  expect(shortcutSections(menus, c)).toEqual([
    {
      title: 'File',
      rows: [
        { label: 'Open…', shortcut: 'Ctrl+O' },
        { label: 'Close Window', shortcut: 'Ctrl+W' },
        { label: 'Save', shortcut: 'Ctrl+S' },
      ],
    },
    { title: 'View', rows: [{ label: 'Show Sidebar', shortcut: 'Ctrl+Alt+S' }] },
  ]);
});

test('splits a shortcut into its key caps; a plus as the key stays a key', () => {
  expect(shortcutKeys('Ctrl+O')).toEqual(['Ctrl', 'O']);
  expect(shortcutKeys('Ctrl+Shift+S')).toEqual(['Ctrl', 'Shift', 'S']);
  expect(shortcutKeys('Ctrl+=')).toEqual(['Ctrl', '=']);
  expect(shortcutKeys('Ctrl+-')).toEqual(['Ctrl', '-']);
  expect(shortcutKeys('Ctrl+,')).toEqual(['Ctrl', ',']);
  expect(shortcutKeys('Ctrl++')).toEqual(['Ctrl', '+']);
  expect(shortcutKeys('+')).toEqual(['+']);
  expect(shortcutKeys('→')).toEqual(['→']);
  expect(shortcutKeys('Delete')).toEqual(['Delete']);
});
