import { expect, test, type Page } from '@playwright/test';

// Korean UI for the window chrome: toolbar, title block, find bar, sidebar, empty window, markup
// toolbar and its menus and popovers, About, window buttons and the window title.

async function open(page: Page, name: string, query = '') {
  await page.goto(`/?${query}${query ? '&' : ''}file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
}

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__pfw?.store);
}

/** Starts the app in Korean, as a saved Settings › Language would. */
const startInKorean = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('pfw.settings', JSON.stringify({ language: 'ko' })));

const setLanguage = (page: Page, language: 'system' | 'en' | 'ko') =>
  page.evaluate((language) => (window as any).__pfw.app.settings.set({ language }), language);

/** "Page 3 of 12" as it reads: the subtitle's runs of text and its page field, one space between. */
const subtitle = (page: Page) =>
  page.locator('.tb-subtitle').evaluate((el) =>
    [...el.children].map((c) => (c instanceof HTMLInputElement ? c.value : c.textContent!.trim())).join(' '),
  );

/** Waits until page 1 is on screen and stopped moving. */
async function settle(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => {
        const r = document.querySelector('#viewer .page[data-page="1"]')!.getBoundingClientRect();
        return r.bottom <= window.innerHeight ? `${r.x},${r.y},${r.width},${r.height}` : '';
      });
      const stable = now !== '' && now === last;
      last = now;
      return stable;
    }, { intervals: [150] })
    .toBe(true);
}

const menuLabels = (page: Page) => page.$$eval('.menu .menu-label', (els) => els.map((e) => e.textContent));

/** Every piece of text of the chrome — text, tooltips, accessible names, placeholders — plus the window title. */
const chromeText = (page: Page) =>
  page.evaluate(() => {
    const roots = [
      '#toolbar',
      '#markupbar',
      '#sidebar .sidebar-tabs',
      '#sidebar .sidebar-panel',
      '.empty-state',
      '.loading-state',
      '.drop-overlay',
      '.tb-caption',
    ];
    const out: [string, string, string][] = [];
    for (const sel of roots) {
      for (const root of document.querySelectorAll(sel)) {
        for (const el of [root, ...root.querySelectorAll('*')]) {
          for (const a of ['title', 'aria-label', 'placeholder', 'alt']) {
            const v = el.getAttribute(a);
            if (v) out.push([sel, a, v]);
          }
          for (const n of el.childNodes) {
            const v = n.nodeType === Node.TEXT_NODE ? n.textContent!.trim() : '';
            if (v) out.push([sel, 'text', v]);
          }
        }
      }
    }
    out.push(['document', 'title', document.title]);
    return out;
  });

/** Words that stay as written in Korean: the brand, keys, units and the fixture's own text. */
const KEPT = /\b(Preview|Ctrl|Shift|Alt|Esc|Enter|PDF|pt|Chapter|Section|Appendix|outline\.pdf|simple\.pdf)\b/g;
const english = (texts: [string, string, string][]) => texts.filter(([, , v]) => /[A-Za-z]{2,}/.test(v.replace(KEPT, '')));

test.describe('Korean chrome', () => {
  test('switches live: text built before the switch updates, and English comes back', async ({ page }) => {
    await open(page, 'outline.pdf', 'caption');
    await page.evaluate(() => {
      const { store, viewer } = (window as any).__pfw;
      store.set({ sidebarOpen: true, markupOpen: true, dirty: true });
      viewer.setZoom('fit-width');
    });
    await expect(page.locator('#sidebar [data-tab="outline"]')).toBeEnabled();
    await page.locator('#sidebar [data-tab="outline"]').click();
    await page.locator('#toolbar [data-action="find"]').click();
    await page.locator('[data-find-input]').fill('Chapter');
    await expect(page.locator('[data-find-count]')).toHaveText(/^1 of \d+$/);
    const en = await chromeText(page);
    expect(await subtitle(page)).toBe('Page 1 of 6');

    await setLanguage(page, 'ko');
    const ko = await chromeText(page);
    expect(english(ko)).toEqual([]);
    expect(await subtitle(page)).toBe('1 / 6페이지');
    await expect(page.locator('.tb-subtitle input[data-page-input]')).toHaveAttribute('aria-label', '페이지 번호');
    await expect(page.locator('[data-doc-edited]')).toHaveText('— 편집됨');
    await expect(page).toHaveTitle('outline.pdf — 편집됨');
    await expect(page.locator('[data-zoom-menu] .tb-pill-label')).toHaveText('폭 맞춤');
    await expect(page.locator('[data-zoom-menu]')).toHaveAttribute('title', /^확대\/축소: \d+%$/);
    await expect(page.locator('#toolbar [data-action="sidebar"]')).toHaveAttribute('title', '사이드바 (Ctrl+Alt+S)');
    await expect(page.locator('#toolbar [data-action="markup"]')).toHaveAttribute('title', '마크업 도구 막대 보기 (Ctrl+Shift+A)');
    await expect(page.locator('[data-find-input]')).toHaveAttribute('placeholder', '검색');
    await expect(page.locator('[data-find-count]')).toHaveText(/^1\/\d+$/);
    await expect(page.locator('#sidebar [data-tab="thumbnails"]')).toHaveText('축소판');
    await expect(page.locator('#sidebar [data-tab="outline"]')).toHaveText('목차');
    await expect(page.locator('#sidebar .thumb[data-page="2"]')).toHaveAttribute('aria-label', '2페이지');
    await expect(page.getByRole('button', { name: 'Chapter 1 접기' })).toBeVisible();
    await expect(page.locator('#markupbar [data-markup="select"]')).toHaveAttribute('title', '텍스트 선택');
    await expect(page.locator('#markupbar [data-markup="stroke"]')).toHaveAttribute('aria-label', '테두리 색상');
    await expect(page.locator('[data-window="minimize"]')).toHaveAttribute('title', '최소화');
    await expect(page.locator('.empty-state h1')).toHaveText('PDF 열기');

    // A count that is not on screen yet still comes out in the language of the moment.
    await page.locator('[data-find-input]').fill('zzzz');
    await expect(page.locator('[data-find-count]')).toHaveText('결과 없음');
    await page.locator('[data-find-input]').fill('Chapter');
    await expect(page.locator('[data-find-count]')).toHaveText(/^1\/\d+$/);

    await setLanguage(page, 'en');
    expect(await chromeText(page)).toEqual(en);
    expect(await subtitle(page)).toBe('Page 1 of 6');
  });

  test('a Korean start shows the empty window in Korean', async ({ page }) => {
    await startInKorean(page);
    await boot(page);
    await expect(page.getByRole('heading', { name: 'PDF 열기' })).toBeVisible();
    await expect(page.locator('.empty-state [data-action="open"]')).toHaveText('열기…');
    await expect(page.locator('.empty-state .hint')).toContainText('또는 파일을 여기로 드래그');
    await expect(page.locator('.loading-state')).toHaveText('여는 중…');
    await expect(page.locator('.drop-overlay span')).toHaveText('놓아서 열기');
    await expect(page.locator('[data-doc-title]')).toHaveText('Preview');
    await expect(page).toHaveTitle('Preview');
    expect(english(await chromeText(page))).toEqual([]);
  });

  test('a Korean start titles a document without an outline and its thumbnails in Korean', async ({ page }) => {
    await startInKorean(page);
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: true }));
    await expect(page.locator('#sidebar [data-tab="outline"]')).toHaveAttribute('title', '목차 없음');
    await expect(page.locator('#sidebar .outline-empty')).toHaveText('목차 없음');
    await expect(page.locator('#sidebar .sidebar-panel.thumbnails')).toHaveAttribute('aria-label', '페이지');
    expect(await subtitle(page)).toBe('1 / 3페이지');
    await expect(page.locator('[data-zoom-menu] .tb-pill-label')).toHaveText(/^(\d+%|폭 맞춤|페이지 맞춤)$/);
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('fit-page'));
    await expect(page.locator('[data-zoom-menu] .tb-pill-label')).toHaveText('페이지 맞춤');
    await page.locator('#toolbar [data-action="find"]').click();
    await expect(page.locator('[data-find-input]')).toHaveAttribute('aria-label', '문서에서 찾기');
    await expect(page.locator('[data-action="find-next"]')).toHaveAttribute('title', '다음 결과 (Enter)');
    await expect(page.locator('[data-action="find-close"]')).toHaveAttribute('title', '완료 (Esc)');
    expect(english(await chromeText(page))).toEqual([]);
  });

  test('the subtitle starts flush with the file name in either word order', async ({ page }) => {
    await open(page, 'long300.pdf');
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(41));
    await expect(page.locator('[data-page-input]')).toHaveValue('42');
    /** Left edge of the subtitle's first glyph minus the file name's: the page field's digits are centred in it. */
    const indent = () =>
      page.evaluate(() => {
        const title = document.querySelector('[data-doc-title]')!.getBoundingClientRect().left;
        const first = document.querySelector('.tb-subtitle')!.firstElementChild as HTMLElement;
        const r = first.getBoundingClientRect();
        if (!(first instanceof HTMLInputElement)) return r.left - title;
        const probe = document.createElement('span');
        probe.style.font = getComputedStyle(first).font;
        probe.textContent = first.value;
        document.body.append(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return r.left + (r.width - width) / 2 - title;
      });
    expect(Math.abs(await indent())).toBeLessThan(1);
    await setLanguage(page, 'ko');
    expect(Math.abs(await indent())).toBeLessThan(1);
  });

  test('markup menus and popovers read their labels in Korean', async ({ page }) => {
    await open(page, 'simple.pdf');
    await setLanguage(page, 'ko');
    await page.evaluate(() => (window as any).__pfw.store.set({ markupOpen: true }));

    await page.locator('[data-markup="shapes"]').click();
    expect(await menuLabels(page)).toEqual(['선', '화살표', '사각형', '둥근 사각형', '타원']);
    await page.keyboard.press('Escape');

    await page.locator('[data-markup="highlight-menu"]').click();
    expect(await menuLabels(page)).toEqual(['노란색', '초록색', '파란색', '분홍색', '보라색', '밑줄', '취소선']);
    await page.keyboard.press('Escape');

    await page.locator('[data-markup="width"]').click();
    expect(await menuLabels(page)).toEqual(['0.5 pt', '1 pt', '2 pt', '3 pt', '5 pt', '8 pt']);
    await page.keyboard.press('Escape');

    await page.locator('[data-markup="stroke"]').click();
    const palette = page.locator('.markup-palette');
    await expect(palette).toHaveAttribute('aria-label', '테두리 색상');
    expect(await palette.locator('[data-color]').evaluateAll((els) => els.map((e) => e.getAttribute('title')))).toEqual([
      '검은색', '회색', '흰색', '갈색', '빨간색', '주황색', '노란색', '초록색', '청록색', '파란색', '보라색', '분홍색',
    ]);
    await expect(palette.locator('[data-color="#ff3b30"]')).toHaveAttribute('aria-label', '빨간색');
    await page.keyboard.press('Escape');

    await page.locator('[data-markup="fill"]').click();
    await expect(palette).toHaveAttribute('aria-label', '채우기 색상');
    await expect(palette.locator('[data-no-fill]')).toHaveText('채우기 없음');
    await page.keyboard.press('Escape');

    await page.locator('[data-markup="text-style"]').click();
    await expect(palette).toHaveAttribute('aria-label', '텍스트 스타일');
    await expect(palette.locator('.palette-size-label')).toHaveText('크기');
    await expect(palette.locator('[data-size-step="1"]')).toHaveAttribute('aria-label', '크게');
    await expect(palette.locator('[data-size-step="-1"]')).toHaveAttribute('aria-label', '작게');
    await expect(palette.locator('[data-font-size]')).toHaveText('12 pt');
    await page.keyboard.press('Escape');

    // The toolbar's own highlight menu is the same list.
    await page.locator('#toolbar [data-action="highlight-menu"]').click();
    expect(await menuLabels(page)).toEqual(['노란색', '초록색', '파란색', '분홍색', '보라색', '밑줄', '취소선']);
    await page.keyboard.press('Escape');

    await setLanguage(page, 'en');
    await page.locator('[data-markup="shapes"]').click();
    expect(await menuLabels(page)).toEqual(['Line', 'Arrow', 'Rectangle', 'Rounded Rectangle', 'Oval']);
  });

  test('new text boxes and notes, and the annotation menu, are in Korean', async ({ page }) => {
    await open(page, 'simple.pdf');
    await setLanguage(page, 'ko');
    await page.evaluate(() => {
      (window as any).__pfw.store.set({ markupOpen: true });
      (window as any).__pfw.viewer.setZoom('fit-page');
    });
    await settle(page);
    const at = async (fx: number, fy: number) => {
      const r = (await page.locator('#viewer .page[data-page="1"]').boundingBox())!;
      return { x: r.x + r.width * fx, y: r.y + r.height * fy };
    };

    await page.click('[data-markup="text"]');
    let c = await at(0.25, 0.3);
    await page.mouse.click(c.x, c.y);
    const editor = page.locator('#viewer .mk-text-editor');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('텍스트');
    await expect(editor).toHaveAttribute('aria-label', '텍스트 상자');
    c = await at(0.8, 0.9);
    await page.mouse.click(c.x, c.y);
    await expect(editor).toHaveCount(0);

    // Right-click the kept text box for its menu.
    const box = (await page.locator('#viewer .markup-overlay .mk-text').boundingBox())!;
    await page.mouse.click(box.x + 4, box.y + box.height / 2, { button: 'right' });
    expect(await menuLabels(page)).toEqual(['텍스트 편집', '복제', '삭제']);
    await page.keyboard.press('Escape');

    await page.click('[data-markup="note"]');
    c = await at(0.6, 0.5);
    await page.mouse.click(c.x, c.y);
    const note = page.locator('.mk-note-popup textarea');
    await expect(note).toBeFocused();
    await expect(note).toHaveAttribute('placeholder', '메모');
    await expect(note).toHaveAttribute('aria-label', '메모');
  });

  test('About and the window buttons are in Korean, and the buttons follow a live switch', async ({ page }) => {
    await startInKorean(page);
    await open(page, 'simple.pdf', 'caption');
    const max = page.locator('[data-window="maximize"]');
    await expect(page.locator('[data-window="close"]')).toHaveAttribute('aria-label', '닫기');
    await expect(max).toHaveAttribute('title', '최대화');
    await page.evaluate(() => (window as any).__pfwSetMaximized(true));
    await expect(max).toHaveAttribute('title', '이전 크기로 복원');
    await expect(max).toHaveAttribute('aria-label', '이전 크기로 복원');
    await setLanguage(page, 'en');
    await expect(max).toHaveAttribute('title', 'Restore Down');
    await expect(max).toHaveAttribute('aria-label', 'Restore');
    await expect(page.locator('[data-window="minimize"]')).toHaveAttribute('title', 'Minimize');
    await setLanguage(page, 'ko');
    await expect(max).toHaveAttribute('title', '이전 크기로 복원');

    await page.evaluate(() => (window as any).__pfw.app.commands.run('app.about'));
    const about = page.locator('.about');
    await expect(about).toHaveAttribute('aria-label', 'Preview에 관하여');
    await expect(about.locator('img')).toHaveAttribute('alt', 'Windows용 Preview');
    await expect(about.locator('.about-caption span').first()).toHaveText(/^버전 \S+ · 사진: Vincent Yap, Unsplash$/);
    await expect(about.locator('.about-caption span').last()).toHaveText('PDF 뷰어 및 편집기. 네트워크 연결 및 원격 분석 없음.');
  });
});
