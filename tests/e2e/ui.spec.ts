import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__pfwUi && (window as any).__pfw?.store);
}

interface MenuSpec {
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  radio?: boolean;
  separator?: true;
}

/**
 * Opens a menu whose actions record their label in `window.__picked`; `window.__menuClosed`
 * turns true when the returned promise resolves.
 */
const showMenu = (page: Page, at: { x: number; y: number } | { rect: [number, number, number, number] }, specs: MenuSpec[]) =>
  page.evaluate(
    ({ at, specs }) => {
      const w = window as any;
      w.__picked = [];
      w.__menuClosed = false;
      const items = specs.map((s) =>
        s.separator ? 'separator' : { ...s, label: s.label!, action: () => w.__picked.push(s.label) },
      );
      const anchor = 'rect' in at ? new DOMRect(...at.rect) : at;
      void w.__pfwUi.showMenu(anchor, items).then(() => (w.__menuClosed = true));
    },
    { at, specs },
  );

const picked = (page: Page) => page.evaluate(() => (window as any).__picked as string[]);
const menuClosed = (page: Page) => page.evaluate(() => (window as any).__menuClosed as boolean);

const SAMPLE: MenuSpec[] = [
  { label: 'Alpha', shortcut: 'Ctrl+A' },
  { separator: true },
  { label: 'Beta', disabled: true },
  { label: 'Gamma', radio: true, checked: true },
  { label: 'Delta', radio: true, checked: false },
];

