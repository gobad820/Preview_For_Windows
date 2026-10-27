import { t } from '../i18n';
import type { WindowControls } from '../platform/types';
import type { Store, ViewerState } from '../store';

/** Segoe Fluent Icons glyphs of the Windows caption buttons. */
const GLYPH = { minimize: '', maximize: '', restore: '', close: '' } as const;

/**
 * The window's minimize, maximize and close buttons. They belong in the top-right corner of the
 * window, so the app mounts them in whichever row is on top: the menu bar, or the toolbar while
 * the menu bar is hidden. The row they are in gets the `has-caption` class.
 */
export class WindowCaption {
  readonly el: HTMLElement;
  private readonly unsubscribe: Array<() => void>;

  constructor(controls: WindowControls, store: Store<ViewerState>) {
    const group = (this.el = document.createElement('div'));
    group.className = 'tb-caption';
    const make = (kind: 'minimize' | 'maximize' | 'close', run: () => Promise<void>) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset['window'] = kind;
      b.textContent = GLYPH[kind];
      b.addEventListener('click', () => void run());
      group.append(b);
      return b;
    };
    const min = make('minimize', () => controls.minimize());
    const max = make('maximize', () => controls.toggleMaximize());
    const close = make('close', () => controls.close());

    let maximized = false;
    /** Glyphs, tooltips and names in the current UI language; maximize reads Restore while maximized. */
    const sync = () => {
      const label = (b: HTMLElement, name: string, title = name) => {
        b.setAttribute('aria-label', name);
        b.title = title;
      };
      label(min, t('chrome.win.minimize'));
      label(close, t('chrome.win.close'));
      max.textContent = maximized ? GLYPH.restore : GLYPH.maximize;
      if (maximized) label(max, t('chrome.win.restore'), t('chrome.win.restoreDown'));
      else label(max, t('chrome.win.maximize'));
    };
    const setMaximized = (m: boolean) => {
      maximized = m;
      sync();
    };
    this.unsubscribe = [controls.onMaximizedChange(setMaximized), store.select('locale', sync)];
    void controls.isMaximized().then(setMaximized, () => {});
  }

  /** Moves the buttons to the end of `row`. */
  mount(row: HTMLElement): void {
    if (this.el.parentElement === row && row.lastElementChild === this.el) return;
    this.el.parentElement?.classList.remove('has-caption');
    row.append(this.el);
    row.classList.add('has-caption');
  }

  destroy(): void {
    for (const u of this.unsubscribe) u();
    this.el.parentElement?.classList.remove('has-caption');
    this.el.remove();
  }
}
