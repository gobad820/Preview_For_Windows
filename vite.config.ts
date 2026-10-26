import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

/** Serves tests/fixtures at /fixtures in dev and preview only; never bundled. */
function fixtureServer(): Plugin {
  const root = join(process.cwd(), 'tests', 'fixtures');
  const handler = (req: any, res: any, next: () => void) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (!url.startsWith('/fixtures/')) return next();
    const file = normalize(join(root, url.slice('/fixtures/'.length)));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', 'application/pdf');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'fixture-server',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [fixtureServer()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'chrome120', outDir: 'dist', sourcemap: false },
});
