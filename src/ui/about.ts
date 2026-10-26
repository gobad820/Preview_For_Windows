import splashUrl from '../assets/splash.svg';

let open: HTMLElement | null = null;

/** Shows the splash as a classic About window; a click anywhere or Esc closes it. */
export function showAbout(): void {
  if (open) return;
  const previousFocus = document.activeElement as HTMLElement | null;
  const scrim = document.createElement('div');
  scrim.className = 'about-scrim';
  const card = document.createElement('div');
  card.className = 'about';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'About Preview');
  card.tabIndex = -1;
  const img = document.createElement('img');
  img.src = splashUrl;
  img.alt = 'Preview for Windows';
  img.draggable = false;
  const caption = document.createElement('div');
  caption.className = 'about-caption';
  const version = document.createElement('span');
  version.textContent = `Version ${__APP_VERSION__}`;
  const what = document.createElement('span');
  what.textContent = 'PDF viewer and editor. No network access, no telemetry.';
  caption.append(version, what);
  card.append(img, caption);
  scrim.append(card);
  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
    open = null;
    previousFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  open = scrim;
  card.focus();
}
