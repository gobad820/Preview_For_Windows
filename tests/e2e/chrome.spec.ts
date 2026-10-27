import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
}

/** Loads the empty window and waits until the app has booted. */
async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__pfw?.store);
}

const bg = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe('theme and type', () => {
  test('UI text is set in the bundled Inter at 13px', async ({ page }) => {
    await boot(page);
    const faces = await page.evaluate(async () => {
      const loaded = await document.fonts.load('13px Inter');
      return loaded.map((f) => ({ family: f.family.replace(/"/g, ''), status: f.status }));
    });
    expect(faces).toContainEqual({ family: 'Inter', status: 'loaded' });
    const body = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { family: s.fontFamily, size: s.fontSize };
    });
    expect(body.family.replace(/"/g, '')).toMatch(/^Inter,/);
    expect(body.size).toBe('13px');
  });

  test('light palette: calm gray document area under near-white chrome', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await boot(page);
    expect(await bg(page, '#viewer')).toBe('rgb(232, 232, 232)');
    expect(await bg(page, '#toolbar')).toBe('rgb(246, 246, 246)');
  });

  test('dark palette follows the OS and an explicit data-theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await boot(page);
    expect(await bg(page, '#viewer')).toBe('rgb(30, 30, 30)');
    expect(await bg(page, '#toolbar')).toBe('rgb(44, 44, 46)');
    await page.evaluate(() => (document.documentElement.dataset['theme'] = 'light'));
    expect(await bg(page, '#viewer')).toBe('rgb(232, 232, 232)');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => (document.documentElement.dataset['theme'] = 'dark'));
    expect(await bg(page, '#viewer')).toBe('rgb(30, 30, 30)');
  });

  test('mica turns chrome translucent and keeps the document area opaque', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, 'simple.pdf');
    await page.evaluate(() => {
      document.documentElement.dataset['material'] = 'mica';
      (window as any).__pfw.store.set({ sidebarOpen: true });
    });
    expect(await bg(page, '#toolbar')).toBe('rgba(246, 246, 246, 0.6)');
    expect(await bg(page, '#sidebar')).toBe('rgba(246, 246, 246, 0.6)');
    expect(await bg(page, 'body')).toBe('rgba(0, 0, 0, 0)');
    expect(await bg(page, '#viewer')).toBe('rgb(232, 232, 232)');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await bg(page, '#toolbar')).toBe('rgba(32, 32, 32, 0.55)');
    expect(await bg(page, '#viewer')).toBe('rgb(30, 30, 30)');
  });
});

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());

