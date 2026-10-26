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

## Second code review (fresh-context reviewer) and fixes

The reviewer probed every suspicion and found three critical issues, all fixed
in `fix: address the v0.2 code review` with tests that fail without the fix:

- edits made during a save were marked saved and lost; saves now write and
  mark the exact version they captured, and queue instead of being dropped;
- files restricted only by an owner password could not be saved or copied;
  they now open with the empty user password;
- deleted pages leaked into saved files through button and chained GoTo
  actions and form-field trees; every GoTo action is now detached and
  retargeted or removed, widgets leave the field tree, and a final
  mark-and-sweep removes anything unreachable.

Important fixes: Ctrl+S on an unedited file is a no-op; a file changed by
another program asks before being replaced; dragging the page in view keeps
it selected; cut deletes what it copied; paste waits for (or skips) the system
clipboard write; page keys only act in the thumbnail list; the window-state
plugin no longer restores the v0.1 native frame; URL outline entries and page
labels survive saving. Plus the minor items listed in that commit.

Verified on the real Windows host after the fixes: the changed-on-disk prompt
(Cancel keeps the other program's bytes, Replace writes, a later save does not
ask); an AES owner-password-only file opens without a prompt and saves; with
`decorated: true` in the saved window state, v0.1 gets a 71 px native frame and
v0.2 stays frameless (15 px of resize border).

## Not verified on Windows

- Native drag-and-drop from Explorer onto the sidebar (needs a real mouse drag; the same code path is covered with HTML5 drops in Playwright, and position conversion from physical to CSS pixels is untested on a scaled display).
- Title-bar drag, double-click maximize, snap layouts, and resizing from the window edges of the undecorated window.
- The native Save As dialog, and the NSIS installer.

## Known limitations

- Dragging thumbnails between two windows is not supported (copy and paste is).
- Interactive form fields lose their interactivity when saved (their appearance is kept).
- A saved copy of a password-protected file is not encrypted.
- Windows 11 snap layouts do not appear on the custom maximize button.
- Windows shutdown or logoff with unsaved edits does not prompt.
- Saving replaces the file by rename, so the original's ACLs and alternate data streams are not kept.
- A new window opens at the same position as the previous one.
