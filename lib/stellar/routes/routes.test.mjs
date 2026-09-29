import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The route-evidence contract.
 *
 * This adapter is the first thing in the Stellar program that talks to a
 * credentialed third party, so two properties matter more than the rest and
 * neither is about routing:
 *
 *   the key never reaches a browser — the same rule `wallets.test.mjs` enforces
 *     on the wallet package, for a worse reason: a bundled credential is a
 *     published credential;
 *
 *   a missing answer is never a filled-in one — no cached plan, no computed
 *     price, no expected output without a floor. A route-evidence adapter that
 *     invents evidence is worse than no adapter at all.
 */

const ROUTES = join("lib", "stellar", "routes");
const read = (path) => readFileSync(path, "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SOROSWAP = strip(read(join(ROUTES, "soroswap.ts")));
const PLAN = strip(read(join(ROUTES, "plan.ts")));

function walk(dir, match, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, match, found);
    else if (match(entry)) found.push(path);
  }
  return found;
}

test("the API key is read on the server and can never reach a browser", () => {
  /*
   * `process.env` in a module a client component imports is inlined at build
   * time for anything prefixed `NEXT_PUBLIC_`, and simply absent otherwise — but
   * the import itself still pulls the module into the client graph, and the next
   * person to add a public variable to it publishes the file. The rule is
   * therefore about the import, not about the variable.
   */
  assert.match(SOROSWAP, /process\.env\[SOROSWAP_KEY_ENV\]/, "the adapter no longer reads the key from the environment");
  assert.doesNotMatch(
    SOROSWAP,
    /NEXT_PUBLIC/,
    "the Soroswap key must never be a NEXT_PUBLIC variable — that is the one prefix Next inlines into the browser bundle",
  );
  assert.doesNotMatch(SOROSWAP, /^"use client"/m, "the route adapter declared itself a client module");

  const clientImporters = [];
  for (const path of walk(join("app", "stellar"), (name) => name.endsWith(".tsx") || name.endsWith(".ts"))) {
    const source = read(path);
    if (!/^"use client"/m.test(source)) continue;
    if (/routes\/soroswap/.test(strip(source))) clientImporters.push(path);
  }
  assert.deepEqual(
    clientImporters,
    [],
    `These client components import the Soroswap adapter, which puts a credentialed module in the browser graph:\n${clientImporters.join("\n")}`,
  );
});

test("without a key the adapter refuses rather than inventing a route", () => {
  /*
   * Read live on 2026-08-14: every useful Soroswap endpoint answers 403 without
   * a key — /quote, /pools, /price, /protocols, /asset-list. The honest result
   * is UNAVAILABLE naming the gate, and the one thing that must never appear is
   * a fallback that produces a plan anyway.
   */
  const quote = SOROSWAP.match(/export async function readSoroswapRoute[\s\S]*?\n\}/);
  assert.ok(quote, "readSoroswapRoute is gone");

  assert.match(
    quote[0],
    /const key = apiKey\(\);\s*if \(!key\) \{\s*return unavailable\(/,
    "the no-key path no longer returns UNAVAILABLE first",
  );
  assert.doesNotMatch(
    quote[0],
    /\bMath\.(random|pow)\b|cached|fallbackPlan|estimateOut/i,
    "the route adapter has a fallback that would produce a plan without a provider answering",
  );
  /* The gate is one sentence, in one place, so every surface quotes the same
     thing rather than each inventing its own version of the next step. */
  assert.match(SOROSWAP, /SOROSWAP_GATE\s*=\s*\n?\s*"Register at api\.soroswap\.finance\/register/);
  assert.match(quote[0], /SOROSWAP_GATE/, "the refusal does not carry the gate a person can act on");
});

test("a quote with no floor is refused, because a floor is what makes it evidence", () => {
  /*
   * An earlier swap receipt recorded what an unstated minimum costs: a delivered
   * amount below the authorized minimum has to be reportable as a deviation,
   * which requires the minimum to have been recorded before the signature.
   */
  assert.match(PLAN, /minimumOut: string;/, "RoutePlan no longer requires a minimum output");
  assert.doesNotMatch(PLAN, /minimumOut\?: /, "minimumOut became optional, which makes the floor skippable");

  const quote = SOROSWAP.match(/export async function readSoroswapRoute[\s\S]*?\n\}/)[0];
  assert.match(
    quote,
    /if \(!minimumOut\) \{[\s\S]*?return unavailable\(/,
    "a response without a minimum output no longer resolves UNAVAILABLE",
  );
});

test("nothing is computed to fill a gap in a provider's answer", () => {
  const quote = SOROSWAP.match(/export async function readSoroswapRoute[\s\S]*?\n\}/)[0];
  /* Every optional field is read or null. A derived number presented as the
     provider's is the quiet version of making one up. */
  for (const [field, pattern] of [
    ["priceImpact", /priceImpact: typeof body\.priceImpactPct === "number" \? [^:]+ : null/],
    ["expiresAt", /expiresAt: typeof body\.expiresAt === "string" \? body\.expiresAt : null/],
    ["quoteId", /quoteId: typeof body\.quoteId === "string" \? body\.quoteId : null/],
  ]) {
    assert.match(quote, pattern, `${field} is no longer read-or-null; it may be being derived.`);
  }
});

test("comparison needs two answers, and says so rather than implying a winner", () => {
  /* A comparison that can only ever hold one entry teaches a reader there is
     nothing to compare. With one provider integrated, the spread is null and
     the surface has to render that rather than a rank. */
  const compare = PLAN.match(/export function compareRoutes[\s\S]*?\n\}/);
  assert.ok(compare, "compareRoutes is gone");
  assert.match(compare[0], /if \(plans\.length < 2\) return \{ plans, spread: null \};/);
  assert.match(compare[0], /if \(numeric\.length < 2\) return \{ plans, spread: null \};/);
});

test("a quote with no expiry is treated as expired, not as eternal", () => {
  const live = PLAN.match(/export function routeIsLive[\s\S]*?\n\}/);
  assert.ok(live, "routeIsLive is gone");
  assert.match(
    live[0],
    /if \(!plan\.expiresAt\) return false;/,
    "a quote with no stated expiry is being treated as still live, which is the most optimistic possible reading of a missing field",
  );
});

test("the public half is real, and it is the only half claimed as working", () => {
  /*
   * `GET /health` needs no credential and answers today. That is what makes
   * Soroswap a real entry on the Providers surface rather than a name in a
   * list — and it is deliberately the *only* thing this integration claims,
   * because everything else returned 403.
   */
  const health = SOROSWAP.match(/export async function readSoroswapHealth[\s\S]*?\n\}/);
  assert.ok(health, "readSoroswapHealth is gone");
  assert.doesNotMatch(health[0], /authorization|Bearer/i, "the health read now sends a credential it does not need");
  assert.match(health[0], /\$\{SOROSWAP_API\}\/health/);
  /* It reports whether this deployment holds a key, so a surface can say which
     half of the provider is reachable without guessing. */
  assert.match(health[0], /configured: soroswapIsConfigured\(\)/);
});
