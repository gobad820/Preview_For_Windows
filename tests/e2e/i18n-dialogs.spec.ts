import { expect, test, type Locator, type Page } from '@playwright/test';

/** Starts in Korean: the saved setting applies before the window is built. */
const startInKorean = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('pfw.settings', JSON.stringify({ language: 'ko' })));

/** Switches the UI language live, as Settings › General › Language does. */
const setLanguage = (page: Page, language: 'system' | 'en' | 'ko') =>
  page.evaluate((l) => (window as any).__pfw.app.settings.set({ language: l }), language);

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
}

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());
const banner = (page: Page) => page.locator('.error-banner');
const alert = (page: Page) => page.getByRole('alertdialog');

/** Deletes page 2, so the document has unsaved changes. */
async function edit(page: Page) {
  await page.evaluate(() => {
    const editor = (window as any).__pfw.editor;
    editor.clickAt(1, {});
    editor.deleteSelection();
  });
  await expect.poll(async () => (await state(page)).dirty).toBe(true);
}

/** Asks to close the window; resolves with whether it may close. */
const requestClose = (page: Page) => page.evaluate(() => (window as any).__pfwRequestClose());

test.describe('alerts', () => {
  test('unsaved changes: Korean at startup, and the buttons still answer', async ({ page }) => {
    await startInKorean(page);
    await open(page, 'simple.pdf');
    await edit(page);
    const cancelled = requestClose(page);
    await expect(alert(page).locator('.alert-title')).toHaveText('‘simple.pdf’ 문서의 변경 사항을 저장하겠습니까?');
    await expect(alert(page).locator('.alert-message')).toHaveText('저장하지 않으면 변경 사항이 유실됩니다.');
    await expect(alert(page).getByRole('button')).toHaveText(['저장', '저장 안 함', '취소']);
    await alert(page).getByRole('button', { name: '취소' }).click();
    expect(await cancelled).toBe(false);

    const saved = requestClose(page);
    await alert(page).getByRole('button', { name: '저장', exact: true }).click();
    expect(await saved).toBe(true);
    expect((await state(page)).dirty).toBe(false);
  });

  test('alerts follow a live language switch, and English comes back', async ({ page }) => {
    await open(page, 'simple.pdf');
    await edit(page);
    const titles: string[] = [];
    for (const language of ['en', 'ko', 'system'] as const) {
      await setLanguage(page, language);
      const answer = requestClose(page);
      titles.push((await alert(page).locator('.alert-title').textContent()) ?? '');
      await page.keyboard.press('Escape');
      expect(await answer).toBe(false);
    }
    expect(titles).toEqual([
      'Do you want to save the changes made to the document “simple.pdf”?',
      '‘simple.pdf’ 문서의 변경 사항을 저장하겠습니까?',
      'Do you want to save the changes made to the document “simple.pdf”?',
    ]);
  });

  test('a file changed by another app: Korean title, message and buttons', async ({ page }) => {
    await startInKorean(page);
    await open(page, 'simple.pdf');
    await edit(page);
    await page.evaluate(() => (window as any).__pfwFiles.set('fixtures/simple.pdf', new Uint8Array([37, 80, 68, 70])));
    await page.keyboard.press('Control+s');
    await expect(alert(page).locator('.alert-title')).toHaveText('‘simple.pdf’ 파일이 다른 응용 프로그램에서 변경되었습니다.');
    await expect(alert(page).locator('.alert-message')).toHaveText(
      '지금 저장하면 해당 변경 사항이 대치됩니다. 대신 이 버전을 새 파일로 저장할 수 있습니다.',
    );
    await expect(alert(page).getByRole('button')).toHaveText(['다른 이름으로 저장…', '대치', '취소']);
    await alert(page).getByRole('button', { name: '대치' }).click();
    await expect.poll(async () => (await state(page)).dirty).toBe(false);
  });

  test('the password prompt is in Korean, including the retry message', async ({ page }) => {
    await startInKorean(page);
    await open(page, 'encrypted.pdf');
    await expect(alert(page).locator('.alert-title')).toHaveText('‘encrypted.pdf’ 문서는 암호로 보호되어 있습니다.');
    await expect(alert(page).locator('.alert-message')).toHaveText('문서를 열려면 암호를 입력하십시오.');
    const field = alert(page).locator('input.alert-input');
    await expect(field).toHaveAttribute('placeholder', '암호');
    await expect(field).toHaveAttribute('aria-label', '암호');
    await expect(alert(page).getByRole('button')).toHaveText(['취소', '열기']);
    await field.fill('wrong');
    await page.keyboard.press('Enter');
    await expect(alert(page).locator('.alert-message')).toHaveText('암호가 올바르지 않습니다. 다시 시도하십시오.');
    await alert(page).locator('input.alert-input').fill('secret');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).status).toBe('ready');
  });

  test('an alert without buttons gets an OK button in the current language', async ({ page }) => {
    await page.goto('/');
    const show = () =>
      page.evaluate(() => {
        const w = window as any;
        w.__alertResult = null;
        void w.__pfwUi.showAlert({ title: 'Probe' }).then((r: unknown) => (w.__alertResult = r));
      });
    await show();
    await expect(alert(page).getByRole('button')).toHaveText(['OK']);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).__alertResult)).toEqual({ value: 'ok' });

    await setLanguage(page, 'ko');
    await show();
    await expect(alert(page).getByRole('button')).toHaveText(['확인']);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (window as any).__alertResult)).toEqual({ value: 'ok' });
  });
});

