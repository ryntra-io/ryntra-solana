import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { swapFailureCopy } from "./swap-failure-copy.ts";

/**
 * Every failure the Solana swap routes can return must say what happened.
 *
 * Found on production 2026-09-10. A manual test pressed **Review swap** five
 * times in twenty-four seconds against a wallet holding 3.777309 USDC and got
 * *Swap could not continue. Try again.* every time, beside a button that was
 * still enabled. The pair was fine — Jupiter answered 200 for it, and the same
 * request against `ryntra.io` built a real signable Review for a funded wallet
 * minutes later. What was wrong was that ten different failures shared one
 * sentence, and one of them — a request the platform killed before the route
 * could answer — was not a failure of the swap at all.
 *
 * This test reads the route sources rather than a list somebody keeps up to
 * date, so a new refusal has to be worded before it can ship.
 */

const DEFAULT = "Swap could not continue. Try again.";
const en = (english) => english;

test("failed simulation can request fresh bytes and distinguishes an already-signed refusal", () => {
  assert.equal(swapFailureCopy("SIMULATION_FAILED", en).retryable, true);
  const adopted = swapFailureCopy("ADOPTED_SIMULATION_FAILED", en);
  assert.equal(adopted.retryable, true);
  assert.match(adopted.message, /Nothing was sent/);
  assert.doesNotMatch(adopted.message, /not offered for signing/);
  assert.equal(swapFailureCopy("SIMULATION_EFFECT_UNEXPECTED_DEBIT", en).retryable, false);
});

const routeSource = (name) => readFileSync(new URL(`../../app/api/solana/swap/${name}/route.ts`, import.meta.url), "utf8");
/* The order's refusals since the core pipeline: the route's admission, the swap's prepare steps and the shared safety chain before the wallet. */
const orderPathSource = () =>
  [routeSource("order"), ...["prepare", "guard"].map((file) => readFileSync(new URL(`../core/solana-swap/${file}.ts`, import.meta.url), "utf8"))].join("\n");

/**
 * The codes a route can actually put on the wire.
 *
 * `failure(...)` calls — `refuse(...)` in the pipeline's steps — carry the code as their second argument, and the two
 * prefixed families are built from a provider's own code, so both halves are
 * collected: the literal `` `ORDER_${result.code}` `` template and the codes
 * the provider module can produce.
 */
function emittedCodes(source) {
  const codes = new Set();
  for (const match of source.matchAll(/(?:failure|\brefuse)\(\s*\d+\s*,\s*"([A-Z][A-Z0-9_]*)"/g)) codes.add(match[1]);
  for (const match of source.matchAll(/(?:failure|\brefuse)\(\s*[^,]+,\s*`([A-Z_]+)\$\{/g)) codes.add(match[1]);
  return codes;
}

/** What `fetchJupiterExecutableOrder` and its execute sibling can answer with. */
const PROVIDER_CODES = ["PRODUCTION_KEY_REQUIRED", "MALFORMED", "UNREACHABLE", "RATE_LIMITED", "NO_ROUTE", "HTTP_ERROR", "REFUSED", "BUILD_FAILED"];

test("no failure the order route can return falls through to the catch-all", () => {
  const source = orderPathSource();
  const codes = emittedCodes(source);
  assert.ok(codes.size > 10, `expected to find the route's codes, found ${codes.size}`);

  const unworded = [];
  for (const code of codes) {
    /* A template prefix is not a code by itself; it is worded through the
       provider codes it wraps. */
    const candidates = code.endsWith("_") ? PROVIDER_CODES.map((tail) => code + tail) : [code];
    for (const candidate of candidates) {
      if (swapFailureCopy(candidate, en).message === DEFAULT) unworded.push(candidate);
    }
  }
  assert.deepEqual(unworded, [], "every code this route can return must have a sentence of its own");
});

test("a request the platform killed says so, and does not describe the swap", () => {
  /* This is the exact code the production screen produced. The client turns a
     bodyless response into `HTTP_<status>`, and every refusal this product
     writes itself carries a body — so a bare `HTTP_5xx` means no function ever
     returned, which is a timeout and not a fact about the swap. */
  for (const code of ["HTTP_502", "HTTP_503", "HTTP_504"]) {
    const copy = swapFailureCopy(code, en);
    assert.notEqual(copy.message, DEFAULT, code);
    assert.match(copy.message, /took too long/i, code);
    assert.match(copy.message, /Nothing was sent/i, `${code} must not leave the money in doubt`);
    assert.equal(copy.retryable, true, "a timeout is worth another press; that is the whole difference");
  }
  assert.match(swapFailureCopy("NETWORK", en).message, /could not be reached/i);
});

test("what a person can fix is named, and what they cannot is not offered as a retry", () => {
  /* Jupiter's own words for the commonest refusal are "Insufficient funds",
     and the card was answering that with "try again". */
  const build = swapFailureCopy("ORDER_BUILD_FAILED", en);
  assert.match(build.message, /does not cover/i);
  assert.equal(build.retryable, true);

  /* None of these gets better by pressing, so none of them leaves the button live. */
  for (const code of ["PASSPORT_REFUSED", "MINT_UNREADABLE", "INTENT_REFUSED", "SWAP_POLICY_BLOCKED", "PRODUCTION_KEY_REQUIRED", "DURABLE_MULTI_WRITER", "TRANSACTION_FEE_PAYER"]) {
    assert.equal(swapFailureCopy(code, en).retryable, false, code);
    assert.notEqual(swapFailureCopy(code, en).message, DEFAULT, code);
  }

  /* And the provider being unreachable is not the person's doing, but can pass. */
  for (const code of ["ORDER_UNREACHABLE", "ORDER_HTTP_ERROR"]) {
    const copy = swapFailureCopy(code, en);
    assert.match(copy.message, /could not be reached/i, code);
    assert.equal(copy.retryable, true, code);
  }
});

test("every heavy swap route declares how long it may take", () => {
  /* The order route declared nothing while doing more work than any of its
     siblings — two mint passport reads, the provider build, a transaction
     inspection and an on-chain simulation in one request. It ran on the
     platform default, and a slow hop ended the invocation with a bodyless 502
     that no log recorded and no sentence named. */
  for (const [name, atLeast] of [["order", 60], ["execute", 60], ["recover", 60], ["quote", 30], ["cancel-review", 30]]) {
    const declared = /export const maxDuration = (\d+)/.exec(routeSource(name));
    assert.ok(declared, `${name} must declare a time budget`);
    assert.ok(Number(declared[1]) >= atLeast, `${name} declares ${declared[1]}, expected at least ${atLeast}`);
  }
});
