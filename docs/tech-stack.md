# Tech stack

Preview for Windows is a small native shell around a web UI: Rust and Tauri own the
window and the file system, Microsoft Edge WebView2 (already part of Windows) draws the
interface, and a TypeScript app reads, renders and writes PDFs with pdf.js and pdf-lib.
Everything is built on Linux (WSL2) and cross-compiled for Windows.

Versions are the ones locked in `package-lock.json` and `src-tauri/Cargo.lock` as of
release 0.4.0.

```
Preview.exe  (Rust, Tauri 2; about 7 MB, portable)
├─ native side, src-tauri/src/lib.rs (about 350 lines)
│    read and write files (atomic save), startup file argument, open/save dialogs,
│    window size and position, Mica backdrop, clipboard (pages between windows,
│    PDFs copied in Explorer), the system Malgun Gothic font for text boxes
└─ WebView2 (Edge's engine, shipped with Windows 10/11)
     └─ TypeScript app, src/ (about 11,000 lines, no UI framework)
          ├─ pdf.js          parse, render pages, text layer, search text, outline
          ├─ pdf-lib         save: reorder, delete and merge pages, write annotations
          └─ fontkit         subset Malgun Gothic into saved text boxes
```

## What ships

| Layer | Technology | Version | Role | License |
| --- | --- | --- | --- | --- |
| Shell | [Tauri](https://tauri.app) | 2.12.5 (CLI and JS API 2.12.4) | Window, IPC between UI and Rust, bundling | MIT / Apache-2.0 |
| Shell | Rust | 1.99.1 | The native side (`src-tauri/`) | MIT / Apache-2.0 |
| Shell plugins | tauri-plugin-dialog, tauri-plugin-window-state | 2.8.3, 2.5.0 | Open/Save dialogs; remembering window size and position | MIT / Apache-2.0 |
| Windows APIs | clipboard-win, windows-version | 5.4.3, 0.1.7 | Pages on the clipboard and files copied in Explorer; Mica only on Windows 11 (build 22000+) | BSL-1.0, MIT / Apache-2.0 |
| Web view | Microsoft Edge WebView2 | system | Draws the UI; not bundled, already on every current Windows 10/11 | Microsoft |
| UI | TypeScript, plain DOM | 7.0.2 | Components are TypeScript classes over the DOM with a small store (`src/store.ts`); every feature is a named command (`src/commands.ts`) | Apache-2.0 |
| PDF reading | [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 6.4.299 | Parsing, rendering, text layer, search text, outline; CMaps, standard fonts and wasm decoders are copied into the bundle, so nothing is fetched | Apache-2.0 |
| PDF writing | `@cantoo/pdf-lib` | 2.11.1 | Saving edited documents and annotations; a maintained pdf-lib fork that also reads encrypted files | MIT |
| Fonts in PDFs | `@cantoo/fontkit` | 2.0.12 | Subsets Malgun Gothic for text boxes (`@pdf-lib/fontkit` crashed on `malgun.ttf`) | MIT |
| UI font | Inter (variable) | bundled | Interface text, with Malgun Gothic for Hangul | SIL OFL 1.1 (`src/assets/fonts/OFL.txt`) |
| Menu bar font | Lucida Sans Unicode | system | The Mac OS X Lion menu bar and Settings window (Lion used Lucida Grande, which Windows does not have) | Microsoft, part of Windows |

Annotations are drawn by the app's own overlays and saved as standard PDF annotations
with appearance streams, so Acrobat, Edge, Chrome and Mac Preview show them as drawn.
The app marks its own annotations (`/PFW` model data, `/PFWAnnot` in the appearance
stream) so it can edit them again after reopening; annotations from other apps are shown
and kept but not edited.

## Why these choices

- **Tauri instead of Electron.** WebView2 is already on Windows, so the app does not
  carry a browser: the portable exe is about 7 MB and the installer about 4.6 MB.
- **pdf.js for reading.** It is the engine behind Firefox's viewer, renders
  progressively and cancellably, and gives a text layer for selection and search. Only
  pages near the viewport stay rendered, so a 300-page file scrolls like a short one.
- **pdf-lib for writing.** Saving rebuilds the document from the pages in their new
  order (from one or several files), keeps the outline and metadata, remaps internal
  links and writes annotations with appearance streams.
- **No UI framework.** The interface is a toolbar, a sidebar, a page view and a few
  menus and panels. Plain DOM keeps the bundle small and gives direct control over page
  virtualisation and rendering.
- **Cross-compiling from Linux.** Nothing has to be installed on Windows to build; the
  Windows host is only used to run and check the real exe.

## Build toolchain

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 24.18 | npm scripts, Vite, tests |
| Vite | 8.3.5 | Dev server and production bundle (target `chrome120`); serves test fixtures and pdf.js assets in dev |
| TypeScript | 7.0.2 | Type checking (`tsc --noEmit`) before every build |
| Rust + Cargo | 1.99.1 | The native side |
| cargo-xwin | 0.23.1 | Cross-compiling to `x86_64-pc-windows-msvc`; downloads the MSVC CRT and Windows SDK |
| clang-cl, lld-link, llvm-lib, llvm-rc | conda-forge | C toolchain and resource compiler for the MSVC target |
| NSIS (`makensis`) | conda-forge | Per-user installer that registers `.pdf` |

The release profile optimises for size: `opt-level = "s"`, LTO, one codegen unit,
stripped symbols, `panic = "abort"`. `scripts/build-windows.sh [--bundle]` runs the
whole build.

## Tests and verification

| Layer | Tool | What it covers |
| --- | --- | --- |
| Unit | Vitest 5.0.5 (499 tests, 29 files) | Layout and zoom math, search, shortcuts, page composition and undo history, outline remapping, annotation geometry, appearance streams, writer and reader, preferences, commands |
| End to end | Playwright 1.64.1 (242 tests) | The built app in headless Chromium through a browser platform shim (`src/platform/browser.ts`): opening, viewing, page editing, saving, markup, menus, dialogs. Each worktree runs on its own `PW_PORT` |
| Other viewers | PDFium via pypdfium2 (`scripts/pdfium-render.py`) | Saved annotations render in Chrome and Edge's engine where they were drawn, also on rotated pages |
| Real Windows | `scripts/cdp-windows.ps1` | Drives the real `Preview.exe` through WebView2's DevTools protocol with its own profile, without touching the user's desktop |
| Fixtures | reportlab (`scripts/make-fixtures.py`) | Mixed page sizes, 300 pages, outline, links, encrypted and broken files, a Korean document |

## Assets

| Asset | Source | License |
| --- | --- | --- |
| App icon | The author's lens-and-island artwork, `src-tauri/icons/source/logo.png`, cut into every size by `scripts/make-icons.py` | The author's |
| Splash (`src/assets/splash.jpg`) | Photo by Vincent Yap on Unsplash, name set in EB Garamond, rendered by `scripts/make-splash.mjs` | Unsplash License; EB Garamond SIL OFL 1.1 (dev dependency only, the font is not shipped) |
| Malgun Gothic | Read from `%WINDIR%\Fonts` at run time, never bundled | Microsoft, part of Windows |

## How the work is organised

Each feature starts as a design document (`docs/superpowers/specs/`) and a plan
(`docs/superpowers/plans/`). Shared interfaces ("contracts") land on `main` first; then
each feature is built on its own branch in an Orca worktree, often by agents working in parallel, reviewed, verified on real Windows and
merged back.
