import { App } from './app';
import { browserPlatform } from './platform/browser';
import { hardenWebview, isTauri, tauriPlatform, windowMaterial } from './platform/tauri';
import type { Platform } from './platform/types';

async function boot(): Promise<void> {
  let platform: Platform;
  if (isTauri()) {
    hardenWebview(document);
    platform = tauriPlatform(await windowMaterial());
  } else {
    platform = browserPlatform();
  }
  document.documentElement.dataset['material'] = platform.material;
  document.documentElement.dataset['host'] = isTauri() ? 'tauri' : 'browser';
  const app = new App(platform, document);
  await app.start();
}

void boot();
