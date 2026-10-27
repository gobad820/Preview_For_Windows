import type { WindowControls } from '../platform/types';

/** Segoe Fluent Icons glyphs of the Windows caption buttons. */
const GLYPH = { minimize: '', maximize: '', restore: '', close: '' } as const;

/**
 * The window's minimize, maximize and close buttons. They belong in the top-right corner of the
 * window, so the app mounts them in whichever row is on top: the menu bar, or the toolbar while
 * the menu bar is hidden. The row they are in gets the `has-caption` class.
 */
export class WindowCaption {
  readonly el: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(controls: WindowControls) {
    const group = (this.el = document.createElement('div'));
    group.className = 'tb-caption';
    const make = (kind: 'minimize' | 'maximize' | 'close', label: string, run: () => Promise<void>) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset['window'] = kind;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.textContent = GLYPH[kind];
      b.addEventListener('click', () => void run());
      group.append(b);
      return b;
    };
    make('minimize', 'Minimize', () => controls.minimize());
    const max = make('maximize', 'Maximize', () => controls.toggleMaximize());
    make('close', 'Close', () => controls.close());

    const sync = (maximized: boolean) => {
      max.textContent = maximized ? GLYPH.restore : GLYPH.maximize;
      max.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
      max.title = maximized ? 'Restore Down' : 'Maximize';
    };
    this.unsubscribe = controls.onMaximizedChange(sync);
    void controls.isMaximized().then(sync, () => {});
  }

  /** Moves the buttons to the end of `row`. */
  mount(row: HTMLElement): void {
    if (this.el.parentElement === row && row.lastElementChild === this.el) return;
    this.el.parentElement?.classList.remove('has-caption');
    row.append(this.el);
    row.classList.add('has-caption');
  }

  destroy(): void {
    this.unsubscribe();
    this.el.parentElement?.classList.remove('has-caption');
    this.el.remove();
  }
}
