// Regenerates src-tauri/icons from src-tauri/icons/source: icon.svg (the lens and the eye) is
// rasterized at every size from 24 px up; icon-16.svg is a simplified drawing for 16 px.
// Usage: node scripts/make-icons.mjs   (needs Playwright's Chromium and python with Pillow)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src-tauri/icons/source');
const out = join(root, 'src-tauri/icons');
const tmp = mkdtempSync(join(tmpdir(), 'pfw-icons-'));
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of sizes) {
  const file = size === 16 ? 'icon-16.svg' : 'icon.svg';
  const svg = readFileSync(join(src, file), 'utf8').replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.waitForTimeout(100);
  await page.locator('svg').screenshot({ path: join(tmp, `${size}.png`), omitBackground: true });
}
await browser.close();
execFileSync(process.env.PYTHON ?? 'python3', [join(root, 'scripts/make-icons.py'), tmp, out], { stdio: 'inherit' });
