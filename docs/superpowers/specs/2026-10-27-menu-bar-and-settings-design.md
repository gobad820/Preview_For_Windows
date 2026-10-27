# In-window menu bar and Settings, Mac OS X Lion style — design and plan

Date: 2026-10-27
Status: approved by the user's request; built in parallel Orca worktrees
Builds on: v0.3.5 (Two Pages, Markup, splash)

## Intent

The user's words: "파일, 편집, 설정 … 이런 것들 그냥 창 안에 들어가게, 기능 추가할 수 있도록 할
것. 맥 스타일로, 맥북 라이온 그 시절 OS의 느낌과 폰트로." A classic menu bar (File, Edit,
View, …) inside the window, through which every feature is reachable and to which new
features are easy to add, plus a Settings window, both looking like Mac OS X Lion (10.7,
2011): light grey gradient bar, Lucida Grande, blue gradient highlight, rounded-bottom
drop-down menus, a Lion preferences window with an icon toolbar.

## Decided (contracts on main, commit after this document)

- **Commands** (`src/commands.ts`): every feature is a `Command` `{ id, label, shortcut?,
  enabled?, checked?, radio?, run }` registered on `app.commands` in
  `App.registerCommands()` (`src/app.ts`). Menus are lists of command ids, so adding a
  feature means registering one command and naming it in a menu. Ids registered today:
  `app.about`, `app.preferences`; `file.open|insertPages|save|saveAs|print|close`;
  `edit.undo|redo|cut|copy|paste|delete|duplicate|selectAll|find`;
  `view.sidebar|thumbnails|outline|continuous|twoPages|bookMode|actualSize|zoomIn|zoomOut|fitWidth|fitPage|rotateLeft|rotateRight|markupToolbar|menuBar`;
  `go.next|previous|first|last|page`;
  `tools.select|highlight|underline|strikeout|draw|line|arrow|rect|rounded|oval|text|note`;
  `window.minimize|zoom`.
- **Menu bar slot**: `<nav id="menubar" class="menubar" hidden>` above the unified toolbar;
  store field `menuBarVisible` (default `true`).
- **Lion tokens** in `:root` (`src/styles.css`): `--lion-font` (Lucida Grande, then
  Lucida Sans Unicode, which ships with Windows), bar gradient, menu background and border,
  selection gradient, text colours, window title-bar gradient. Lion had no dark mode: the
  menu bar, its menus and the Settings window stay light in both themes (my call).
- `App.openPreferences()` is a stub the Settings branch fills; `app.preferences` runs it
  (Ctrl+, in the menu).

## Branch `menubar` (agent)

1. `src/menubar/menus.ts`: the menu structure as data — titles with access keys and lists of
   command ids and separators: **Preview** (bold app menu: About Preview, Settings…,
   Close Window), **File**, **Edit**, **View**, **Go**, **Tools**, **Window**, **Help**
   (Keyboard Shortcuts, About Preview). Unit-test that every listed id is registered.
2. `src/menubar/menubar.ts`: renders the bar (22 px, Lion gradient, `--lion-font` 13–14 px,
   bold first title) and the drop-downs (square top attached to the bar, rounded bottom
   corners, Lion blue gradient highlight with white text, grey disabled items, check marks
   for `checked`, right-aligned shortcuts, separators). Labels, enabled and checked state are
   read from the commands each time a menu opens. Mac behaviour: click a title to open, then
   moving over other titles switches menus; click elsewhere or Esc closes. Windows
   behaviour: Alt alone focuses the bar, Alt+underlined letter opens a menu, arrows move,
   Enter runs, Esc closes. The empty part of the bar drags the window and a double-click
   maximizes (`data-tauri-drag-region`). Hidden when `menuBarVisible` is false (Alt still
   shows it while navigating).
3. Help › Keyboard Shortcuts: a Lion-style panel listing the shortcuts from the commands.
4. e2e: opening every menu, running a command from each menu with the real mouse, keyboard
   navigation, disabled items without a document, drag region attributes.

## Branch `preferences` (agent)

1. `src/settings/settings.ts`: a typed settings model persisted in localStorage
   (`pfw.settings`, defaults on garbage) with `onChange`. Settings that change behaviour:
   - General: default zoom for files without a remembered position (Fit Width, Fit Page,
     Actual Size); page layout (Continuous Scroll / Two Pages, Book Mode) — the existing
     `pfw.view` preference moves here; show the sidebar when a document opens; remember
     each file's last page and zoom (on by default; off clears and stops saving).
   - Markup: default highlight colour, default shape colour and line width, default text
     size (the markup state's defaults).
   - Window: show the menu bar (`menuBarVisible`).
2. `src/settings/panel.ts`: the Settings window inside the app window, Lion style: a title
   bar with a grey gradient, centred title and Lion close button; an icon toolbar
   (General, Markup, Window) with the selected tab pressed; content laid out like Lion
   preference panes (right-aligned labels, pop-up buttons, check boxes). Opens with
   `app.preferences` / Ctrl+, , closes with the close button or Esc; changes apply at once.
3. Wire into `App.openPreferences()`, the open flow (default zoom, sidebar) and the
   markup defaults; shortcut Ctrl+, in `src/shortcuts.ts`.
4. Unit tests for the model, e2e for each setting's effect.

## Constraints

- Same rules as before: TDD, own `PW_PORT` per worktree (menubar 4411, preferences 4421),
  commit only with tsc, Vitest and the full Playwright suite green, trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, no pushes.
- File ownership: menubar owns `src/menubar/`, the menu bar CSS section, Help's shortcuts
  panel; preferences owns `src/settings/`, the Settings CSS section, `src/state/prefs.ts`
  migration, `src/shortcuts.ts` (Ctrl+,). Both may add small, additive wiring in
  `src/app.ts`.

## Left to the builders

Exact Lion colours, gradients, icon drawings for the Settings toolbar, spacing, animation.
