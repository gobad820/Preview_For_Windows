import { t } from '../i18n';
import { closeMenus } from './menu';

export interface AlertButton {
  label: string;
  value: string;
  primary?: boolean;
  cancel?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: string;
  /** Defaults to a single OK button that Enter and Esc both press. */
  buttons?: AlertButton[];
  input?: { type: 'password' | 'text'; placeholder?: string; value?: string };
}

/** Open alerts, newest last; only the newest handles keys. */
const stack: HTMLElement[] = [];
let seq = 0;

/** Keys an alert lets through to a focused text field (editing and clipboard). */
const FIELD_CHORDS = new Set(['a', 'c', 'v', 'x', 'z', 'y']);

/**
 * Mac-style modal alert: app icon, bold title, message, optional text field, and buttons that
 * stack full width when there are three or more (primary first) or sit side by side otherwise
 * (primary on the right). Esc → the cancel button's value; Enter → the primary button's value.
 */
export function showAlert(opts: AlertOptions): Promise<{ value: string; input?: string }> {
  closeMenus();
  const specs = opts.buttons ?? [{ label: t('dlg.ok'), value: 'ok', primary: true, cancel: true }];
  return new Promise((resolve) => {
    const id = `pfw-alert-${++seq}`;
    const previousFocus = document.activeElement;
    const scrim = document.createElement('div');
    scrim.className = 'alert-scrim';
    const alert = document.createElement('div');
    alert.className = 'alert';
    alert.setAttribute('role', 'alertdialog');
    alert.setAttribute('aria-modal', 'true');
    alert.setAttribute('aria-labelledby', `${id}-title`);

    const icon = document.createElement('div');
    icon.className = 'alert-icon';
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('h2');
    title.className = 'alert-title';
    title.id = `${id}-title`;
    title.textContent = opts.title;
    alert.append(icon, title);
    if (opts.message) {
      const message = document.createElement('p');
      message.className = 'alert-message';
      message.id = `${id}-message`;
      message.textContent = opts.message;
      alert.setAttribute('aria-describedby', message.id);
      alert.append(message);
    }

    let field: HTMLInputElement | null = null;
    if (opts.input) {
      field = document.createElement('input');
      field.className = 'alert-input';
      field.type = opts.input.type;
      field.autocomplete = 'off';
      field.spellcheck = false;
      field.placeholder = opts.input.placeholder ?? '';
      field.value = opts.input.value ?? '';
      field.setAttribute('aria-label', opts.input.placeholder || opts.title);
      alert.append(field);
    }

    const stacked = specs.length >= 3;
    const ordered = stacked ? specs : [...specs.filter((b) => !b.primary), ...specs.filter((b) => b.primary)];
    const row = document.createElement('div');
    row.className = stacked ? 'alert-buttons stacked' : 'alert-buttons';
    const buttons = ordered.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = b.primary ? 'alert-button primary' : 'alert-button';
      el.textContent = b.label;
      el.addEventListener('click', () => finish(b.value));
      row.append(el);
      return { el, spec: b };
    });
    alert.append(row);
    scrim.append(alert);

    const primary = buttons.find((b) => b.spec.primary);
    const cancel = buttons.find((b) => b.spec.cancel);

    const finish = (value: string) => {
      const i = stack.indexOf(scrim);
      if (i < 0) return;
      stack.splice(i, 1);
      window.removeEventListener('keydown', onKey, true);
      const result: { value: string; input?: string } = { value };
      if (field) result.input = field.value;
      const hadFocus = scrim.contains(document.activeElement);
      scrim.remove();
      if (hadFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      resolve(result);
    };

    const focusables = (): HTMLElement[] => [...(field ? [field] : []), ...buttons.map((b) => b.el)];

    const onKey = (e: KeyboardEvent) => {
      if (stack.at(-1) !== scrim) return;
      e.stopPropagation();
      if (e.isComposing) return;
      const inField = document.activeElement === field;
      if ((e.ctrlKey || e.metaKey) && !(inField && FIELD_CHORDS.has(e.key.toLowerCase()))) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (cancel) finish(cancel.spec.value);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = primary ?? buttons.find((b) => b.el === document.activeElement);
        if (target) finish(target.spec.value);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        alert.classList.add('keyboard');
        const list = focusables();
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next = (i + (e.shiftKey ? -1 : 1) + list.length) % list.length;
        list[i < 0 ? 0 : next]?.focus();
      }
    };

    // Presses outside the alert neither reach the window nor take focus away.
    scrim.addEventListener('pointerdown', (e) => {
      if (!alert.contains(e.target as Node)) e.preventDefault();
    });
    scrim.addEventListener('contextmenu', (e) => e.preventDefault());

    stack.push(scrim);
    document.body.append(scrim);
    window.addEventListener('keydown', onKey, true);
    (field ?? primary?.el ?? buttons[0]?.el)?.focus();
    field?.select();
  });
}
