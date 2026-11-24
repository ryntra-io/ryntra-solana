/*
 * `bigint-buffer` on the server: always its pure-JavaScript build.
 *
 * `@solana/spl-token` reads u64 fields through `@solana/buffer-layout-utils`, which reads them through
 * `bigint-buffer`. That package's Node entry (`dist/node.js`) first tries its native addon through `bindings` and,
 * when the addon is not found, prints `bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)`
 * and carries on in pure JavaScript. Inside a bundled server function the addon is never found — `bindings` looks
 * for `build/Release/bigint_buffer.node` beside the calling file, and the caller is a webpack chunk — so every cold
 * start of nearly every function wrote that line to the production log, hundreds an hour, hiding the real warnings.
 *
 * The package's browser entry (`dist/browser.js`) is that same pure-JavaScript code with the addon attempt and the
 * warning taken out: line for line the fallback that production already runs. Resolving `bigint-buffer` to it on
 * the server therefore changes no result, only drops the line — and it also keeps the native `toBigIntLE` of
 * advisory GHSA-3gc7-fjrx-p6mg (`scripts/check-audit.mjs`) out of every function for good.
 *
 * Why not the other ways: shipping the addon into each function (`serverExternalPackages` plus file tracing) would
 * switch production onto native code it has never run, and onto the very function the advisory names; replacing
 * the dependency is not ours to do — it comes through spl-token; muting `console.warn` would hide a line by its
 * words, for every module, at runtime. The guard that the line stays gone after a build is
 * `scripts/check-quiet-server-bundle.mjs` (run by `postbuild`).
 */

/** The package whose Node entry prints the line. */
export const BIGINT_BUFFER = "bigint-buffer";

/** Its pure-JavaScript entry, the one the server bundles instead. */
export const BIGINT_BUFFER_PURE_JS = "bigint-buffer/dist/browser.js";

/** The line it prints when it falls back — what must never reach the production log again. */
export const BIGINT_BUFFER_WARNING = "bigint: Failed to load bindings";

type WebpackConfig = { resolve?: { alias?: unknown } };

/**
 * The webpack config with `bigint-buffer` (the bare name only — `$` — so the target is not aliased again) resolved
 * to its pure-JavaScript entry on server compiles (Node and edge). A client compile already takes that entry through
 * the package's `browser` field and is returned as it came.
 */
export function withPureBigintBuffer<T extends WebpackConfig>(config: T, isServer: boolean): T {
  if (!isServer) return config;
  const resolve = (config.resolve ??= {});
  const alias = resolve.alias;
  if (Array.isArray(alias)) {
    resolve.alias = [...alias, { name: BIGINT_BUFFER, alias: BIGINT_BUFFER_PURE_JS, onlyModule: true }];
  } else {
    resolve.alias = { ...(alias as Record<string, unknown> | undefined), [`${BIGINT_BUFFER}$`]: BIGINT_BUFFER_PURE_JS };
  }
  return config;
}