test.describe('error messages', () => {
  test('a file that is not a PDF', async ({ page }) => {
    await startInKorean(page);
    await open(page, 'broken.pdf');
    await expect(banner(page)).toHaveText('‘broken.pdf’ 파일을 열 수 없습니다. 유효한 PDF 파일이 아닙니다.');
  });

  test('a save that fails', async ({ page }) => {
    await startInKorean(page);
    await open(page, 'simple.pdf');
    await edit(page);
    await page.evaluate(() => {
      (window as any).__pfwFiles.set = () => {
        throw new Error('disk full');
      };
    });
    await page.keyboard.press('Control+s');
    await expect(banner(page)).toHaveText('‘simple.pdf’ 파일을 저장할 수 없습니다. disk full');
  });

  test('a file that cannot be inserted', async ({ page }) => {
    await startInKorean(page);
    await open(page, 'simple.pdf');
    await page.evaluate(() => {
      const w = window as any;
      w.__pfwNextOpenPaths = ['fixtures/broken.pdf'];
      void w.__pfw.app.insertPagesFromFile();
    });
    await expect(banner(page)).toHaveText('‘broken.pdf’ 파일을 추가할 수 없습니다. 유효한 PDF 파일이 아닙니다.');
  });

  test('deleting every page', async ({ page }) => {
    await open(page, 'simple.pdf');
    await setLanguage(page, 'ko');
    await page.evaluate(() => {
      const editor = (window as any).__pfw.editor;
      editor.selectAll();
      editor.deleteSelection();
    });
    await expect(banner(page)).toHaveText('문서에는 페이지가 하나 이상 있어야 합니다.');
  });
});

// ---- Settings ----------------------------------------------------------------

const settingsWindow = (page: Page) => page.locator('.settings-window');
const openSettings = async (page: Page) => {
  await page.keyboard.press('Control+Comma');
  await expect(settingsWindow(page)).toBeVisible();
};
const optionTexts = (popup: Locator) => popup.locator('option').allTextContents();
/** Every visible text of the window: title, tabs, labels, check boxes, captions. */
const texts = (page: Page) =>
  settingsWindow(page).evaluate((win) =>
    [...win.querySelectorAll<HTMLElement>('.settings-title, .settings-tab-label, .settings-label, .settings-check span, .settings-caption')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => el.textContent),
  );

