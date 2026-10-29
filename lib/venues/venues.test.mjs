// Run from repo root: node --test lib/venues/venues.test.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** Every shipped source file, comments stripped — a comment naming a rule is not a breach of it. */
function sources() {
  const out = [];
  const skip = new Set(["node_modules", ".next", ".git", "output", "videos", "reports"]);
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (skip.has(name)) continue;
      const rel = dir ? `${dir}/${name}` : name;
      const full = join(ROOT, rel);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        walk(rel);
      } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.(mjs|ts)$/.test(name)) {
        out.push([rel, readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")]);
      }
    }
  };
  walk("lib");
  walk("app");
  walk("packages");
  return out;
}

test("Ryntra blocks nobody by where they are", () => {
  /*
   * The rule, since 2026-08-19: no one is blocked by IP address; everything
   * else is done in the public documentation, which states plainly who may
   * use the product.
   *
   * The functionality is built. Who may use it is stated in the public
   * documentation and terms, and no surface inspects where a request came
   * from. This is a product decision, so it needs an assertion — a policy kept
   * by intention is kept until the first person who has not read it.
   *
   * Not covered by this rule, deliberately: a **venue** answering for itself.
   * 0x refusing a Stock Token with `422` and Arcus's compliance endpoint
   * answering are those services deciding, and Ryntra shows the answer as it
   * comes back rather than predicting, simulating or pre-empting it.
   */
  const originHeaders = /["'`](?:x-vercel-ip-country|x-vercel-ip-city|x-vercel-ip-country-region|cf-ipcountry|x-country-code|x-geo-country)["'`]/i;
  const originApis = /\b(?:request|req|ctx)\.geo\b|\bgeolocation\s*\(|\bipapi\b|\bmaxmind\b|\bgeoip\b/i;

  for (const [path, source] of sources()) {
    assert.doesNotMatch(source, originHeaders, `${path} reads a request-origin country header`);
    assert.doesNotMatch(source, originApis, `${path} resolves a request to a place`);
  }

  /*
   * The one IP read that stays, named so it is not mistaken for the above.
   * `clientIp` keys rate limiting: abuse control is about how often one caller
   * asks, never about who they are or where they are, and it resolves no
   * country. It is asserted here so that removing it is a decision rather than
   * an accident, and so that a second IP read cannot arrive unnoticed.
   */
  const ipReads = sources().filter(([, source]) => /x-forwarded-for/i.test(source));
  assert.deepEqual(
    ipReads.map(([path]) => path),
    ["lib/growth/protect.ts", "lib/http-control.ts"],
    "only the rate limiter and the Network's protection may read a caller's address",
  );
  assert.match(read("lib/http-control.ts"), /export function clientIp/);
  /*
   * A proven
   * wallet's IP /24 is kept only as a keyed hash, to tell a reviewer that two wallets were seen together. It resolves no
   * place and blocks nobody by where they are — the value goes straight into the hash and nowhere else.
   */
  const protect = read("lib/growth/protect.ts");
  assert.match(protect, /const ip = ipPrefix\(headers\.get\("x-real-ip"\) \?\? headers\.get\("x-forwarded-for"\)\);/);
  assert.match(protect, /signalHash\(key, "ip24", ip\)/);
  assert.equal(protect.match(/x-forwarded-for/gi)?.length, 1, "the protection reads the caller's address once, for the hash");
});

test("a venue's stated restrictions are disclosure and nothing branches on them", () => {
  /*
   * The field was `geoBlocked` and its comment read "gating + disclosure hint",
   * which described a gate that never existed — nothing in this repository has
   * ever read it. A name that claims an enforcement the code does not perform
   * is the kind of thing a reader later implements to make true.
   */
  const declaration = read("lib/venues/types.ts");
  assert.match(declaration, /venueStatedRestrictions: string\[\]/);
  assert.match(declaration, /Disclosure, never a gate/);
  /* Shipped code only. The comment above the field names the old identifier on
     purpose — a rename is only legible beside what it replaced. */
  const shipped = declaration.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.doesNotMatch(shipped, /geoBlocked/, "the old name must not come back as code");

  const arcus = read("lib/venues/arcus/index.ts");
  assert.match(arcus, /venueStatedRestrictions: \["US", "UK", "CA", "CH", "UAE"\]/);

  /* Declared by the type, populated by each venue, read by nobody. The moment
     something branches on it, this repository has started enforcing a
     restriction it decided not to enforce — which is exactly the change that
     should have to be argued for rather than merged. */
  const readers = sources()
    .filter(([, source]) => /venueStatedRestrictions/.test(source))
    .map(([path]) => path)
    .sort();
  assert.deepEqual(
    readers,
    ["lib/venues/arcus/index.ts", "lib/venues/hyperliquid/index.ts", "lib/venues/types.ts"],
    "venueStatedRestrictions is disclosure: it is declared and populated, never consumed",
  );
});
