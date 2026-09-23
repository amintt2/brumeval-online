// [launcher] Installable web app: manifest links + service worker registration (see public/sw.js).
// Not used by the Vite dev server (it would get in the way of hot reloading).
// ?sw=0 unregisters the service worker and empties its caches (troubleshooting).

function addHeadLink(rel, href) {
  if (document.querySelector(`link[rel="${rel}"]`)) return;
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
}

async function disableServiceWorker() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  if (window.caches) {
    for (const key of await caches.keys()) if (key.startsWith('brumeval-')) await caches.delete(key);
  }
  console.info('[pwa] service worker désactivé et caches vidés');
}

export function setupPwa() {
  try {
    addHeadLink('manifest', '/manifest.webmanifest');
    addHeadLink('apple-touch-icon', '/pwa/apple-touch-icon.png');
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    if (import.meta.env.DEV) return;
    if (new URLSearchParams(location.search).get('sw') === '0') {
      disableServiceWorker().catch(() => {});
      return;
    }
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        console.info('[pwa] service worker non enregistré :', err?.message || err);
      });
    };
    // Registering after the load event keeps the first download of the game at full speed.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  } catch (err) {
    console.info('[pwa] indisponible :', err?.message || err);
  }
}
