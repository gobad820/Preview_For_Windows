/**
 * UI text: Menu bar titles, every command's label, the toolbar and context menus, Help › Keyboard Shortcuts.
 * Keys start with `menu.`. English is the reference; Korean must have every key (the type
 * says so) with the same placeholders (tests/unit/i18n.test.ts checks).
 */
import type { Message } from './types';

export const en = {
  'menu.file': 'File',
} satisfies Record<string, Message>;

export const ko: Record<keyof typeof en, Message> = {
  'menu.file': '파일',
};
