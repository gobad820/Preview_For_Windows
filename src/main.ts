import { App } from './app';
import { browserPlatform } from './platform/browser';

const app = new App(browserPlatform(), document);
void app.start();
