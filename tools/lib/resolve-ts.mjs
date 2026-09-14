/**
 * Resolves the project's `@/…` alias and extensionless `.ts` imports for plain
 * node, so tools that import the game's pure-maths modules can run where `tsx`
 * is not installable.
 *
 * Normally `tsx` does this (it reads `paths` from tsconfig.json) and the npm
 * scripts use it. This exists for the asset-download environment, where the npm
 * registry is blocked and nothing can be installed — see issue #21:
 *
 *   node --experimental-strip-types --import ./tools/lib/no-npm.mjs tools/renderMap.mjs
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = new URL('../../src/', import.meta.url);

/**
 * Adds the extension a TypeScript import leaves off.
 *
 * Candidates are tried before the bare path so that an existing directory
 * cannot shadow its own `index.ts`.
 */
function withExtension(path) {
  // Extension candidates come first: for `./foo` where a `foo/` directory
  // exists, an exact-path check would return the directory and the import then
  // fails, never reaching `foo/index.ts`.
  for (const extension of ['.ts', '/index.ts']) {
    if (existsSync(path + extension)) return path + extension;
  }
  return path;
}

/**
 * Node module-resolution hook: maps `@/…` onto `src/`, and retries a relative
 * import with a TypeScript extension when node cannot resolve it as written.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    return next(pathToFileURL(withExtension(fileURLToPath(SRC) + specifier.slice(2))).href, context);
  }
  if (specifier.startsWith('.')) {
    try {
      return await next(specifier, context);
    } catch (error) {
      const resolved = withExtension(fileURLToPath(new URL(specifier, context.parentURL)));
      if (existsSync(resolved)) return next(pathToFileURL(resolved).href, context);
      throw error;
    }
  }
  return next(specifier, context);
}
