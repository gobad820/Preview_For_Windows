import type { Rotation, ZoomMode } from '../types';

/** Last viewing position of one file, persisted per path. */
export interface FileState {
  /** 1-based page number. */
  page: number;
  zoomMode: ZoomMode;
  scale: number;
  rotation: Rotation;
  /** `Date.now()` of the last save; used for eviction. */
  updatedAt: number;
}

/** Host abstraction: implemented by Tauri in the exe and by a browser shim for e2e tests. */
export interface Platform {
  readFile(path: string): Promise<Uint8Array>;
  /** Resolves with the chosen path, or null when the dialog was cancelled. */
  openFileDialog(): Promise<string | null>;
  /** File passed on the command line at launch, if any. */
  startupFile(): Promise<string | null>;
  /** Subscribes to files dropped onto the window; returns an unsubscribe function. */
  onFileDrop(cb: (path: string) => void): () => void;
  setTitle(title: string): Promise<void>;
  /** Display name for a path (last path segment). */
  fileName(path: string): string;
}
