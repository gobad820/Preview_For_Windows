import { expect, test } from 'vitest';
import { Commands } from '../../src/commands';
import { SEPARATOR, type MenuSpec } from '../../src/menubar/menus';
import { shortcutSections } from '../../src/menubar/shortcutsPanel';

test('lists each command that has a shortcut once, under the first menu that names it', () => {
  const c = new Commands();
  c.register(
    { id: 'app.about', label: 'About', run: () => {} },
    { id: 'file.open', label: 'Open…', shortcut: 'Ctrl+O', run: () => {} },
    { id: 'file.close', label: 'Close Window', shortcut: 'Ctrl+W', run: () => {} },
    { id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', enabled: () => false, run: () => {} },
    { id: 'view.sidebar', label: () => 'Show Sidebar', shortcut: 'Ctrl+Alt+S', run: () => {} },
  );
  const menus: MenuSpec[] = [
    { title: 'App', key: 'a', app: true, items: ['app.about', SEPARATOR, 'file.close'] },
    { title: 'File', key: 'f', items: ['file.open', 'file.close', SEPARATOR, 'file.save', 'file.unknown'] },
    { title: 'Window', key: 'w', items: ['app.about'] },
    { title: 'View', key: 'v', items: ['view.sidebar'] },
  ];
  expect(shortcutSections(menus, c)).toEqual([
    { title: 'App', rows: [{ label: 'Close Window', shortcut: 'Ctrl+W' }] },
    {
      title: 'File',
      rows: [
        { label: 'Open…', shortcut: 'Ctrl+O' },
        { label: 'Save', shortcut: 'Ctrl+S' },
      ],
    },
    { title: 'View', rows: [{ label: 'Show Sidebar', shortcut: 'Ctrl+Alt+S' }] },
  ]);
});
