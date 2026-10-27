import { t, type MessageKey } from '../i18n';

/**
 * Static UI text written into markup as message keys and filled in by `localize`, so a template
 * (or index.html) is built once and re-labelled when the UI language changes:
 * `data-i18n` the text, `data-i18n-title` the tooltip (followed by `data-i18n-keys`, the
 * shortcut, in brackets), `data-i18n-label` the accessible name, `data-i18n-placeholder` the
 * placeholder.
 */
export interface TextKeys {
  text?: MessageKey;
  title?: MessageKey;
  /** Shortcut shown after the tooltip, as written on the keys ("Ctrl+F"). */
  keys?: string;
  label?: MessageKey;
  placeholder?: MessageKey;
}

const SELECTOR = '[data-i18n], [data-i18n-title], [data-i18n-label], [data-i18n-placeholder]';

/** The `data-i18n*` attributes for `keys`, for a template string. */
export function i18n(keys: TextKeys): string {
  const out: string[] = [];
  if (keys.text) out.push(`data-i18n="${keys.text}"`);
  if (keys.title) out.push(`data-i18n-title="${keys.title}"`);
  if (keys.keys) out.push(`data-i18n-keys="${keys.keys}"`);
  if (keys.label) out.push(`data-i18n-label="${keys.label}"`);
  if (keys.placeholder) out.push(`data-i18n-placeholder="${keys.placeholder}"`);
  return out.join(' ');
}

/** A tooltip with its shortcut: "Find (Ctrl+F)". */
export function withKeys(title: string, keys: string | undefined): string {
  return keys ? `${title} (${keys})` : title;
}

/** Fills the text of `root` and every element in it that carries `data-i18n*` keys, in the current UI language. */
export function localize(root: Element): void {
  const els = [...(root.matches(SELECTOR) ? [root] : []), ...root.querySelectorAll(SELECTOR)];
  for (const el of els as HTMLElement[]) {
    const { i18n: text, i18nTitle: title, i18nKeys: keys, i18nLabel: label, i18nPlaceholder: placeholder } = el.dataset;
    if (text) el.textContent = t(text as MessageKey);
    if (title) el.title = withKeys(t(title as MessageKey), keys);
    if (label) el.setAttribute('aria-label', t(label as MessageKey));
    if (placeholder) el.setAttribute('placeholder', t(placeholder as MessageKey));
  }
}
