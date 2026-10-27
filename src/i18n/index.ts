/**
 * UI language: `t(key, params)` returns the text in the current locale. The app sets the locale
 * from Settings › General › Language (`resolveLanguage`) before it builds any UI and again when
 * the setting changes; it then also sets the store's `locale`, which components subscribe to in
 * order to re-render text they built earlier. Menus read their labels each time they open.
 */
import * as chrome from './chrome';
import * as dialogs from './dialogs';
import * as menus from './menus';
import type { Language, Locale, Message, Params } from './types';

export type { Language, Locale, Message, Params } from './types';

const en = { ...menus.en, ...chrome.en, ...dialogs.en };
export type MessageKey = keyof typeof en;
const ko: Record<MessageKey, Message> = { ...menus.ko, ...chrome.ko, ...dialogs.ko };

/** Every catalog, by locale (tests read it). */
export const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, Message>>>> = { en, ko };
/** The area catalogs, for the test that keys are not defined twice. */
export const AREAS = { menus, chrome, dialogs } as const;

export const LOCALES: readonly Locale[] = ['en', 'ko'];

let current: Locale = 'en';

export function locale(): Locale {
  return current;
}

/** Switches the UI language; callers then update the store's `locale`. */
export function setLocale(l: Locale): void {
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

/** The locale a Settings choice means: `system` follows Windows' display language. */
export function resolveLanguage(lang: Language, systemLanguage: string = globalThis.navigator?.language ?? 'en'): Locale {
  if (lang !== 'system') return lang;
  return /^ko\b/i.test(systemLanguage) ? 'ko' : 'en';
}

/** The text of `key` in the current locale, with `{name}` placeholders filled from `params`. */
export function t(key: MessageKey, params: Params = {}): string {
  const m = CATALOGS[current][key] ?? CATALOGS.en[key];
  if (m === undefined) return key;
  if (typeof m === 'function') return m(params);
  return m.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
