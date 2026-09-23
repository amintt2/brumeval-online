// Optional list of the files present under client/public (models, textures, env, vfx), written by the Vite
// plugin in client/vite-asset-manifest.js as /asset-manifest.json. It lets the client skip requests for
// optional assets that don't exist (LOD files, HDRIs, texture sets…) instead of collecting 404s.
// Without the manifest every question answers `undefined` ("unknown") and loaders simply try.

let promise = null;
let files = null;

function load() {
  if (!promise) {
    promise = (async () => {
      try {
        const res = await fetch('/asset-manifest.json', { cache: 'no-cache' });
        if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) return null;
        const list = await res.json();
        if (!Array.isArray(list?.files)) return null;
        files = new Set(list.files.map((f) => `/${String(f).replace(/^\/+/, '')}`));
        return files;
      } catch {
        return null;
      }
    })();
  }
  return promise;
}

/** true / false when the manifest knows, undefined when there is no manifest. */
export async function assetExists(url) {
  const set = await load();
  if (!set) return undefined;
  const path = String(url).split('?')[0];
  return set.has(path);
}

/** Synchronous variant (after the first await of assetExists / preloadManifest). */
export function assetExistsSync(url) {
  if (!files) return undefined;
  return files.has(String(url).split('?')[0]);
}

export function preloadManifest() {
  return load();
}
