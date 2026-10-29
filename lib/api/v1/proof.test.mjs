import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/*
 * `proof.ts` reads the real session store through modules node cannot load
 * outside Next, so its order is held by its source, as `swap-carrier.test.mjs`
 * holds the carrier's: a bearer is resolved first; any other Authorization
 * header is refused as a native request (401) before the browser's origin
 * check or its cookie are ever consulted (1.22.0).
 */
test("1.22.0: an Authorization header that is no bearer is refused as a native request, before the origin check and the cookie", () => {
  const source = readFileSync(new URL("./proof.ts", import.meta.url), "utf8");
  const bearer = source.indexOf("if (bearerToken(request.headers))");
  const malformed = source.indexOf('if (request.headers.get("authorization") !== null)');
  const origin = source.indexOf('if (intent === "mutation" && !mutationOriginAllowed(');
  const cookie = source.indexOf("await intentWalletProof(intent, readWalletProof)");
  assert.ok(bearer > 0 && malformed > bearer && origin > malformed && cookie > origin, "bearer → malformed header → origin → cookie");
  assert.match(source.slice(malformed, origin), /apiFailure\("UNAUTHORIZED", /);
});

/*
 * The prediction routes take an EVM wallet too; every other route keeps the
 * Solana-only proof. Both are held by the source, as above.
 */
function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

test("requireWalletProof still accepts a Solana wallet and nothing else", () => {
  const body = functionBody(readFileSync(new URL("./proof.ts", import.meta.url), "utf8"), "requireWalletProof");
  assert.match(body, /if \(!proof \|\| proof\.chain !== "solana"\) \{/);
  assert.doesNotMatch(body, /"evm"/);
});

test("requirePredictionWalletProof accepts a Solana or an EVM wallet, in the same order of checks", () => {
  const body = functionBody(readFileSync(new URL("./proof.ts", import.meta.url), "utf8"), "requirePredictionWalletProof");
  const bearer = body.indexOf("if (bearerToken(request.headers))");
  const malformed = body.indexOf('if (request.headers.get("authorization") !== null)');
  const origin = body.indexOf('if (intent === "mutation" && !mutationOriginAllowed(');
  const cookie = body.indexOf("await intentWalletProof(intent, readWalletProof)");
  assert.ok(bearer > 0 && malformed > bearer && origin > malformed && cookie > origin, "bearer → malformed header → origin → cookie");
  assert.match(body, /proof\.chain !== "solana" && proof\.chain !== "evm"/);
  assert.match(body, /proof\.chain === "evm" \? proof\.address\.toLowerCase\(\)/);
});

test("only the prediction routes read the proof that takes an EVM wallet", () => {
  const http = readFileSync(new URL("../../predictions/http.ts", import.meta.url), "utf8");
  assert.match(http, /requirePredictionWalletProof/);
  assert.doesNotMatch(http, /requireWalletProof\(/);
  /* No other source file in the app or the libraries reaches for it. */
  const root = new URL("../../../", import.meta.url);
  const allowed = new Set(["lib/api/v1/proof.ts", "lib/predictions/http.ts"]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const rel = `${dir}${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(`${rel}/`);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !allowed.has(rel)) {
        if (readFileSync(new URL(rel, root), "utf8").includes("requirePredictionWalletProof")) offenders.push(rel);
      }
    }
  };
  walk("app/");
  walk("lib/");
  assert.deepEqual(offenders, [], "the EVM-taking proof is the prediction routes' alone");
});