test.describe('unified toolbar', () => {
  test('is a 52px window drag region whose controls are not', async ({ page }) => {
    await open(page, 'simple.pdf');
    const bar = page.locator('#toolbar');
    expect((await bar.boundingBox())!.height).toBe(52);
    await expect(bar).toHaveAttribute('data-tauri-drag-region', '');
    await expect(page.locator('#toolbar .tb-title')).toHaveAttribute('data-tauri-drag-region', '');
    const draggableControls = await page.evaluate(
      () => document.querySelectorAll('#toolbar button[data-tauri-drag-region], #toolbar input[data-tauri-drag-region]').length,
    );
    expect(draggableControls).toBe(0);
  });

  test('without a document the title is Preview and the subtitle is hidden', async ({ page }) => {
    await boot(page);
    await expect(page.locator('[data-doc-title]')).toHaveText('Preview');
    await expect(page.locator('[data-doc-edited]')).toBeHidden();
    await expect(page.locator('.tb-subtitle')).toBeHidden();
    // The menu bar already says Preview right above it; the title only shows without the bar.
    await expect(page.locator('[data-doc-title]')).toBeHidden();
    await page.evaluate(() => (window as any).__pfw.store.set({ menuBarVisible: false }));
    await expect(page.locator('[data-doc-title]')).toBeVisible();
  });

  test('shows the file name, Page N of M and — Edited while dirty', async ({ page }) => {
    await open(page, '한글 문서.pdf');
    await expect(page.locator('[data-doc-title]')).toHaveText('한글 문서.pdf');
    const subtitle = page.locator('.tb-subtitle');
    await expect(subtitle).toBeVisible();
    await expect(subtitle).toContainText('Page');
    await expect(subtitle.locator('[data-page-total]')).toHaveText(String((await state(page)).numPages));
    await expect(subtitle.locator('input[data-page-input]')).toHaveValue('1');
    await expect(page.locator('[data-doc-edited]')).toBeHidden();
    await page.evaluate(() => (window as any).__pfw.store.set({ dirty: true }));
    await expect(page.locator('[data-doc-edited]')).toBeVisible();
    await expect(page.locator('[data-doc-edited]')).toHaveText('— Edited');
    await page.evaluate(() => (window as any).__pfw.store.set({ dirty: false }));
    await expect(page.locator('[data-doc-edited]')).toBeHidden();
  });

  test('zoom pill opens a radio menu that toggles closed from the pill', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 1.25));
    const pill = page.locator('[data-zoom-menu]');
    await expect(pill).toHaveText('125%');
    await pill.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio').locator('.menu-label')).toHaveText([
      'Fit Width', 'Fit Page', '50%', '75%', '100%', '125%', '150%', '200%', '400%',
    ]);
    await expect(menu.getByRole('menuitemradio', { name: '125%' })).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByRole('menuitemradio', { name: '100%' })).toHaveAttribute('aria-keyshortcuts', 'Ctrl+0');
    await expect(menu.getByRole('menuitemradio', { name: 'Fit Width' })).toHaveAttribute('aria-checked', 'false');
    await expect(pill).toHaveAttribute('aria-expanded', 'true');
    await pill.click();
    await expect(menu).toHaveCount(0);
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
  });

  test('the ⋯ button opens the App menu at the button', async ({ page }) => {
    await open(page, 'simple.pdf');
    const more = page.locator('#toolbar [data-action="more"]');
    await more.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Open…' })).toBeVisible();
    const b = (await more.boundingBox())!;
    const m = (await menu.boundingBox())!;
    expect(m.y).toBeGreaterThanOrEqual(b.y + b.height);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('the search button turns into a find field inside the toolbar', async ({ page }) => {
    await open(page, 'simple.pdf');
    const find = page.locator('#toolbar [data-action="find"]');
    await expect(page.locator('#toolbar #findbar')).toHaveCount(1);
    await expect(page.locator('#findbar')).toBeHidden();
    await find.click();
    await expect(page.locator('#findbar')).toBeVisible();
    await expect(find).toBeHidden();
    await expect(page.locator('#findbar input[data-find-input]')).toBeFocused();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const field = (await page.locator('#findbar .find-field').boundingBox())!;
    expect(Math.round(field.width)).toBe(220);
    expect(Math.round(field.height)).toBe(28);
    await page.keyboard.press('Escape');
    await expect(page.locator('#findbar')).toBeHidden();
    await expect(find).toBeVisible();
  });

  test('has no caption buttons in the browser', async ({ page }) => {
    await open(page, 'simple.pdf');
    await expect(page.locator('[data-window]')).toHaveCount(0);
  });

  test('caption buttons drive platform window controls', async ({ page }) => {
    // `?caption` gives the browser host window buttons that record what they were asked to do.
    await page.goto(`/?caption&file=${encodeURIComponent('fixtures/simple.pdf')}`);
    await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
    const buttons = page.locator('[data-window]');
    await expect(buttons).toHaveCount(3);
    expect(await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('data-window')))).toEqual([
      'minimize', 'maximize', 'close',
    ]);
    expect(await page.locator('[data-window="close"]').evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Segoe Fluent Icons');

    await page.locator('[data-window="minimize"]').click();
    await page.locator('[data-window="maximize"]').click();
    await page.locator('[data-window="close"]').click();
    expect(await page.evaluate(() => (window as any).__pfwWindowCalls)).toEqual(['minimize', 'toggleMaximize', 'close']);

    const max = page.locator('[data-window="maximize"]');
    await expect(max).toHaveAttribute('aria-label', 'Maximize');
    await page.evaluate(() => (window as any).__pfwSetMaximized(true));
    await expect(max).toHaveAttribute('aria-label', 'Restore');
    await expect(max).toHaveText('\uE923');
    await page.evaluate(() => (window as any).__pfwSetMaximized(false));
    await expect(max).toHaveText('\uE922');

    await page.locator('[data-window="close"]').hover();
    await expect.poll(() => page.locator('[data-window="close"]').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
      'rgb(196, 43, 28)',
    );
  });

  test('caption buttons sit in the window\'s top-right corner, in whichever row is on top', async ({ page }) => {
    await page.goto(`/?caption&file=${encodeURIComponent('fixtures/simple.pdf')}`);
    await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
    const corner = async () => {
      const b = (await page.locator('[data-window="close"]').boundingBox())!;
      return { right: Math.round(b.x + b.width), top: Math.round(b.y), width: b.width, height: b.height };
    };
    // With the menu bar: in it, the standard 46 x 32, and the toolbar keeps its own right margin.
    await expect(page.locator('#menubar [data-window]')).toHaveCount(3);
    expect(await corner()).toEqual({ right: 1200, top: 0, width: 46, height: 32 });
    await expect(page.locator('#menubar')).toHaveClass(/\bhas-caption\b/);
    await expect(page.locator('#toolbar')).not.toHaveClass(/\bhas-caption\b/);
    const search = (await page.locator('#toolbar [data-action="find"]').boundingBox())!;
    expect(1200 - (search.x + search.width)).toBe(10);

    // Menu bar hidden: the toolbar is on top, so they move there, as tall as it.
    await page.evaluate(() => (window as any).__pfw.store.set({ menuBarVisible: false }));
    await expect(page.locator('#toolbar [data-window]')).toHaveCount(3);
    expect(await corner()).toEqual({ right: 1200, top: 0, width: 46, height: 52 });
    await expect(page.locator('#toolbar')).toHaveClass(/\bhas-caption\b/);

    // Alt shows the bar over the toolbar without covering them; they still take the press.
    await page.keyboard.press('Alt');
    await expect(page.locator('#menubar')).toHaveClass(/\bpeek\b/);
    const peek = (await page.locator('#menubar').boundingBox())!;
    expect(peek).toMatchObject({ y: 0, height: 52, width: 1200 - 3 * 46 });
    const hit = await page.evaluate(() => {
      const b = document.querySelector('[data-window="close"]')!.getBoundingClientRect();
      return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.getAttribute('data-window');
    });
    expect(hit).toBe('close');
    await page.keyboard.press('Escape');

    // And back.
    await page.evaluate(() => (window as any).__pfw.store.set({ menuBarVisible: true }));
    await expect(page.locator('#menubar [data-window]')).toHaveCount(3);
    expect(await corner()).toEqual({ right: 1200, top: 0, width: 46, height: 32 });
  });

  test('the menu bar lines up with the toolbar under it', async ({ page }) => {
    await open(page, 'simple.pdf');
    const first = (await page.locator('#menubar .mb-title').first().boundingBox())!;
    const sidebar = (await page.locator('#toolbar [data-action="sidebar"]').boundingBox())!;
    expect(first.x).toBe(sidebar.x);
    // the title text starts where the sidebar icon does, give or take a pixel
    const textLeft = first.x + 8;
    const icon = (await page.locator('#toolbar [data-action="sidebar"] svg').boundingBox())!;
    expect(Math.abs(textLeft - icon.x)).toBeLessThanOrEqual(1.5);
    // vertically centred in its row
    expect(first.y + first.height / 2).toBe(16);
  });

  test('Settings opens below the title bar and toolbar', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.keyboard.press('Control+Comma');
    const win = (await page.locator('.settings-window').boundingBox())!;
    const toolbar = (await page.locator('#toolbar').boundingBox())!;
    expect(win.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height + 16);
  });

  test('fits a 480px window without overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 600 });
    await open(page, 'simple.pdf');
    const overflow = await page.locator('#toolbar').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBe(0);
    await expect(page.locator('[data-zoom-menu]')).toBeVisible();
    await expect(page.locator('[data-action="more"]')).toBeVisible();
  });
});

