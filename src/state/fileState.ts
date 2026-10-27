import type { FileState } from '../platform/types';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const KEY_PREFIX = 'pfw:file:';
const MAX_ENTRIES = 200;

const ZOOM_MODES: ReadonlySet<unknown> = new Set(['fit-width', 'fit-page', 'custom']);
const ROTATIONS: ReadonlySet<unknown> = new Set([0, 90, 180, 270]);

function keyFor(path: string): string {
  return KEY_PREFIX + path;
}

function defaultStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

function isFileState(v: unknown): v is FileState {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    Number.isInteger(o.page) && (o.page as number) >= 1 &&
    ZOOM_MODES.has(o.zoomMode) &&
    typeof o.scale === 'number' && Number.isFinite(o.scale) && o.scale > 0 &&
    ROTATIONS.has(o.rotation) &&
    typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt)
  );
}

function parse(raw: string | null): FileState | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isFileState(v)) return null;
    const { page, zoomMode, scale, rotation, updatedAt } = v;
    return { page, zoomMode, scale, rotation, updatedAt };
  } catch {
    return null;
  }
}

export function loadFileState(path: string, storage: StorageLike | null = defaultStorage()): FileState | null {
  if (!storage) return null;
  try {
    return parse(storage.getItem(keyFor(path)));
  } catch {
    return null;
  }
}

/** Removes the oldest `pfw:file:` entries so that at most MAX_ENTRIES remain. Corrupt entries count as oldest. */
function evictOldest(storage: StorageLike): void {
  const entries: Array<{ key: string; updatedAt: number }> = [];
  const n = storage.length;
  for (let i = 0; i < n; i++) {
    const key = storage.key(i);
    if (key === null || !key.startsWith(KEY_PREFIX)) continue;
    entries.push({ key, updatedAt: parse(storage.getItem(key))?.updatedAt ?? -Infinity });
  }
  const excess = entries.length - MAX_ENTRIES;
  if (excess <= 0) return;
  entries.sort((a, b) => a.updatedAt - b.updatedAt);
  for (const { key } of entries.slice(0, excess)) storage.removeItem(key);
}

/** Forgets every file's position (Settings › Remember each file's last page and zoom, off). */
export function clearFileStates(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage unavailable: nothing was remembered there either.
  }
}

export function saveFileState(
  path: string,
  state: Omit<FileState, 'updatedAt'>,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  const entry: FileState = {
    page: state.page,
    zoomMode: state.zoomMode,
    scale: state.scale,
    rotation: state.rotation,
    updatedAt: Date.now(),
  };
  try {
    storage.setItem(keyFor(path), JSON.stringify(entry));
    evictOldest(storage);
  } catch {
    // Storage may be full, disabled or unavailable; losing the position is acceptable.
  }
}
