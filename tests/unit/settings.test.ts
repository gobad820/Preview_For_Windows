import { describe, expect, it } from 'vitest';
import { SettingsModel, zoomFor, type Settings, type SettingsStorage } from '../../src/settings/settings';

class MemoryStorage implements SettingsStorage {
  readonly map = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.map.set(k, v);
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
}

class ThrowingStorage implements SettingsStorage {
  getItem(): string | null {
    throw new Error('getItem');
  }
  setItem(): void {
    throw new Error('setItem');
  }
}

const DEFAULTS: Settings = {
  defaultZoom: 'fit-width',
  displayMode: 'continuous',
  bookMode: false,
  sidebarOnOpen: false,
  rememberPosition: true,
  menuBarVisible: true,
};

const stored = (storage: MemoryStorage) => JSON.parse(storage.map.get('pfw.settings') ?? 'null');

describe('settings model', () => {
  it('starts from the defaults', () => {
    expect(new SettingsModel(new MemoryStorage()).get()).toEqual(DEFAULTS);
  });

  it('persists under pfw.settings and reloads in a new instance', () => {
    const storage = new MemoryStorage();
    const a = new SettingsModel(storage);
    a.set({ defaultZoom: 'fit-page', sidebarOnOpen: true, rememberPosition: false, menuBarVisible: false });
    a.set({ displayMode: 'two-pages', bookMode: true });
    expect(new SettingsModel(storage).get()).toEqual({
      defaultZoom: 'fit-page',
      displayMode: 'two-pages',
      bookMode: true,
      sidebarOnOpen: true,
      rememberPosition: false,
      menuBarVisible: false,
    });
  });

  it('ignores invalid values and keeps the rest of the patch', () => {
    const m = new SettingsModel(new MemoryStorage());
    m.set({ defaultZoom: 'huge' as never, displayMode: 'grid' as never, bookMode: 1 as never, sidebarOnOpen: true });
    expect(m.get()).toEqual({ ...DEFAULTS, sidebarOnOpen: true });
  });

  it('notifies with the new and previous settings, only on effective changes', () => {
    const m = new SettingsModel(new MemoryStorage());
    const calls: Array<[Settings, Settings]> = [];
    const off = m.onChange((s, prev) => calls.push([s, prev]));
    m.set({ menuBarVisible: true });
    m.set({ defaultZoom: 'fit-width' });
    expect(calls).toHaveLength(0);
    m.set({ menuBarVisible: false });
    expect(calls).toEqual([[{ ...DEFAULTS, menuBarVisible: false }, DEFAULTS]]);
    off();
    m.set({ menuBarVisible: true });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['not json', '{nope'],
    ['null', 'null'],
    ['a number', '42'],
    ['an array', '[true, false]'],
    ['wrong types', '{"defaultZoom":3,"displayMode":"grid","bookMode":"yes","sidebarOnOpen":null,"rememberPosition":"no","menuBarVisible":0}'],
  ])('falls back to the defaults on garbage (%s)', (_name, raw) => {
    expect(new SettingsModel(new MemoryStorage({ 'pfw.settings': raw })).get()).toEqual(DEFAULTS);
  });

  it('keeps the valid fields of a half-broken entry', () => {
    const storage = new MemoryStorage({ 'pfw.settings': '{"defaultZoom":"actual-size","menuBarVisible":"off"}' });
    expect(new SettingsModel(storage).get()).toEqual({ ...DEFAULTS, defaultZoom: 'actual-size' });
  });

  it('survives storage that throws or is missing', () => {
    const throwing = new SettingsModel(new ThrowingStorage());
    expect(throwing.get()).toEqual(DEFAULTS);
    expect(() => throwing.set({ menuBarVisible: false })).not.toThrow();
    expect(throwing.get().menuBarVisible).toBe(false);
    const none = new SettingsModel(null);
    none.set({ bookMode: true });
    expect(none.get().bookMode).toBe(true);
    expect(typeof globalThis.localStorage).toBe('undefined');
    expect(new SettingsModel().get()).toEqual(DEFAULTS);
  });

  describe('migration from pfw.view', () => {
    it('takes the saved page layout when there are no settings yet, and saves it as settings', () => {
      const storage = new MemoryStorage({ 'pfw.view': '{"displayMode":"two-pages","bookMode":true}' });
      expect(new SettingsModel(storage).get()).toEqual({ ...DEFAULTS, displayMode: 'two-pages', bookMode: true });
      expect(stored(storage)).toMatchObject({ displayMode: 'two-pages', bookMode: true });
    });

    it('happens once: later settings win over the old layout', () => {
      const storage = new MemoryStorage({ 'pfw.view': '{"displayMode":"two-pages","bookMode":true}' });
      new SettingsModel(storage).set({ displayMode: 'continuous', bookMode: false });
      expect(new SettingsModel(storage).get()).toMatchObject({ displayMode: 'continuous', bookMode: false });
    });

    it('ignores a broken old layout', () => {
      const storage = new MemoryStorage({ 'pfw.view': '{"displayMode":"grid","bookMode":"yes"}' });
      expect(new SettingsModel(storage).get()).toEqual(DEFAULTS);
    });
  });
});

describe('default zoom', () => {
  it.each([
    ['fit-width', { zoomMode: 'fit-width', scale: 1 }],
    ['fit-page', { zoomMode: 'fit-page', scale: 1 }],
    ['actual-size', { zoomMode: 'custom', scale: 1 }],
  ] as const)('%s opens files as %o', (zoom, want) => {
    expect(zoomFor(zoom)).toEqual(want);
  });
});
