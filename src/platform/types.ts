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

/** CSS pixels in viewport coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** A file drag over the window: `point` is where the pointer is, `paths` what is dragged. */
export interface DragState {
  over: boolean;
  point: Point | null;
  paths: string[];
}

/** Custom title bar buttons; null where the host draws its own (browser). */
export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  /** Requests a close; goes through `onCloseRequested`. */
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onMaximizedChange(cb: (maximized: boolean) => void): () => void;
}

/** Host abstraction: implemented by Tauri in the exe and by a browser shim for e2e tests. */
export interface Platform {
  readFile(path: string): Promise<Uint8Array>;
  /** Resolves with the chosen path, or null when the dialog was cancelled. */
  openFileDialog(): Promise<string | null>;
  /** Multi-select PDF picker; resolves with [] when cancelled. */
  openFilesDialog(): Promise<string[]>;
  /** Resolves with the chosen destination, or null when cancelled. */
  saveFileDialog(defaultPath: string): Promise<string | null>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Changes whenever the file's contents change (size and modification time); null if missing. */
  fileStamp(path: string): Promise<string | null>;
  /** Opens `path` in a new window; resolves false when the host cannot (browser). */
  openInNewWindow(path: string): Promise<boolean>;
  /** Puts a PDF on the system clipboard as a file so other windows can paste it. */
  clipboardWritePdf(data: Uint8Array): Promise<void>;
  /** PDF paths on the clipboard, or null while it still holds this window's own last copy. */
  clipboardReadPdfPaths(): Promise<string[] | null>;
  /** File passed on the command line at launch, if any. */
  startupFile(): Promise<string | null>;
  /** Files dropped onto the window and where; returns an unsubscribe function. */
  onFileDrop(cb: (paths: string[], point: Point | null) => void): () => void;
  /** Reports file drags over the window as they move. */
  onDragState(cb: (state: DragState) => void): () => void;
  /** `cb` decides whether the window may close (true = close). Registers one handler. */
  onCloseRequested(cb: () => Promise<boolean>): void;
  setTitle(title: string): Promise<void>;
  /** Display name for a path (last path segment). */
  fileName(path: string): string;
  readonly windowControls: WindowControls | null;
  /** Window backdrop: 'mica' makes chrome backgrounds translucent. */
  readonly material: 'mica' | 'none';
  /** Bytes of the font text box annotations are saved in (Malgun Gothic), or null when unavailable. */
  loadAnnotationFont(): Promise<Uint8Array | null>;
}
