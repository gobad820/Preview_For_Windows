import type { DisplayMode } from '../store';

/**
 * The page layout as versions before Settings remembered it (`pfw.view`). Only read now, once,
 * when Settings (src/settings/settings.ts) start without saved settings of their own.
 */
export interface ViewPrefs {
  displayMode: DisplayMode;
  bookMode: boolean;
}

export type PrefsStorage = Pick<Storage, 'getItem'>;

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