const style = (page: Page, selector: string, prop: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

async function openSidebar(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page, name);
  await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: true }));
  await page.waitForSelector('#sidebar .thumb[data-page="2"] canvas[data-rendered="true"]');
}

test.describe('sidebar look', () => {
  test('is 200px with a segmented Thumbnails | Contents control', async ({ page }) => {
    await openSidebar(page, 'outline.pdf');
    expect((await page.locator('#sidebar').boundingBox())!.width).toBe(200);
    const thumbs = page.locator('#sidebar [data-tab="thumbnails"]');
    const outline = page.locator('#sidebar [data-tab="outline"]');
    await expect(thumbs).toHaveText('Thumbnails');
    await expect(outline).toHaveText('Contents');
    await expect(thumbs).toHaveClass(/active/);
    expect(await style(page, '#sidebar .sidebar-tabs', 'background-color')).not.toBe('rgba(0, 0, 0, 0)');
    expect(await style(page, '#sidebar [data-tab="thumbnails"]', 'background-color')).toBe('rgb(255, 255, 255)');
    expect(await style(page, '#sidebar [data-tab="outline"]', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    const a = (await thumbs.boundingBox())!;
    const b = (await outline.boundingBox())!;
    expect(Math.round(a.width)).toBe(Math.round(b.width));
    expect(Math.round(a.y)).toBe(Math.round(b.y));
  });

  test('thumbnails are centered with a hairline and soft shadow, label underneath', async ({ page }) => {
    await openSidebar(page, 'simple.pdf');
    const panel = (await page.locator('#sidebar .sidebar-panel.thumbnails').boundingBox())!;
    const canvas = (await page.locator('#sidebar .thumb[data-page="1"] canvas').boundingBox())!;
    const label = (await page.locator('#sidebar .thumb[data-page="1"] .thumb-label').boundingBox())!;
    expect(Math.abs(canvas.x + canvas.width / 2 - (panel.x + panel.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(label.x + label.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThanOrEqual(1);
    expect(label.y).toBeGreaterThan(canvas.y + canvas.height);
    expect(await style(page, '#sidebar .thumb canvas', 'box-shadow')).toMatch(/rgba\(0, 0, 0, 0\.1\) 0px 0px 0px 1px/);
  });

  test('selection is an 8px highlight with an accent capsule while the sidebar has focus, gray otherwise', async ({ page }) => {
    await openSidebar(page, 'simple.pdf');
    await page.evaluate(() => document.querySelector('#sidebar .thumb[data-page="2"]')!.classList.add('selected'));
    const sel = '#sidebar .thumb[data-page="2"]';
    await page.locator('#viewer').focus();
    const ring = await style(page, `${sel} canvas`, 'box-shadow');
    expect(ring).toMatch(/0px 0px 0px 6px/);
    expect(await style(page, `${sel} canvas`, 'border-radius')).toBe('2px');
    const grayCapsule = await style(page, `${sel} .thumb-label`, 'background-color');
    expect(grayCapsule).not.toBe('rgba(0, 0, 0, 0)');
    expect(grayCapsule).not.toBe('rgb(0, 122, 255)');
    expect(Number.parseFloat(await style(page, `${sel} .thumb-label`, 'border-top-left-radius'))).toBeGreaterThanOrEqual(7);

    await page.locator(sel).focus();
    expect(await style(page, `${sel} .thumb-label`, 'background-color')).toBe('rgb(0, 122, 255)');
    expect(await style(page, `${sel} .thumb-label`, 'color')).toBe('rgb(255, 255, 255)');
  });

  test('the current page gets a subtle outline only when it is not selected', async ({ page }) => {
    await openSidebar(page, 'simple.pdf');
    // The selection follows the current page; select only page 2 so page 1 is current but not selected.
    await page.evaluate(() => {
      const editor = (window as any).__pfw.editor;
      editor.clickAt(1, { ctrl: true, shift: false });
      editor.clickAt(0, { ctrl: true, shift: false });
    });
    const current = '#sidebar .thumb.current';
    const plain = '#sidebar .thumb[data-page="3"]';
    expect(await style(page, `${current} canvas`, 'outline-style')).toBe('solid');
    expect(await style(page, `${current} canvas`, 'outline-offset')).toBe('5px');
    expect(await style(page, `${plain} canvas`, 'outline-style')).toBe('none');
    await page.evaluate(() => document.querySelector('#sidebar .thumb.current')!.classList.add('selected'));
    expect(await style(page, `${current} canvas`, 'outline-style')).toBe('none');
    expect(await style(page, `${current} canvas`, 'box-shadow')).toMatch(/0px 0px 0px 6px/);
  });

  test('drag states: dimmed source, insertion line and ghost stack with a count badge', async ({ page }) => {
    await openSidebar(page, 'simple.pdf');
    const geometry = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>('#sidebar .sidebar-panel.thumbnails')!;
      const thumb = list.querySelector<HTMLElement>('.thumb[data-page="2"]')!;
      thumb.classList.add('dragging');
      const line = document.createElement('div');
      line.className = 'drop-indicator';
      line.style.top = '100px';
      list.append(line);
      const hidden = getComputedStyle(line).display;
      line.classList.add('visible');
      const ls = getComputedStyle(line);
      const lr = line.getBoundingClientRect();
      const pr = list.getBoundingClientRect();

      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      for (let i = 0; i < 4; i++) {
        const img = document.createElement('img');
        img.width = 80;
        img.height = 110;
        ghost.append(img);
      }
      const count = document.createElement('span');
      count.className = 'drag-count';
      count.textContent = '4';
      ghost.append(count);
      ghost.style.left = '300px';
      ghost.style.top = '200px';
      document.body.append(ghost);
      const imgs = Array.from(ghost.querySelectorAll('img')).map((i) => i.getBoundingClientRect());
      return {
        opacity: getComputedStyle(thumb).opacity,
        hidden,
        shown: ls.display,
        position: ls.position,
        height: lr.height,
        radius: Number.parseFloat(ls.borderTopLeftRadius),
        background: ls.backgroundColor,
        insidePanel: lr.left >= pr.left && lr.right <= pr.right,
        offsetParentIsList: line.offsetParent === list,
        ghostPosition: getComputedStyle(ghost).position,
        ghostEvents: getComputedStyle(ghost).pointerEvents,
        dx: [imgs[1]!.x - imgs[0]!.x, imgs[2]!.x - imgs[0]!.x],
        dy: [imgs[1]!.y - imgs[0]!.y, imgs[2]!.y - imgs[0]!.y],
        fourthShown: getComputedStyle(ghost.querySelectorAll('img')[3]!).display !== 'none',
        badge: getComputedStyle(count).backgroundColor,
      };
    });
    expect(geometry).toMatchObject({
      opacity: '0.4',
      hidden: 'none',
      shown: 'block',
      position: 'absolute',
      height: 2,
      background: 'rgb(0, 122, 255)',
      insidePanel: true,
      offsetParentIsList: true,
      ghostPosition: 'fixed',
      ghostEvents: 'none',
      dx: [6, 12],
      dy: [6, 12],
      fourthShown: false,
      badge: 'rgb(255, 59, 48)',
    });
    expect(geometry.radius).toBeGreaterThanOrEqual(1);
  });

  test('contents rows are 24px with disclosure chevrons', async ({ page }) => {
    await openSidebar(page, 'outline.pdf');
    await page.locator('#sidebar [data-tab="outline"]').click();
    const row = page.locator('#sidebar .outline-row').first();
    expect((await row.boundingBox())!.height).toBe(24);
    await expect(row.locator('.outline-toggle')).toBeVisible();
  });
});

test.describe('window states', () => {
  test('empty window: the splash, title, blue Open… button and a hint', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await boot(page);
    const splash = page.locator('.empty-state .empty-splash');
    await expect(splash).toBeVisible();
    await expect.poll(() => splash.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(2000);
    const g = (await splash.boundingBox())!;
    expect(g.width).toBeLessThanOrEqual(600);
    expect(Math.abs(g.width / g.height - 10 / 7)).toBeLessThan(0.02);
    // A plain rectangle: no rounded corners.
    expect(await style(page, '.empty-state .empty-splash', 'border-radius')).toBe('0px');
    await expect(page.getByRole('heading', { name: 'Open a PDF' })).toBeVisible();
    const button = page.locator('.empty-state [data-action="open"]');
    await expect(button).toHaveText('Open…');
    expect(await style(page, '.empty-state [data-action="open"]', 'background-color')).toBe('rgb(0, 122, 255)');
    expect(await style(page, '.empty-state [data-action="open"]', 'color')).toBe('rgb(255, 255, 255)');
    await expect(page.locator('.empty-state .hint')).toBeVisible();
  });

  test('errors appear as a translucent toast at the top center with an icon', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.app.openPath('fixtures/broken.pdf'));
    const toast = page.locator('.error-banner');
    await expect(toast).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const box = (await toast.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 600)).toBeLessThanOrEqual(1);
    // Just under the toolbar, which sits under the menu bar.
    const bar = (await page.locator('#toolbar').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    expect(box.y).toBeLessThanOrEqual(bar.y + bar.height + 24);
    expect(await style(page, '.error-banner', 'border-top-left-radius')).toBe('10px');
    expect(await style(page, '.error-banner', 'backdrop-filter')).not.toBe('none');
    const bg = await style(page, '.error-banner', 'background-color');
    expect(bg).toMatch(/^rgba\(.*, 0\.\d+\)$/);
    const icon = await toast.evaluate((el) => {
      const s = getComputedStyle(el, '::before');
      return { content: s.content, width: s.width, mask: s.maskImage || s.webkitMaskImage };
    });
    expect(icon.content).not.toBe('none');
    expect(icon.width).toBe('16px');
    expect(icon.mask).toMatch(/^url\(/);
  });

  test('loading shows a Mac activity indicator', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).__pfw.store.set({ status: 'loading' }));
    await expect(page.locator('.loading-state')).toBeVisible();
    await expect(page.locator('.loading-state .spinner svg')).toBeVisible();
    expect(await style(page, '.loading-state .spinner', 'animation-name')).not.toBe('none');
  });

  test('the password prompt looks like a Mac alert', async ({ page }) => {
    await page.goto('/?file=fixtures/encrypted.pdf');
    const alert = page.getByRole('alertdialog');
    await expect(alert).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const box = (await alert.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 600)).toBeLessThanOrEqual(1);
    expect(await style(page, '.alert', 'border-top-left-radius')).toBe('12px');
    await expect(alert.locator('.alert-icon')).toBeVisible();
    const input = alert.locator('input.alert-input');
    await expect(input).toBeFocused();
    expect(await input.getAttribute('type')).toBe('password');
    const open = (await alert.getByRole('button', { name: 'Open' }).boundingBox())!;
    const cancel = (await alert.getByRole('button', { name: 'Cancel' }).boundingBox())!;
    const field = (await input.boundingBox())!;
    expect(field.y + field.height).toBeLessThan(open.y);
    expect(Math.round(open.y)).toBe(Math.round(cancel.y)); // two buttons side by side
    expect(open.x).toBeGreaterThan(cancel.x); // primary on the right, as on macOS
  });
});

test('About Preview shows the splash and the version, and closes with a click or Esc', async ({ page }) => {
  await boot(page);
  await page.click('[data-action="more"]');
  await page.getByRole('menuitem', { name: 'About Preview' }).click();
  const about = page.getByRole('dialog', { name: 'About Preview' });
  await expect(about).toBeVisible();
  await expect(about.locator('img')).toHaveJSProperty('complete', true);
  await expect(about).toContainText(/Version \d+\.\d+\.\d+/);
  expect(await about.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();
  await page.click('[data-action="more"]');
  await page.getByRole('menuitem', { name: 'About Preview' }).click();
  // A click right after a menu closes is swallowed by the menu (src/ui/menu.ts); click later.
  await page.waitForTimeout(700);
  await page.mouse.click(10, 400);
  await expect(about).toBeHidden();
});
