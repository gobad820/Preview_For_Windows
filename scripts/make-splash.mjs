// Renders scripts/splash/splash.html to src/assets/splash.jpg (2000 x 1400, the 1000 x 700
// layout at 2x). The name is scaled to fill its data-width once the font has loaded.
// Usage: node scripts/make-splash.mjs   (needs Playwright's Chromium)
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
await page.goto(`file://${root}scripts/splash/splash.html`);
await page.evaluate(async () => {
  await document.fonts.ready;
  for (const el of document.querySelectorAll('[data-width]')) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = `${(size * Number(el.dataset.width)) / el.getBoundingClientRect().width}px`;
  }
});
await page.locator('.card').screenshot({ path: `${root}src/assets/splash.jpg`, type: 'jpeg', quality: 88 });
await browser.close();
console.log('wrote src/assets/splash.jpg');
