import { defineConfig, type Plugin } from 'vite';
import { cpSync, createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

type Handler = (req: any, res: any, next: () => void) => void;

/** Serves files from `root` under the URL prefix `prefix` (dev and preview only). */
function staticDir(prefix: string, root: string, contentType: (file: string) => string): Handler {
  return (req, res, next) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (!url.startsWith(prefix)) return next();
    const file = normalize(join(root, url.slice(prefix.length)));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', contentType(file));
    createReadStream(file).pipe(res);
  };
}

/** Serves tests/fixtures at /fixtures in dev and preview only; never bundled. */
function fixtureServer(): Plugin {
  const handler = staticDir('/fixtures/', join(process.cwd(), 'tests', 'fixtures'), () => 'application/pdf');
  return {
    name: 'fixture-server',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'wasm'] as const;
const PDFJS_TYPES: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.pfb': 'application/x-font-type1',
  '.ttf': 'font/ttf',
};

/** Exposes pdf.js CMaps, standard fonts and wasm decoders at /pdfjs/* (served in dev, copied at build). */
function pdfjsAssets(): Plugin {
  const src = join(process.cwd(), 'node_modules', 'pdfjs-dist');
  const type = (file: string) => PDFJS_TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream';
  const handler = staticDir('/pdfjs/', src, type);
  const guard: Handler = (req, res, next) => {
    const dir = (req.url ?? '').split('/')[2] ?? '';
    return (PDFJS_DIRS as readonly string[]).includes(dir) ? handler(req, res, next) : next();
  };
  let outDir = 'dist';
  return {
    name: 'pdfjs-assets',
    configResolved(config) { outDir = config.build.outDir; },
    configureServer(server) { server.middlewares.use(guard); },
    configurePreviewServer(server) { server.middlewares.use(guard); },
    closeBundle() {
      for (const dir of PDFJS_DIRS) {
        cpSync(join(src, dir), join(process.cwd(), outDir, 'pdfjs', dir), { recursive: true });
      }
    },
  };
}

const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  publicDir: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [fixtureServer(), pdfjsAssets()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'chrome120', outDir: 'dist', sourcemap: false },
});
