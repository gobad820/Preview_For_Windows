/**
 * UI text: Toolbar, title and page counter, find bar, sidebar, empty window, markup toolbar and popovers, About, window buttons, window title.
 * Keys start with `chrome.`. English is the reference; Korean must have every key (the type
 * says so) with the same placeholders (tests/unit/i18n.test.ts checks).
 */
import type { Message } from './types';

export const en = {
  'chrome.edited': 'Edited',
} satisfies Record<string, Message>;

export const ko: Record<keyof typeof en, Message> = {
  'chrome.edited': '편집됨',
};
