# Menu bar and Settings — worker briefs

> Design: `docs/superpowers/specs/2026-10-27-menu-bar-and-settings-design.md` (read it first;
> your branch's section there is the task list). Contracts are on main in `bd60b4a`:
> `src/commands.ts`, `App.registerCommands()` / `App.openPreferences()` in `src/app.ts`,
> `menuBarVisible` in `src/store.ts`, the `#menubar` slot in `index.html`, the `--lion-*`
> tokens at the top of `src/styles.css`.

## Rules for both workers

- Setup: `npm ci` in your worktree. Gates before every commit: `npx tsc --noEmit`,
  `npx vitest run`, `PW_PORT=<your port> npx playwright test` (full suite, all green).
  Never use port 4173. Use TDD: failing test first.
- Commit on your branch only, with the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push, do not merge to
  main, do not bump the version, do not build the Windows exe (the coordinator merges,
  builds and checks on real Windows).
- Keep edits to shared files (`src/app.ts`, `src/store.ts`, `index.html`, `src/styles.css`,
  shared tests) small and additive; put your CSS in its own clearly headed section.
- Post progress on your Orca card at checkpoints:
  `orca worktree set --worktree active --comment "<short status>" --json`. When done, set
  `--workspace-status in-review`, and end with a short summary of what you built, what you
  tested and anything left open.
- Screenshots for visual review: launch Chromium with `--font-render-hinting=none`
  (see `scripts/screenshots.mjs`), otherwise small text shows false gaps. Lucida Grande and
  Lucida Sans Unicode are not installed in WSL; for a faithful look you may load
  `/mnt/c/Windows/Fonts/l_10646.ttf` (Lucida Sans Unicode) in a screenshot-only page, never
  bundle it.
- Lion reference: Mac OS X 10.7. Menu bar: light grey vertical gradient (about #f6f6f6 to
  #dcdcdc), 1 px darker bottom line, 13 px Lucida Grande, the app menu title bold. Open
  title and highlighted item: blue gradient (about #648af5 to #2b58df) with white text.
  Drop-down: near-white, 1 px translucent border, soft shadow, square top, about 5 px
  rounded bottom corners, 4 px vertical padding, items about 19 px tall with 20 px left
  inset for the check mark, shortcuts right-aligned in the same colour, disabled items
  grey, separators a 1 px light line with margins. Preference windows: grey gradient
  title bar with centred title, toolbar of 32 px icons with labels underneath, selected
  icon sitting in a darker pressed well, content on #ececec with right-aligned labels and
  Aqua-style pop-up buttons and check boxes. Lion has no dark mode: stay light in both
  themes.

## Worker `menubar` — PW_PORT 4411

Do the design's "Branch `menubar`" section. Also:
- The window keeps its own min/max/close buttons in the toolbar. The menu bar sits above
  the toolbar; its empty area is a drag region.
- Existing e2e tests that assume the toolbar is the top of the window may need small
  coordinate fixes now that the bar is visible by default; fix the tests, not by hiding
  the bar.
- Keyboard: Alt alone toggles keyboard focus on the bar only when pressed and released
  with no other key in between. Ctrl+Alt+S (sidebar) and AltGr must not trigger it, and
  the Korean 한/영 key (right Alt on Korean keyboards, `HangulMode` / `Lang1`) must not
  either. While a menu is open, Esc, arrows and Enter belong to the menu and must not
  reach the document, find bar or markup handlers.
- Text selection, annotation selection and page selection must survive opening and
  closing a menu (Edit › Copy must copy what was selected before the menu opened).

## Worker `preferences` — PW_PORT 4421

Do the design's "Branch `preferences`" section. Also:
- Migrate the existing `pfw.view` value (`src/state/prefs.ts`) into the new settings on
  first load, so a user's saved layout survives.
- The Window › "Show menu bar" setting reads and writes the store's `menuBarVisible`, so
  View › Menu Bar and the setting stay in sync; persist it.
- Ctrl+, opens Settings (add to `src/shortcuts.ts`), also from text fields is not needed.
- The Settings window is modal over the app window, focus stays inside it while open,
  and it returns focus where it was on close.