test.describe('Settings window', () => {
  test('Korean at startup: names, tabs, labels, captions and pop-up choices', async ({ page }) => {
    await startInKorean(page);
    await page.goto('/');
    await openSettings(page);
    const win = page.getByRole('dialog', { name: '설정' });
    await expect(win).toBeVisible();
    await expect(win.getByRole('tablist', { name: '설정' })).toBeVisible();
    await expect(win.getByRole('button', { name: '닫기' })).toBeVisible();
    await expect(win.getByRole('tab')).toHaveText(['일반', '마크업', '윈도우']);
    expect(await texts(page)).toEqual([
      '일반',
      '일반',
      '마크업',
      '윈도우',
      '언어:',
      '자동은 Windows 표시 언어를 따릅니다.',
      '기본 확대/축소:',
      '처음 여는 파일에 적용됩니다.',
      '페이지 레이아웃:',
      '',
      '책 모드',
      '첫 페이지를 표지처럼 오른쪽에 따로 놓습니다.',
      '사이드바:',
      '문서를 열 때 사이드바 보기',
      '문서:',
      '파일별 마지막 페이지와 확대/축소 기억하기',
      '끄면 지금까지 기억한 위치를 지웁니다.',
    ]);
    expect(await optionTexts(win.getByLabel('언어'))).toEqual(['자동(시스템 설정)', 'English', '한국어']);
    expect(await optionTexts(win.getByLabel('기본 확대/축소'))).toEqual(['폭 맞춤', '페이지 맞춤', '실제 크기']);
    expect(await optionTexts(win.getByLabel('페이지 레이아웃'))).toEqual(['연속 스크롤', '두 페이지']);

    await win.getByRole('tab', { name: '마크업' }).click();
    expect(await texts(page)).toEqual([
      '마크업',
      '일반',
      '마크업',
      '윈도우',
      '하이라이트 색상:',
      '도형 색상:',
      '도형의 테두리, 선, 그리기에 쓰입니다.',
      '선 두께:',
      '텍스트 크기:',
      '새 텍스트 상자에 적용됩니다.',
    ]);
    expect(await optionTexts(win.getByLabel('하이라이트 색상'))).toEqual(['노란색', '초록색', '파란색', '분홍색', '보라색']);
    expect(await optionTexts(win.getByLabel('도형 색상'))).toEqual([
      '검은색',
      '회색',
      '흰색',
      '갈색',
      '빨간색',
      '주황색',
      '노란색',
      '초록색',
      '청록색',
      '파란색',
      '보라색',
      '분홍색',
    ]);
    expect((await optionTexts(win.getByLabel('선 두께')))[0]).toBe('0.5pt');
    expect((await optionTexts(win.getByLabel('텍스트 크기')))[0]).toMatch(/^\d+pt$/);
    // A value the list does not offer gets its own item, also in Korean.
    await page.evaluate(() => (window as any).__pfw.markup.state.setStyles({ stroke: '#123456', width: 7 }));
    await expect(win.getByLabel('도형 색상').locator('option[data-extra]')).toHaveText('사용자 지정');
    await expect(win.getByLabel('선 두께').locator('option[data-extra]')).toHaveText('7pt');

    await win.getByRole('tab', { name: '윈도우' }).click();
    expect(await texts(page)).toEqual(['윈도우', '일반', '마크업', '윈도우', '메뉴 막대:', '메뉴 막대 보기', '가려져 있어도 Alt 키로 열 수 있습니다.']);
  });

  test('Language is the first row of General: Automatic, English, 한국어, bound to the setting', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    const pane = page.locator('#settings-pane-general');
    await expect(pane.locator('.settings-row').first().locator('.settings-label')).toHaveText('Language:');
    const language = settingsWindow(page).getByLabel('Language');
    expect(await optionTexts(language)).toEqual(['Automatic (System)', 'English', '한국어']);
    await expect(language).toHaveValue('system');
    await language.selectOption('ko');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pfw.settings')!).language)).toBe('ko');
    expect(await page.evaluate(() => [(window as any).__pfw.store.get().locale, document.documentElement.lang])).toEqual(['ko', 'ko']);
    // A change made elsewhere shows in the pop-up.
    await setLanguage(page, 'en');
    await expect(settingsWindow(page).getByLabel('Language')).toHaveValue('en');
  });

  test('an open Settings window re-renders when the language changes, on the same pane', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    await settingsWindow(page).getByRole('tab', { name: 'Markup' }).click();
    await setLanguage(page, 'ko');
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: '설정' })).toBeVisible();
    await expect(settingsWindow(page).locator('.settings-title')).toHaveText('마크업');
    await expect(settingsWindow(page).getByRole('tab', { name: '마크업' })).toHaveAttribute('aria-selected', 'true');
    await expect(settingsWindow(page).getByLabel('선 두께')).toHaveValue('2');
    await setLanguage(page, 'en');
    await expect(settingsWindow(page).locator('.settings-title')).toHaveText('Markup');
    await expect(settingsWindow(page).getByRole('tab')).toHaveText(['General', 'Markup', 'Window']);
  });

  test('picking a language in Settings switches the window in place and keeps the pop-up focused', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    await settingsWindow(page).getByLabel('Default zoom').selectOption('fit-page');
    const language = () => page.locator('#settings-language');
    await language().focus();
    await language().selectOption('ko');
    await expect(settingsWindow(page).locator('.settings-title')).toHaveText('일반');
    await expect(settingsWindow(page).locator('label[for="settings-language"]')).toHaveText('언어:');
    await expect(language()).toBeFocused();
    await expect(language()).toHaveValue('ko');
    await expect(settingsWindow(page).getByLabel('기본 확대/축소')).toHaveValue('fit-page');

    await language().selectOption('en');
    await expect(settingsWindow(page).locator('.settings-title')).toHaveText('General');
    await expect(language()).toBeFocused();
    // Still modal and still closes with Esc.
    await page.keyboard.press('Tab');
    expect(await settingsWindow(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(settingsWindow(page)).toHaveCount(0);
  });
});
