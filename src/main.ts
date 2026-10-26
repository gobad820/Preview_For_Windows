import { App } from './app';
import { browserPlatform } from './platform/browser';
import { hardenWebview, isTauri, tauriPlatform } from './platform/tauri';

const tauri = isTauri();
if (tauri) hardenWebview(document);
const app = new App(tauri ? tauriPlatform() : browserPlatform(), document);
void app.start();
