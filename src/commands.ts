/**
 * Every user-facing feature as a named command. Menus (the in-window menu bar, toolbar menus,
 * context menus) are lists of command ids, so adding a feature to the app means registering one
 * command and naming it in a menu.
 */

export interface Command {
  /** Stable id, `area.name` (e.g. `file.save`, `view.zoomIn`). */
  readonly id: string;
  /** Menu text; a function when it changes with state (e.g. Show / Hide Sidebar). */
  readonly label: string | (() => string);
  /** Shown right-aligned in menus, Windows notation (`Ctrl+Shift+S`). Display only. */
  readonly shortcut?: string;
  /** False greys the item out; absent means always enabled. */
  readonly enabled?: () => boolean;
  /** Present for toggles and choices: whether the item shows a check mark. */
  readonly checked?: () => boolean;
  /** Choices in a group show a radio-style check. */
  readonly radio?: boolean;
  run(): void;
}

export class Commands {
  private readonly byId = new Map<string, Command>();

  register(...commands: Command[]): void {
    for (const c of commands) {
      if (this.byId.has(c.id)) throw new Error(`command ${c.id} is registered twice`);
      this.byId.set(c.id, c);
    }
  }

  get(id: string): Command | undefined {
    return this.byId.get(id);
  }

  label(id: string): string {
    const c = this.byId.get(id);
    if (!c) return id;
    return typeof c.label === 'function' ? c.label() : c.label;
  }

  isEnabled(id: string): boolean {
    const c = this.byId.get(id);
    return !!c && (c.enabled?.() ?? true);
  }

  /** Runs the command when it exists and is enabled; true when it ran. */
  run(id: string): boolean {
    const c = this.byId.get(id);
    if (!c || !(c.enabled?.() ?? true)) return false;
    c.run();
    return true;
  }

  all(): Command[] {
    return [...this.byId.values()];
  }
}
