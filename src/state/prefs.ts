import type { DisplayMode } from '../store';

/** Window-wide view preferences, remembered across launches (not per file). */
export interface ViewPrefs {
  displayMode: DisplayMode;
  bookMode: boolean;
}

export type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'pfw.view';
const DISPLAY_MODES: ReadonlySet<unknown> = new Set<DisplayMode>(['continuous', 'two-pages']);
const DEFAULTS: ViewPrefs = { displayMode: 'continuous', bookMode: false };

function defaultStorage(): PrefsStorage | null {
  try {
    return (globalThis as { localStorage?: PrefsStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved preferences; each field that is missing or invalid takes its default. */
export function loadPrefs(storage: PrefsStorage | null = defaultStorage()): ViewPrefs {
  try {
    const v: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ...DEFAULTS };
    const o = v as Record<string, unknown>;
    return {
      displayMode: DISPLAY_MODES.has(o.displayMode) ? (o.displayMode as DisplayMode) : DEFAULTS.displayMode,
      bookMode: typeof o.bookMode === 'boolean' ? o.bookMode : DEFAULTS.bookMode,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: ViewPrefs, storage: PrefsStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ displayMode: prefs.displayMode, bookMode: prefs.bookMode }));
  } catch {
    // Storage may be full, disabled or unavailable; the view then starts from the defaults.
  }
}
