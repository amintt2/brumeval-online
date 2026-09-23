// [accounts] Client-side account state: the remembered-session token ("Rester connecté"), small per-device
// preferences (last played character, dismissed offers) and launcher detection. docs/COMPTES.md
// Every storage access is wrapped: private windows / blocked storage just mean "nothing remembered".

const K = {
  token: 'bv.token',
  remember: 'bv.remember',
  lastChar: 'bv.lastChar',
  passkeyOffer: 'bv.passkeyOfferDismissed',
  launcherCard: 'bv.launcherCardDismissed',
  login: 'bv.name',
};

function get(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function set(k, v) {
  try {
    if (v === null || v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, String(v));
  } catch { /* storage unavailable */ }
}

/** Inside the Electron launcher (its game-window preload API, or its user agent). */
export function inLauncher() {
  try {
    if (window.brumevalLauncher?.isLauncher) return true;
  } catch { /* ignore */ }
  return typeof navigator !== 'undefined' && /BrumevalLauncher\//.test(navigator.userAgent || '');
}

export const store = {
  get token() { return get(K.token); },
  set token(v) { set(K.token, v || null); },
  /** "Rester connecté": on by default in the launcher, off by default in a browser (shared computers). */
  get remember() {
    const v = get(K.remember);
    return v === null ? inLauncher() : v === '1';
  },
  set remember(v) { set(K.remember, v ? '1' : '0'); },
  get lastChar() { return get(K.lastChar); },
  set lastChar(v) { set(K.lastChar, v || null); },
  get login() { return get(K.login) || ''; },
  set login(v) { set(K.login, v || null); },
  get passkeyOfferDismissed() { return get(K.passkeyOffer) === '1'; },
  set passkeyOfferDismissed(v) { set(K.passkeyOffer, v ? '1' : null); },
  get launcherCardDismissed() { return get(K.launcherCard) === '1'; },
  set launcherCardDismissed(v) { set(K.launcherCard, v ? '1' : null); },
};

/** Quit through the launcher preload API (only offered inside the launcher). */
export function launcherQuit() {
  try { return window.brumevalLauncher?.quit?.(); } catch { return undefined; }
}
export const canQuit = () => {
  try { return typeof window.brumevalLauncher?.quit === 'function'; } catch { return false; }
};
