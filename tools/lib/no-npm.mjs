/**
 * Registers the TypeScript resolver in `resolve-ts.mjs`.
 *
 * Use with `--import` when running a tool without `tsx` available:
 *
 *   node --experimental-strip-types --import ./tools/lib/no-npm.mjs tools/renderMap.mjs
 */
import { register } from 'node:module';

register('./resolve-ts.mjs', import.meta.url);
