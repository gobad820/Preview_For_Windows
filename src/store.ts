import type { Rotation, ZoomMode } from './types';

export type Listener<T> = (state: T, prev: T) => void;

export interface Store<T extends object> {
  /** Current state snapshot. Treat as immutable. */
  get(): T;
  /** Shallow-merge `patch`; notifies only when at least one key changed by `Object.is`. */
  set(patch: Partial<T>): void;
  /** Called after every effective change with `(state, prev)`. Returns an unsubscribe function. */
  subscribe(fn: Listener<T>): () => void;
  /** Fires immediately with the current value, then only when `key` changes. */
  select<K extends keyof T>(key: K, fn: (value: T[K]) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state: T = { ...initial };
  const listeners = new Set<Listener<T>>();

  const get = (): T => state;

  const set = (patch: Partial<T>): void => {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    const prev = state;
    state = { ...prev, ...patch };
    for (const fn of Array.from(listeners)) fn(state, prev);
  };

  const subscribe = (fn: Listener<T>): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };

  const select = <K extends keyof T>(key: K, fn: (value: T[K]) => void): (() => void) => {
    fn(state[key]);
    return subscribe((next, prev) => {
      if (!Object.is(next[key], prev[key])) fn(next[key]);
    });
  };

  return { get, set, subscribe, select };
}

export type SidebarTab = 'thumbnails' | 'outline';
export type ViewerStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface ViewerState {
  filePath: string | null;
  fileName: string | null;
  numPages: number;
  /** 1-based; 0 when no document is open. */
  currentPage: number;
  zoomMode: ZoomMode;
  /** 1.0 = 100%; displayed CSS width = PDF points × scale × 96/72. */
  scale: number;
  rotation: Rotation;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  findOpen: boolean;
  findQuery: string;
  findTotal: number;
  /** 0-based index of the active match; -1 when none. */
  findIndex: number;
  status: ViewerStatus;
  error: string | null;
}

export const initialState: ViewerState = {
  filePath: null,
  fileName: null,
  numPages: 0,
  currentPage: 0,
  zoomMode: 'fit-width',
  scale: 1,
  rotation: 0,
  sidebarOpen: false,
  sidebarTab: 'thumbnails',
  findOpen: false,
  findQuery: '',
  findTotal: 0,
  findIndex: -1,
  status: 'empty',
  error: null,
};
