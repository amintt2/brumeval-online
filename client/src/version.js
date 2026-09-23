// [netcode-perf] Client auto-update notice.
// The server sends its version (`ver`) and client build id (`build`) in auth_ok. The first pair seen by this
// page is the reference; if a later auth_ok (after a reconnection, typically because the server was
// redeployed) carries a different pair, a French banner offers to reload the page. index.html is served
// `no-cache` and the bundles are fingerprinted, so a reload always picks the new client.

let reference = null;
let banner = null;

const keyOf = (ver, build) => `${ver}|${build}`;

/** Record the server version of an auth_ok. Returns true when it differs from the reference (notice shown). */
export function observeServerVersion(msg) {
  if (!msg || typeof msg.ver !== 'string') return false; // offline mode / old server: nothing to compare
  const key = keyOf(msg.ver, typeof msg.build === 'string' ? msg.build : '');
  if (reference === null) {
    reference = key;
    return false;
  }
  if (key === reference) return false;
  showUpdateNotice(msg.ver);
  return true;
}

/** Test helper: forget the reference version. */
export function resetServerVersion() {
  reference = null;
  banner?.remove();
  banner = null;
}

export function showUpdateNotice(ver) {
  if (typeof document === 'undefined') return;
  if (banner?.isConnected) return;
  banner = document.createElement('div');
  banner.setAttribute('role', 'alert');
  banner.className = 'bv-update-notice';
  Object.assign(banner.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: '10000',
    display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
    background: 'linear-gradient(180deg, rgba(36,30,24,0.97), rgba(13,11,10,0.97))',
    border: '1px solid #c9a24d', borderRadius: '8px', boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
    color: '#eee4ce', font: "15px 'Alegreya Sans', 'Segoe UI', system-ui, sans-serif", pointerEvents: 'auto',
  });
  const text = document.createElement('span');
  text.textContent = `Nouvelle version disponible${ver ? ` (v${ver})` : ''} — `;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'recharger';
  Object.assign(reload.style, {
    font: "600 15px 'Cinzel', Georgia, serif", color: '#1a140c', background: '#f2d58c',
    border: '1px solid #6e5020', borderRadius: '5px', padding: '4px 12px', cursor: 'pointer',
  });
  reload.addEventListener('click', () => location.reload());
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Plus tard';
  Object.assign(close.style, {
    font: '20px system-ui, sans-serif', lineHeight: '1', color: '#b9ab90', background: 'transparent',
    border: 'none', cursor: 'pointer', padding: '0 2px',
  });
  close.addEventListener('click', () => banner?.remove());
  banner.append(text, reload, close);
  document.body.appendChild(banner);
}