test.describe('menu', () => {
  test('exposes menu roles and checked state', async ({ page }) => {
    await boot(page);
    await showMenu(page, { x: 100, y: 100 }, SAMPLE);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Alpha', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Ctrl+A');
    await expect(menu.getByRole('menuitem', { name: 'Beta' })).toHaveAttribute('aria-disabled', 'true');
    await expect(menu.getByRole('menuitemradio', { name: 'Gamma' })).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByRole('menuitemradio', { name: 'Delta' })).toHaveAttribute('aria-checked', 'false');
    await expect(menu.getByRole('separator')).toHaveCount(1);
  });

  test('arrow keys skip separators and disabled items, wrap, and Enter activates', async ({ page }) => {
    await boot(page);
    await showMenu(page, { x: 100, y: 100 }, SAMPLE);
    const item = (name: string) => page.getByRole('menu').getByText(name, { exact: true }).locator('xpath=ancestor-or-self::*[@tabindex][1]');
    await page.keyboard.press('ArrowDown');
    await expect(item('Alpha')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('Gamma')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('Delta')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('Alpha')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(item('Delta')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await picked(page)).toEqual(['Delta']);
    await expect.poll(() => menuClosed(page)).toBe(true);
  });

  test('Escape closes without running an item and keeps app shortcuts from firing', async ({ page }) => {
    await boot(page);
    await showMenu(page, { x: 100, y: 100 }, SAMPLE);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await picked(page)).toEqual([]);
    await expect.poll(() => menuClosed(page)).toBe(true);
  });

  test('clicking an item runs it; disabled items do nothing', async ({ page }) => {
    await boot(page);
    await showMenu(page, { x: 100, y: 100 }, SAMPLE);
    // force: Playwright itself refuses to click aria-disabled items; the menu must ignore the click.
    await page.getByRole('menuitem', { name: 'Beta' }).click({ force: true });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitemradio', { name: 'Gamma' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await picked(page)).toEqual(['Gamma']);
  });

  test('a click outside closes the menu', async ({ page }) => {
    await boot(page);
    await showMenu(page, { x: 100, y: 100 }, SAMPLE);
    await page.mouse.click(700, 500);
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await picked(page)).toEqual([]);
    await expect.poll(() => menuClosed(page)).toBe(true);
  });

  test('closes when the window resizes', async ({ page }) => {
    await boot(page);
    await showMenu(page, { x: 100, y: 100 }, SAMPLE);
    await expect(page.getByRole('menu')).toBeVisible();
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('opens below an anchor, left-aligned, and stays inside the viewport', async ({ page }) => {
    await boot(page);
    await showMenu(page, { rect: [40, 10, 80, 28] }, SAMPLE);
    let box = (await page.getByRole('menu').boundingBox())!;
    expect(Math.round(box.x)).toBe(40);
    expect(box.y).toBeGreaterThanOrEqual(38);
    expect(box.y).toBeLessThanOrEqual(44);

    // Anchored at the bottom-right corner: flips above and shifts left.
    await showMenu(page, { rect: [1150, 770, 40, 24] }, SAMPLE);
    await expect(page.getByRole('menu')).toHaveCount(1);
    box = (await page.getByRole('menu').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1200);
    expect(box.y + box.height).toBeLessThanOrEqual(770);

    // A point near the bottom edge opens upward.
    await showMenu(page, { x: 600, y: 790 }, SAMPLE);
    box = (await page.getByRole('menu').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });
});

interface AlertSpec {
  title: string;
  message?: string;
  buttons: { label: string; value: string; primary?: boolean; cancel?: boolean }[];
  input?: { type: 'password' | 'text'; placeholder?: string; value?: string };
}

const showAlert = (page: Page, spec: AlertSpec) =>
  page.evaluate((spec) => {
    const w = window as any;
    w.__alertResult = undefined;
    void w.__pfwUi.showAlert(spec).then((r: unknown) => (w.__alertResult = r));
  }, spec);
/** Waits for the alert's entrance animation so its geometry is final. */
const settled = (page: Page) =>
  page.getByRole('alertdialog').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
const alertResult = (page: Page) => page.evaluate(() => (window as any).__alertResult);

const SAVE: AlertSpec = {
  title: 'Do you want to save the changes made to the document “a.pdf”?',
  message: 'Your changes will be lost if you don’t save them.',
  buttons: [
    { label: 'Save', value: 'save', primary: true },
    { label: 'Don’t Save', value: 'discard' },
    { label: 'Cancel', value: 'cancel', cancel: true },
  ],
};

const CONFIRM: AlertSpec = {
  title: 'Replace the document?',
  buttons: [
    { label: 'Replace', value: 'ok', primary: true },
    { label: 'Cancel', value: 'cancel', cancel: true },
  ],
};

test.describe('alert', () => {
  test('is a modal alertdialog with title and message, and returns the clicked value', async ({ page }) => {
    await boot(page);
    await showAlert(page, SAVE);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('heading')).toHaveText(SAVE.title);
    await expect(dialog).toContainText(SAVE.message!);
    await dialog.getByRole('button', { name: 'Don’t Save' }).click();
    await expect.poll(() => alertResult(page)).toEqual({ value: 'discard' });
    await expect(dialog).toHaveCount(0);
  });

  test('Escape returns the cancel value, without reaching the app', async ({ page }) => {
    await page.goto('/?file=fixtures/simple.pdf');
    await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
    await page.evaluate(() => (window as any).__pfw.findBar.open());
    await showAlert(page, SAVE);
    await page.keyboard.press('Escape');
    await expect.poll(() => alertResult(page)).toEqual({ value: 'cancel' });
    expect(await page.evaluate(() => (window as any).__pfw.store.get().findOpen)).toBe(true);
  });

  test('Enter returns the primary value even with another button focused', async ({ page }) => {
    await boot(page);
    await showAlert(page, SAVE);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => alertResult(page)).toEqual({ value: 'save' });
  });

  test('a password field is focused and its value is returned', async ({ page }) => {
    await boot(page);
    await showAlert(page, {
      title: '“secret.pdf” is password protected.',
      message: 'Enter the password to open it.',
      buttons: [
        { label: 'Open', value: 'open', primary: true },
        { label: 'Cancel', value: 'cancel', cancel: true },
      ],
      input: { type: 'password', placeholder: 'Password' },
    });
    const field = page.getByRole('alertdialog').locator('input');
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveAttribute('placeholder', 'Password');
    await expect(field).toBeFocused();
    await page.keyboard.type('hunter2');
    await page.keyboard.press('Enter');
    await expect.poll(() => alertResult(page)).toEqual({ value: 'open', input: 'hunter2' });
  });

  test('three buttons stack full width with the primary on top', async ({ page }) => {
    await boot(page);
    await showAlert(page, SAVE);
    await settled(page);
    const boxes = await Promise.all(
      ['Save', 'Don’t Save', 'Cancel'].map((name) => page.getByRole('button', { name, exact: true }).boundingBox()),
    );
    const [save, discard, cancel] = boxes.map((b) => b!);
    expect(save!.y).toBeLessThan(discard!.y);
    expect(discard!.y).toBeLessThan(cancel!.y);
    expect(Math.round(save!.width)).toBe(Math.round(cancel!.width));
    expect(Math.round(save!.x)).toBe(Math.round(cancel!.x));
  });

  test('two buttons sit side by side with the primary on the right', async ({ page }) => {
    await boot(page);
    await showAlert(page, CONFIRM);
    await settled(page);
    const replace = (await page.getByRole('button', { name: 'Replace' }).boundingBox())!;
    const cancel = (await page.getByRole('button', { name: 'Cancel' }).boundingBox())!;
    expect(Math.round(replace.y)).toBe(Math.round(cancel.y));
    expect(replace.x).toBeGreaterThan(cancel.x);
    expect(Math.round(replace.width)).toBe(Math.round(cancel.width));
  });

  test('Tab keeps focus inside the alert and the scrim blocks the window', async ({ page }) => {
    await boot(page);
    await showAlert(page, SAVE);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))).toBe(true);
    const hit = await page.evaluate(() => {
      const el = document.elementFromPoint(10, 10);
      return !!el?.closest('.alert-scrim');
    });
    expect(hit).toBe(true);
  });
});
