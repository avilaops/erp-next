/**
 * Resolver for the command-line scripts: `@/…` is the tsconfig alias for
 * `src/…`, which Node does not know. Nothing else is translated here; the
 * stand-ins for `next/headers` and `next/navigation` belong to the tests
 * (`tests/loader.mjs`).
 */
const ROOT = new URL("../src/", import.meta.url).href;

export function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(ROOT + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}
