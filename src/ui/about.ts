import splashUrl from '../assets/splash.jpg';
import { t } from '../i18n';

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
  card.setAttribute('aria-label', t('chrome.about.title'));
  card.tabIndex = -1;
  const img = document.createElement('img');
  img.src = splashUrl;
  img.alt = t('chrome.about.image');
  img.draggable = false;
  const caption = document.createElement('div');
  caption.className = 'about-caption';
  const version = document.createElement('span');
  version.textContent = t('chrome.about.version', { version: __APP_VERSION__ });
  const what = document.createElement('span');
  what.textContent = t('chrome.about.what');
  caption.append(version, what);
  // The license's "appropriate legal notices": copyright, no warranty, the license, where the source is.
  const legal = document.createElement('p');
  legal.className = 'about-legal';
  legal.textContent = t('chrome.about.legal', { source: 'github.com/gobad820/Preview_For_Windows' });
  card.append(img, caption, legal);
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
