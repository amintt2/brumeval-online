// Node module resolution hook so that server tests can import client modules: maps Vite's `@shared/…`
// alias to the repository's shared/ directory (registered with module.register()).
const SHARED = new URL('../../../shared/', import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@shared/')) return next(new URL(specifier.slice('@shared/'.length), SHARED).href, context);
  return next(specifier, context);
}
