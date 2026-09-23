// [accounts] "Installer l'application" (PWA): Chromium browsers fire `beforeinstallprompt` when the game is
// installable (manifest + service worker, see pwa.js). The event is kept and replayed on a click.
let deferred = null;
const listeners = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // no mini-infobar: the login screen offers it in the launcher card
    deferred = e;
    for (const fn of listeners) fn(true);
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    for (const fn of listeners) fn(false);
  });
}

export const canInstallPwa = () => !!deferred;

/** Call fn(available) now and whenever it changes. Returns an unsubscribe function. */
export function onPwaAvailable(fn) {
  listeners.add(fn);
  fn(!!deferred);
  return () => listeners.delete(fn);
}

/** Show the browser's install dialog. Resolves true when accepted. */
export async function installPwa() {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  for (const fn of listeners) fn(false);
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice?.outcome === 'accepted';
  } catch {
    return false;
  }
}
