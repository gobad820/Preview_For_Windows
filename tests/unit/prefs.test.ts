import { describe, expect, it } from 'vitest';
import { loadPrefs, type PrefsStorage } from '../../src/state/prefs';

class MemoryStorage implements PrefsStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
}

class ThrowingStorage implements PrefsStorage {
  getItem(): string | null {
    throw new Error('getItem');
  }
}

const DEFAULTS = { displayMode: 'continuous', bookMode: false };

describe('legacy view prefs (pfw.view)', () => {
  it('defaults to Continuous Scroll without Book Mode', () => {
    expect(loadPrefs(new MemoryStorage())).toEqual(DEFAULTS);
  });

  it('reads what earlier versions saved under pfw.view', () => {
    const storage = new MemoryStorage();
    storage.setItem('pfw.view', '{"displayMode":"two-pages","bookMode":true}');
    expect(loadPrefs(storage)).toEqual({ displayMode: 'two-pages', bookMode: true });
    storage.setItem('pfw.view', '{"displayMode":"continuous","bookMode":true}');
    expect(loadPrefs(storage)).toEqual({ displayMode: 'continuous', bookMode: true });
  });

  it.each([
    ['not json', '{nope'],
    ['null', 'null'],
    ['a number', '42'],
    ['an array', '["two-pages", true]'],
    ['wrong types', '{"displayMode":"grid","bookMode":"yes"}'],
  ])('falls back to the defaults on garbage (%s)', (_name, raw) => {
    const storage = new MemoryStorage();
    storage.setItem('pfw.view', raw);
    expect(loadPrefs(storage)).toEqual(DEFAULTS);
  });

  it('keeps the valid field of a half-broken entry', () => {
    const storage = new MemoryStorage();
    storage.setItem('pfw.view', '{"displayMode":"two-pages","bookMode":1}');
    expect(loadPrefs(storage)).toEqual({ displayMode: 'two-pages', bookMode: false });
  });

  it('survives storage that throws or is missing', () => {
    expect(loadPrefs(new ThrowingStorage())).toEqual(DEFAULTS);
    expect(loadPrefs(null)).toEqual(DEFAULTS);
    expect(typeof globalThis.localStorage).toBe('undefined');
    expect(loadPrefs()).toEqual(DEFAULTS);
  });
});
