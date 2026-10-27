import { afterEach, describe, expect, test } from 'vitest';
import { AREAS, CATALOGS, LOCALES, locale, resolveLanguage, setLocale, t } from '../../src/i18n';

const placeholders = (m: unknown) => (typeof m === 'string' ? [...m.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort() : null);

describe('i18n', () => {
  afterEach(() => setLocale('en'));

  test('t returns the current locale\'s text with placeholders filled', () => {
    expect(t('dlg.cancel')).toBe('Cancel');
    expect(t('dlg.unsaved.title', { name: 'a.pdf' })).toBe('Do you want to save the changes made to the document “a.pdf”?');
    setLocale('ko');
    expect(locale()).toBe('ko');
    expect(t('dlg.cancel')).toBe('취소');
    expect(t('dlg.unsaved.title', { name: 'a.pdf' })).toBe('‘a.pdf’ 문서의 변경 사항을 저장하겠습니까?');
    // a missing parameter stays visible rather than becoming "undefined"
    expect(t('dlg.unsaved.title')).toContain('{name}');
  });

  test('Automatic follows the Windows display language', () => {
    expect(resolveLanguage('system', 'ko-KR')).toBe('ko');
    expect(resolveLanguage('system', 'ko')).toBe('ko');
    expect(resolveLanguage('system', 'en-US')).toBe('en');
    expect(resolveLanguage('system', 'ja-JP')).toBe('en');
    expect(resolveLanguage('en', 'ko-KR')).toBe('en');
    expect(resolveLanguage('ko', 'en-US')).toBe('ko');
  });

  test('every locale has every key, with the same placeholders, and no text is empty', () => {
    const keys = Object.keys(CATALOGS.en).sort();
    for (const l of LOCALES) {
      expect(Object.keys(CATALOGS[l]).sort()).toEqual(keys);
      for (const k of keys) {
        const m = CATALOGS[l][k as keyof typeof CATALOGS.en];
        expect(typeof m === 'function' || (typeof m === 'string' && m.trim().length > 0), `${l} ${k}`).toBe(true);
        expect(placeholders(m), `${l} ${k}`).toEqual(placeholders(CATALOGS.en[k as keyof typeof CATALOGS.en]) ?? placeholders(m));
      }
    }
  });

  test('each key lives in one area catalog, under its prefix', () => {
    const prefix = { menus: 'menu.', chrome: 'chrome.', dialogs: 'dlg.' } as const;
    const seen = new Map<string, string>();
    for (const [area, cat] of Object.entries(AREAS)) {
      for (const k of Object.keys(cat.en)) {
        expect(seen.get(k), `${k} is in ${seen.get(k)} and ${area}`).toBeUndefined();
        seen.set(k, area);
        expect(k.startsWith(prefix[area as keyof typeof prefix]), `${k} in ${area}`).toBe(true);
      }
    }
  });
});
