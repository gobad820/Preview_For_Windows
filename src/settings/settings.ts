/**
 * Window-wide settings, remembered across launches (not per file) and edited in the Settings
 * window. Markup defaults are not here: the markup state owns and remembers them.
 */
import { loadPrefs } from '../state/prefs';
import type { DisplayMode } from '../store';
import type { ZoomMode } from '../types';

/** How a file without a remembered position opens. */
export type DefaultZoom = 'fit-width' | 'fit-page' | 'actual-size';

export interface Settings {
  defaultZoom: DefaultZoom;
  /** Page layout; the View menu changes it too. */
  displayMode: DisplayMode;
  bookMode: boolean;
  /** Opening a document shows the sidebar. */
  sidebarOnOpen: boolean;
  /** Each file reopens at its last page, zoom and rotation. Off forgets them all. */
  rememberPosition: boolean;
  /** The in-window menu bar; View › Menu Bar changes it too. */
  menuBarVisible: boolean;
}

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type SettingsListener = (settings: Settings, prev: Settings) => void;

export const SETTINGS_KEY = 'pfw.settings';
/** Before Settings existed, only the page layout was remembered, under this key. */
const LEGACY_VIEW_KEY = 'pfw.view';

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  defaultZoom: 'fit-width',
  displayMode: 'continuous',
  bookMode: false,
  sidebarOnOpen: false,
  rememberPosition: true,
  menuBarVisible: true,
});

const ZOOMS: ReadonlySet<unknown> = new Set<DefaultZoom>(['fit-width', 'fit-page', 'actual-size']);
const DISPLAY_MODES: ReadonlySet<unknown> = new Set<DisplayMode>(['continuous', 'two-pages']);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Valid fields of `v`, for a stored entry or a patch. */
function pick(v: unknown): Partial<Settings> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (ZOOMS.has(o['defaultZoom'])) out.defaultZoom = o['defaultZoom'] as DefaultZoom;
  if (DISPLAY_MODES.has(o['displayMode'])) out.displayMode = o['displayMode'] as DisplayMode;
  if (isBool(o['bookMode'])) out.bookMode = o['bookMode'];
  if (isBool(o['sidebarOnOpen'])) out.sidebarOnOpen = o['sidebarOnOpen'];
  if (isBool(o['rememberPosition'])) out.rememberPosition = o['rememberPosition'];
  if (isBool(o['menuBarVisible'])) out.menuBarVisible = o['menuBarVisible'];
  return out;
}

function defaultStorage(): SettingsStorage | null {
  try {
    return (globalThis as { localStorage?: SettingsStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** The zoom a file without a remembered position opens at. */
export function zoomFor(zoom: DefaultZoom): { zoomMode: ZoomMode; scale: number } {
  return zoom === 'actual-size' ? { zoomMode: 'custom', scale: 1 } : { zoomMode: zoom, scale: 1 };
}

export class SettingsModel {
  private data: Settings;
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly storage: SettingsStorage | null = defaultStorage()) {
    this.data = this.load();
  }

  get(): Settings {
    return { ...this.data };
  }

  /** Applies the valid fields of `patch`; persists and notifies when something changed. */
  set(patch: Partial<Settings>): void {
    const valid = pick(patch);
    const keys = Object.keys(valid) as (keyof Settings)[];
    if (keys.every((k) => this.data[k] === valid[k])) return;
    const prev = this.data;
    this.data = { ...prev, ...valid };
    this.save();
    for (const fn of [...this.listeners]) fn(this.get(), { ...prev });
  }

  onChange(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- internals ------------------------------------------------------------

  private load(): Settings {
    try {
      const raw = this.storage?.getItem(SETTINGS_KEY) ?? null;
      if (raw === null) return this.migrate();
      return { ...DEFAULT_SETTINGS, ...pick(JSON.parse(raw)) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  /** First launch with Settings: the page layout saved by earlier versions carries over. */
  private migrate(): Settings {
    if (this.storage?.getItem(LEGACY_VIEW_KEY) == null) return { ...DEFAULT_SETTINGS };
    const { displayMode, bookMode } = loadPrefs(this.storage);
    this.data = { ...DEFAULT_SETTINGS, displayMode, bookMode };
    this.save();
    return this.data;
  }

  private save(): void {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.data));
    } catch {
      // Storage may be full, disabled or unavailable; the settings still apply for this session.
    }
  }
}
