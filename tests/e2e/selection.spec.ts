import { expect, test } from '@playwright/test';

test('text selection is one even tint with no line-break boxes showing', async ({ page }) => {
  await page.goto('/?file=fixtures/simple.pdf');
  await page.waitForSelector('.page[data-page="1"] .textLayer span');
  const spans = page.locator('.page[data-page="1"] .textLayer span');
  const a = (await spans.nth(0).boundingBox())!;
  const b = (await spans.nth(3).boundingBox())!;
  await page.mouse.move(a.x + 4, a.y + a.height / 2);
  await page.mouse.down();
  await expect(page.locator('.page[data-page="1"] .textLayer')).toHaveClass(/selecting/);
  await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toContain('This is page 1');
  const styles = await page.evaluate(() => {
    const layer = document.querySelector('.page[data-page="1"] .textLayer')!;
    return {
      br: getComputedStyle(layer.querySelector('br')!, '::selection').backgroundColor,
      span: getComputedStyle(layer.querySelector('span')!, '::selection').backgroundColor,
      blend: getComputedStyle(layer).mixBlendMode,
      guard: !!layer.querySelector('.endOfContent'),
      selecting: layer.classList.contains('selecting'),
    };
  });
  expect(styles).toEqual({ br: 'rgba(0, 0, 0, 0)', span: 'rgb(179, 215, 255)', blend: 'multiply', guard: true, selecting: true });
  // Clicking elsewhere ends the selection and the guard steps back.
  await page.mouse.click(5, 300);
  await expect(page.locator('.page[data-page="1"] .textLayer')).not.toHaveClass(/selecting/);
});
