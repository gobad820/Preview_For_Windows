import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
}

/** Starts in Korean, as a saved setting does. */
const startKorean = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('pfw.settings', JSON.stringify({ language: 'ko' })));

/** Switches the UI language live, as Settings › General › Language does. */
const language = (page: Page, language: 'system' | 'en' | 'ko') =>
  page.evaluate((l) => (window as any).__pfw.app.settings.set({ language: l }), language);

const titles = (page: Page) => page.locator('#menubar .mb-title');
const title = (page: Page, name: string) => page.locator('#menubar').getByRole('menuitem', { name, exact: true });
const drop = (page: Page) => page.locator('.mb-menu');
const item = (page: Page, label: string) => page.locator(`.mb-menu .mb-item:has(.mb-label:text-is("${label}"))`);
/** The app's other menus (src/ui/menu.ts): toolbar, zoom and context menus. */
const appMenu = (page: Page) => page.locator('.menu:not(.mb-menu)');

const EN_TITLES = ['Preview', 'File', 'Edit', 'View', 'Go', 'Tools', 'Window', 'Help'];
const KO_TITLES = ['Preview', '파일', '편집', '보기', '이동', '도구', '윈도우', '도움말'];

test.describe('menus in Korean', () => {
  test('the menu bar switches live: titles re-render, an open menu closes, English comes back', async ({ page }) => {
    await open(page, 'simple.pdf');
    await expect(titles(page)).toHaveText(EN_TITLES, { useInnerText: true });
    await title(page, 'File').click();
    await expect(drop(page)).toHaveCount(1);

    await language(page, 'ko');
    await expect(drop(page)).toHaveCount(0);
    await expect(titles(page)).toHaveText(KO_TITLES, { useInnerText: true });
    await expect(page.locator('#menubar .mb-title.open, #menubar .mb-title.focused')).toHaveCount(0);
    await title(page, '파일').click();
    await expect(drop(page)).toHaveAttribute('aria-label', '파일');
    await expect(drop(page).locator('.mb-label')).toHaveText(['열기…', '윈도우 닫기', '저장', '다른 이름으로 저장…', '프린트…']);
    await page.keyboard.press('Escape');

    await language(page, 'system');
    await expect(titles(page)).toHaveText(EN_TITLES, { useInnerText: true });
    await title(page, 'File').click();
    await expect(drop(page).locator('.mb-label')).toHaveText(['Open…', 'Close Window', 'Save', 'Save As…', 'Print…']);
  });

  test('each menu lists its commands in Korean, at startup', async ({ page }) => {
    await startKorean(page);
    await open(page, 'simple.pdf');
    await expect(titles(page)).toHaveText(KO_TITLES, { useInnerText: true });
    const expected: Record<string, string[]> = {
      Preview: ['Preview에 관하여', '설정…', '윈도우 닫기'],
      파일: ['열기…', '윈도우 닫기', '저장', '다른 이름으로 저장…', '프린트…'],
      편집: ['실행 취소', '실행 복귀', '오려두기', '복사하기', '붙여넣기', '삭제', '복제', '모든 페이지 선택', '파일에서 페이지 삽입…', '찾기…'],
      보기: [
        '사이드바 보기', '축소판', '목차', '연속 스크롤', '두 페이지', '책 모드',
        '실제 크기', '폭 맞춤', '페이지 맞춤', '확대', '축소', '마크업 도구 막대 보기', '메뉴 막대',
      ],
      이동: ['이전 페이지', '다음 페이지', '첫 페이지', '마지막 페이지', '페이지로 이동…'],
      도구: [
        '왼쪽으로 회전', '오른쪽으로 회전', '텍스트 선택', '하이라이트', '밑줄', '취소선',
        '그리기', '선', '화살표', '사각형', '둥근 사각형', '타원', '텍스트', '메모',
      ],
      윈도우: ['최소화', '확대/축소'],
      도움말: ['키보드 단축키', 'Preview에 관하여'],
    };
    for (const [name, labels] of Object.entries(expected)) {
      await title(page, name).click();
      await expect(drop(page)).toHaveAttribute('aria-label', name);
      await expect(drop(page).locator('.mb-label')).toHaveText(labels);
      // Shortcuts stay as written, as on Korean Windows.
      if (name === '파일') await expect(item(page, '저장').locator('.mb-shortcut')).toHaveText('Ctrl+S');
      await page.keyboard.press('Escape');
      await expect(drop(page)).toHaveCount(0);
    }
  });

  test('every command has a Korean label, including the ones that change with state', async ({ page }) => {
    await open(page, 'simple.pdf');
    await language(page, 'ko');
    const r = await page.evaluate(() => {
      const { app, store } = (window as any).__pfw;
      const labels = () => Object.fromEntries(app.commands.all().map((c: any) => [c.id, app.commands.label(c.id)]));
      const closed = labels();
      store.set({ sidebarOpen: true, markupOpen: true });
      const opened = labels();
      return { closed, opened };
    });
    for (const [id, label] of Object.entries({ ...r.closed, ...r.opened })) expect(label, id).toMatch(/[가-힣]/);
    expect(r.closed['view.sidebar']).toBe('사이드바 보기');
    expect(r.opened['view.sidebar']).toBe('사이드바 가리기');
    expect(r.closed['view.markupToolbar']).toBe('마크업 도구 막대 보기');
    expect(r.opened['view.markupToolbar']).toBe('마크업 도구 막대 가리기');
  });

  test('access keys keep their English letters: a Korean title reads "파일(F)" while they are shown', async ({ page }) => {
    await startKorean(page);
    await open(page, 'simple.pdf');
    const file = titles(page).nth(1);
    await expect(file).toHaveText('파일', { useInnerText: true });
    await expect(file).toHaveAttribute('aria-keyshortcuts', 'Alt+F');

    // Holding Alt shows them.
    await page.keyboard.down('Alt');
    await expect(titles(page)).toHaveText(
      ['Preview', '파일(F)', '편집(E)', '보기(V)', '이동(G)', '도구(T)', '윈도우(W)', '도움말(H)'],
      { useInnerText: true },
    );
    expect(await file.locator('.mb-key').evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline');
    // The product name has its letter: underlined in place, no parentheses.
    expect(await titles(page).first().locator('.mb-key').innerText()).toBe('P');
    // Released alone it is a tap: the keyboard is in the bar, so they stay; a second tap leaves.
    await page.keyboard.up('Alt');
    await expect(titles(page).first()).toHaveClass(/focused/);
    await expect(file).toHaveText('파일(F)', { useInnerText: true });
    await page.keyboard.press('Alt');
    await expect(page.locator('#menubar .mb-title.focused')).toHaveCount(0);
    await expect(file).toHaveText('파일', { useInnerText: true });

    // Alt+F opens File from the keyboard, which keeps them shown.
    await page.keyboard.press('Alt+f');
    await expect(drop(page)).toHaveAttribute('aria-label', '파일');
    await expect(file).toHaveText('파일(F)', { useInnerText: true });
    await page.keyboard.press('ArrowRight');
    await expect(drop(page)).toHaveAttribute('aria-label', '편집');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(drop(page)).toHaveCount(0);
    await expect(file).toHaveText('파일', { useInnerText: true });

    // English titles never get the parentheses.
    await language(page, 'en');
    await page.keyboard.down('Alt');
    await expect(titles(page)).toHaveText(EN_TITLES, { useInnerText: true });
    await page.keyboard.press('f');
    await page.keyboard.up('Alt');
    await expect(drop(page)).toHaveAttribute('aria-label', 'File');
  });

  test('the toolbar\'s View and ⋯ menus, the zoom menu and the thumbnails\' context menu, both ways', async ({ page }) => {
    await open(page, 'simple.pdf');
    const labels = async (opener: () => Promise<void>, expected: string[]) => {
      await opener();
      await expect(appMenu(page).locator('.menu-label')).toHaveText(expected);
      await page.keyboard.press('Escape');
      await expect(appMenu(page)).toHaveCount(0);
    };
    const view = () => page.locator('[data-action="view-menu"]').click();
    const more = () => page.locator('#toolbar [data-action="more"]').click();
    const zoom = () => page.locator('[data-zoom-menu]').click();
    const context = async () => {
      await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: true, sidebarTab: 'thumbnails' }));
      await page.locator('#sidebar .thumb[data-page="1"]').click({ button: 'right' });
    };
    const presets = ['50%', '75%', '100%', '125%', '150%', '200%', '400%'];

    await language(page, 'ko');
    await labels(view, ['사이드바 보기', '축소판', '목차', '연속 스크롤', '두 페이지', '책 모드']);
    await labels(more, ['열기…', '저장', '다른 이름으로 저장…', '파일에서 페이지 삽입…', '실행 취소', '실행 복귀', 'Preview에 관하여']);
    await labels(zoom, ['폭 맞춤', '페이지 맞춤', ...presets]);
    await labels(context, ['오려두기', '복사하기', '붙여넣기', '삭제', '모두 선택', '파일에서 페이지 삽입…']);
    // The View menu reads the sidebar's state: open now.
    await labels(view, ['사이드바 가리기', '축소판', '목차', '연속 스크롤', '두 페이지', '책 모드']);

    await language(page, 'en');
    await labels(view, ['Hide Sidebar', 'Thumbnails', 'Table of Contents', 'Continuous Scroll', 'Two Pages', 'Book Mode']);
    await labels(more, ['Open…', 'Save', 'Save As…', 'Insert Pages from File…', 'Undo', 'Redo', 'About Preview']);
    await labels(zoom, ['Fit Width', 'Fit Page', ...presets]);
    await labels(context, ['Cut', 'Copy', 'Paste', 'Delete', 'Select All', 'Insert Pages from File…']);
  });

  test('Help › Keyboard Shortcuts lists Korean menus and commands with the keys as written', async ({ page }) => {
    await open(page, 'simple.pdf');
    await language(page, 'ko');
    await title(page, '도움말').click();
    await item(page, '키보드 단축키').click();
    const panel = page.getByRole('dialog', { name: '키보드 단축키' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('h3')).toHaveText(['Preview', '파일', '편집', '보기', '이동', '도구']);
    const row = panel.locator('.ks-row:has(.ks-label:text-is("열기…"))');
    await expect(row.locator('kbd kbd')).toHaveText(['Ctrl', 'O']);
    await expect(panel.locator('.ks-section:has(h3:text-is("파일")) .ks-label:text-is("윈도우 닫기")')).toHaveCount(1);
    await panel.getByRole('button', { name: '닫기' }).click();
    await expect(panel).toHaveCount(0);

    await language(page, 'en');
    await title(page, 'Help').click();
    await item(page, 'Keyboard Shortcuts').click();
    await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' }).locator('h3').nth(1)).toHaveText('File');
  });
});

test('the menu bar is announced in the UI language', async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent('fixtures/simple.pdf')}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  await expect(page.locator('#menubar')).toHaveAttribute('aria-label', 'Menu bar');
  await page.evaluate(() => (window as any).__pfw.app.settings.set({ language: 'ko' }));
  await expect(page.locator('#menubar')).toHaveAttribute('aria-label', '메뉴 막대');
  await page.evaluate(() => (window as any).__pfw.app.settings.set({ language: 'en' }));
  await expect(page.locator('#menubar')).toHaveAttribute('aria-label', 'Menu bar');
});
