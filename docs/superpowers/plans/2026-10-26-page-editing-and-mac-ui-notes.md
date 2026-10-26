# Page editing and Mac UI — verification notes (2026-10-26)

Companion to `2026-10-26-page-editing-and-mac-ui.md`.

## Verified in the browser (Vitest + Playwright)

| Area | Evidence |
| --- | --- |
| Composition, history, selection, outline remap, shortcuts | unit tests (`tests/unit/{composition,history,selection,outlineRemap,shortcuts}.test.ts`) |
| PDF writer | `tests/unit/writer.test.ts`: reorder, delete without orphan page objects, merge of mixed sizes and Korean fonts, links retargeted or dropped for explicit and named destinations and GoTo actions, outline written, decryption, duplicate pages, metadata |
| Editable document | `tests/unit/editable.test.ts`: apply/undo/redo/dirty, sizes follow edits, merge + save round trip, outline follows edits, encrypted save |
| Sidebar editing | `tests/e2e/editing.spec.ts`: click/Ctrl/Shift/arrow/Ctrl+A selection, drag to top / to end / into own gap / Esc, Delete + undo/redo + saved state, last page protection, copy/cut/paste, paste from another window, merge by drop at a gap, password-protected merge, Ctrl+S, Save As, context menu, Insert Pages from File, close and replace prompts, outline and search follow edits, element reuse with no duplicate page elements |
| Mac UI | `tests/e2e/{chrome,ui}.spec.ts` (agent-written) and screenshots in `docs/screenshots/` |
| Text selection | `tests/e2e/selection.spec.ts` |
| Save speed | 302-page edited + merged document saves in 50–85 ms in Node |

## Verified on the real Windows host (`scripts/cdp-windows.ps1`)

Driven through WebView2 DevTools with an isolated profile, no clicks or keys:

- Window chrome: `data-host=tauri`, Mica applied, caption buttons and drag regions present, Inter loaded, translucent toolbar.
- Open, merge `mixed.pdf` at gap 1, delete page 1, save over the file: the file on disk has the five expected pages in order with original page sizes; no `.preview-tmp` left behind.
- Korean file name: reorder and save in place; copy written to a path containing a space.
- Clipboard: copying pages put `Copied Pages.pdf` on the Windows clipboard as a file; the window recognised its own copy; a PDF placed on the clipboard by another app pasted in as pages. The user's clipboard (8 formats) was backed up and restored.
- `open_window` spawned a second Preview process.
- Close with unsaved changes: the Mac-style alert appeared with the file name; "Don't Save" closed the window and the process exited.
- Rust unit tests (path decoding, atomic write) run as a Windows test executable.

## Not verified on Windows

- Native drag-and-drop from Explorer onto the sidebar (needs a real mouse drag; the same code path is covered with HTML5 drops in Playwright, and position conversion from physical to CSS pixels is untested on a scaled display).
- Title-bar drag, double-click maximize, snap layouts, and resizing from the window edges of the undecorated window.
- The native Save As dialog, and the NSIS installer.

## Known limitations

- Dragging thumbnails between two windows is not supported (copy and paste is).
- Interactive form fields lose their interactivity when saved (their appearance is kept).
- A saved copy of a password-protected file is not encrypted.
- Windows 11 snap layouts do not appear on the custom maximize button.
