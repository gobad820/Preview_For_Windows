import { describe, expect, test, vi } from 'vitest';
import { Commands } from '../../src/commands';

describe('Commands', () => {
  test('runs enabled commands and reports disabled or unknown ones', () => {
    const c = new Commands();
    const save = vi.fn();
    let dirty = false;
    c.register({ id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', enabled: () => dirty, run: save });
    expect(c.run('file.save')).toBe(false);
    dirty = true;
    expect(c.run('file.save')).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.run('file.nothing')).toBe(false);
    expect(c.isEnabled('file.nothing')).toBe(false);
  });

  test('labels may follow state', () => {
    const c = new Commands();
    let open = false;
    c.register({ id: 'view.sidebar', label: () => (open ? 'Hide Sidebar' : 'Show Sidebar'), run: () => (open = !open) });
    expect(c.label('view.sidebar')).toBe('Show Sidebar');
    c.run('view.sidebar');
    expect(c.label('view.sidebar')).toBe('Hide Sidebar');
  });

  test('ids are unique', () => {
    const c = new Commands();
    c.register({ id: 'a.b', label: 'x', run: () => {} });
    expect(() => c.register({ id: 'a.b', label: 'y', run: () => {} })).toThrow(/twice/);
  });
});
