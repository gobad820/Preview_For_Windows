# Preview for Windows — PDF viewer design

Date: 2026-10-26
Status: approved by goal directive (`/goal`), autonomous build

## Intent

A PDF viewer for Windows that feels like macOS Preview: opens instantly,
shows the document with no clutter, and gets out of the way. The user's
own words: "Windows에서 돌아가는 Preview처럼 빠르고 깔끔한 PDF 뷰어".

Windows has no built-in viewer that is both fast and quiet. Edge is a
browser, Acrobat is heavy, SumatraPDF is fast but looks dated. The goal is
Preview's combination: native window, sub-second open, clean chrome,
continuous scrolling, sidebar thumbnails, search, and sensible shortcuts.

## Goals

- Open a PDF in well under a second for typical documents; first visible
  page painted before the rest of the document is processed.
- Clean, Preview-like chrome: one slim toolbar, optional sidebar, no
  menus-of-menus. Light and dark theme follow Windows.
- Continuous vertical scroll with zoom (fit width, fit page, percentage,
  Ctrl+wheel, Ctrl+/−/0), rotation, page indicator with go-to.
- Sidebar: page thumbnails and document outline (table of contents).
- Text selection and copy; find in document (Ctrl+F) with highlights and
  next/previous.
- Open via file dialog, drag-and-drop onto the window, command-line
  argument (so "Open with" and double-click work once associated).
- Keyboard-driven: Preview-style shortcuts (Space / Shift+Space, arrows,
  PageUp/Down, Home/End, Ctrl+O, Ctrl+F, Ctrl+1/2/3 for zoom modes, Ctrl+L
  rotate, Ctrl+Shift+S toggle sidebar).
- Remember window size and last page/zoom per file (small local store).
- Ship as a single portable `.exe` plus an NSIS installer that registers
  the `.pdf` association as an option.

## Non-goals (v1)

- Annotation / markup, form filling, signing, page reordering, merging.
- Multi-tab or multi-window management inside one process; each launch
  is its own window.
- Printing beyond what the webview offers natively (Ctrl+P uses
  WebView2's print).
- Non-PDF formats (images, etc.). Preview does these; v1 does not.

## Anti-goals

- Electron-sized binaries or slow startup. If it takes two seconds to show
  the first page, it has failed regardless of features.
- Toolbar sprawl. Every control must earn its place.
- Any network access or telemetry.

## Constraints

- Development happens in WSL2 without sudo; Windows host has the WebView2
  runtime but no dev tools. Everything is cross-compiled from WSL with
  user-space toolchains (rustup, conda clang/lld, cargo-xwin, NSIS).
- Verification is layered: unit tests (Vitest) for viewer logic, headless
  Chromium (Playwright) for the UI, and a smoke launch of the real `.exe`
  on the Windows host via WSL interop with a PowerShell screenshot.

## How it gets made (decided)

- **Shell:** Tauri v2. Rust backend is thin: window creation, file read
  (zero-copy IPC response), file dialog, CLI argument / drag-drop
  forwarding, per-file state persistence, window state. Native Windows
  title bar is kept (Mica-free, standard) so it behaves like every other
  Windows app.
- **Renderer:** pdf.js (`pdfjs-dist`) running in WebView2. Rendering in
  the pdf.js worker; pages drawn to canvases at device pixel ratio with a
  text layer for selection and search.
- **Frontend:** Vite + TypeScript, no UI framework. Plain DOM with a small
  reactive store. CSS variables for theming; `prefers-color-scheme` drives
  light/dark.
- **Layout:** toolbar (sidebar toggle, page indicator "3 / 42", zoom
  control, rotate, search toggle), optional 200px left sidebar with
  Thumbnails / Outline tabs, main scroll area with pages centered on a
  neutral surface. Find bar slides in under the toolbar.
- **Performance strategy:** virtualised page list (only pages near the
  viewport are rendered; others are placeholders sized from page
  dimensions), render cache keyed by page+scale+rotation, cancel renders
  that scroll out of view, thumbnails rendered lazily at low scale,
  first page rendered before `numPages` worth of placeholders are
  populated.
- **Packaging:** `tauri build --runner cargo-xwin --target
  x86_64-pc-windows-msvc` producing the portable exe and an NSIS
  installer. App id `dev.sanghae.preview`.

## Left to the builder

- Exact iconography (inline SVG, Fluent-style strokes) and spacing.
- The store shape for per-file state and the window-state plugin choice.
- Whether thumbnails render via a second pdf.js document handle or the
  main one (either is acceptable if scrolling stays smooth).
