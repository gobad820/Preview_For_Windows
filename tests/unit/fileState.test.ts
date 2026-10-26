import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileState } from '../../src/platform/types';
import { loadFileState, saveFileState, type StorageLike } from '../../src/state/fileState';

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

class ThrowingStorage implements StorageLike {
  get length(): number {
    throw new Error('length');
  }
  key(): string | null {
    throw new Error('key');
  }
  getItem(): string | null {
    throw new Error('getItem');
  }
  setItem(): void {
    throw new Error('setItem');
  }
  removeItem(): void {
    throw new Error('removeItem');
  }
}

const sample: Omit<FileState, 'updatedAt'> = { page: 7, zoomMode: 'custom', scale: 1.5, rotation: 90 };

describe('fileState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips a saved state and stamps updatedAt', () => {
    const storage = new MemoryStorage();
    saveFileState('C:\\docs\\한글 문서.pdf', sample, storage);
    expect(loadFileState('C:\\docs\\한글 문서.pdf', storage)).toEqual<FileState>({ ...sample, updatedAt: 1_000_000 });
  });

  it('stores entries under the pfw:file: prefix', () => {
    const storage = new MemoryStorage();
    saveFileState('/a.pdf', sample, storage);
    expect(storage.keys()).toEqual(['pfw:file:/a.pdf']);
  });

  it('returns null for an unknown path', () => {
    expect(loadFileState('/missing.pdf', new MemoryStorage())).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem('pfw:file:/bad.pdf', '{not json');
    expect(loadFileState('/bad.pdf', storage)).toBeNull();
  });

  it('returns null for JSON with the wrong shape', () => {
    const storage = new MemoryStorage();
    storage.setItem('pfw:file:/shape.pdf', JSON.stringify({ page: 'two', zoomMode: 'custom', scale: 1, rotation: 0, updatedAt: 1 }));
    expect(loadFileState('/shape.pdf', storage)).toBeNull();
    storage.setItem('pfw:file:/rot.pdf', JSON.stringify({ ...sample, rotation: 45, updatedAt: 1 }));
    expect(loadFileState('/rot.pdf', storage)).toBeNull();
    storage.setItem('pfw:file:/mode.pdf', JSON.stringify({ ...sample, zoomMode: 'huge', updatedAt: 1 }));
    expect(loadFileState('/mode.pdf', storage)).toBeNull();
  });

  it('overwrites the entry for a path instead of adding a second one', () => {
    const storage = new MemoryStorage();
    saveFileState('/a.pdf', sample, storage);
    vi.setSystemTime(2_000_000);
    saveFileState('/a.pdf', { ...sample, page: 9 }, storage);
    expect(storage.length).toBe(1);
    expect(loadFileState('/a.pdf', storage)).toEqual<FileState>({ ...sample, page: 9, updatedAt: 2_000_000 });
  });

  it('evicts the entry with the oldest updatedAt once there are more than 200', () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 200; i++) {
      vi.setSystemTime(1_000_000 + i);
      saveFileState(`/doc-${i}.pdf`, sample, storage);
    }
    // Touch doc-0 so it is no longer the oldest; doc-1 is.
    vi.setSystemTime(5_000_000);
    saveFileState('/doc-0.pdf', sample, storage);
    expect(storage.length).toBe(200);

    vi.setSystemTime(6_000_000);
    saveFileState('/doc-200.pdf', sample, storage);
    expect(storage.length).toBe(200);
    expect(loadFileState('/doc-1.pdf', storage)).toBeNull();
    expect(loadFileState('/doc-0.pdf', storage)).not.toBeNull();
    expect(loadFileState('/doc-2.pdf', storage)).not.toBeNull();
    expect(loadFileState('/doc-200.pdf', storage)).not.toBeNull();
  });

  it('leaves unrelated keys alone and does not count them toward the limit', () => {
    const storage = new MemoryStorage();
    storage.setItem('pfw:window', '{"w":800}');
    for (let i = 0; i < 200; i++) {
      vi.setSystemTime(1_000_000 + i);
      saveFileState(`/doc-${i}.pdf`, sample, storage);
    }
    expect(storage.length).toBe(201);
    expect(storage.getItem('pfw:window')).toBe('{"w":800}');
  });

  it('never throws when the storage throws', () => {
    const storage = new ThrowingStorage();
    expect(() => saveFileState('/a.pdf', sample, storage)).not.toThrow();
    expect(loadFileState('/a.pdf', storage)).toBeNull();
  });

  it('is a no-op without localStorage when no storage is given', () => {
    expect(typeof globalThis.localStorage).toBe('undefined');
    expect(() => saveFileState('/a.pdf', sample)).not.toThrow();
    expect(loadFileState('/a.pdf')).toBeNull();
  });
});
