/**
 * UI text: Alerts, error messages, the password panel, open/save dialogs, the Settings window.
 * Keys start with `dlg.`. English is the reference; Korean must have every key (the type
 * says so) with the same placeholders (tests/unit/i18n.test.ts checks).
 */
import type { Message } from './types';

export const en = {
  'dlg.cancel': 'Cancel',
  'dlg.unsaved.title': 'Do you want to save the changes made to the document “{name}”?',
} satisfies Record<string, Message>;

export const ko: Record<keyof typeof en, Message> = {
  'dlg.cancel': '취소',
  'dlg.unsaved.title': '‘{name}’ 문서의 변경 사항을 저장하겠습니까?',
};
