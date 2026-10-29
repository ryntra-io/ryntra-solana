import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cctpCanaryExposureNeeded } from "./cctp-canary-exposure.ts";

/**
 * The owner canary is an internal instrument and may not decide an ordinary
 * action.
 *
 * The direction was established twice before: once when Swap keyed *submitted
 * once* on the verified signature rather than on a reservation, and once when a
 * production plan answered `safety: ALLOW` while the canary verdict came back
 * `BLOCK`. What neither did was hold it, and an audit found two places where it
 * was not true.
 *
 * Held on the route sources, in the manner of `user-path.test.mjs`, because
 * this is a property of the shape of the code rather than of one request: a
 * route that resolves the founder's policy before knowing whether it needs it
 * has already made his configuration a precondition for a stranger.
 */

const read = (path) => readFileSync(path, "utf8");

const SETTLE = "app/api/solana/transfer/settle/route.ts";
const BURN = "app/api/solana/bridge/burn/route.ts";
/* The reverse lane's own submit route. It answers the same questions as the
   forward burn and has to answer them in the same order, or the rule holds on
   one direction and not on the other — which is the same as not holding. */
const BASE_BURN = "app/api/solana/bridge/base-burn/route.ts";
/*
 * The routes a customer's transfer passes through where the owner-canary policy
 * must decide nothing at all.
 *
 * `bridge/burn` is deliberately absent. It resolves the strict policy inside the
 * envelope and refuses when it cannot — which is correct, because inside the
 * envelope the action is the founder's and the ceiling it carries is what
 * protects him. The test above pins that resolution to the branch that needs it.
 */
const CUSTOMER_ROUTES = [
  "app/api/solana/transfer/plan/route.ts",
  "app/api/solana/transfer/adopt/route.ts",
  "app/api/solana/transfer/settle/route.ts",
  "app/api/solana/bridge/plan/route.ts",
];

/** Words that belong to the founder's instrument and to no customer screen. */
const CANARY_WORD = /canary|envelope|канарк|конверт/i;

/** Literal calls only: a variable or template is not copy this can read. */
const LITERAL_TEXT_CALL = /\btext\(\s*"((?:[^"\\]|\\.)*)"\s*[,)]/g;

const MONEY_SURFACES = [
  "app/solana/workspace/send/send-card.tsx",
  "app/solana/workspace/send/send-copy.ts",
  "app/solana/workspace/trade/swap-card.tsx",
  "app/solana/workspace/bridge/bridge-card.tsx",
  "app/solana/workspace/history/history-card.tsx",
  "app/solana/workspace/receive/receive-card.tsx",
  "app/solana/workspace/holdings/holdings-card.tsx",
];

test("the route that submits a Send consults no canary at all", () => {
  /*
   * It used to resolve the owner-canary policy, refuse with 503 when it could
   * not be parsed, and never read it again. So a malformed variable in the
   * founder's own experiment configuration refused every stranger's transfer —
   * and did it *after* the wallet signature, where no check that reads the
   * screen can see it. That is the shape of the defect `001A` closed in the
   * swap lane, arriving in a different one.
   */
  const source = read(SETTLE);
  assert.ok(
    !/resolveSolanaCanaryPolicy/.test(source),
    "the Send submit route resolves an owner-canary policy again",
  );
  assert.ok(
    !/CANARY_POLICY_UNAVAILABLE|CANARY_STORE_UNAVAILABLE/.test(source),
    "the Send submit route can refuse a customer with a canary-shaped code again",
  );
  /* What does decide admission there, so this fails if that is what moved. */
  assert.match(source, /validateSettlementCandidate/);
  assert.match(source, /DURABLE_MULTI_WRITER/);
});

test("the burn route resolves the founder's policy only when it decides something", () => {
  const source = read(BURN);
  assert.match(
    source,
    /cctpCanaryExposureNeeded\(reviewed\.canaryVerdict\)/,
    "the burn route no longer asks whether the canary policy is needed",
  );
  /* The order is the whole point: needed-check first, resolution inside it. */
  const needed = source.indexOf("cctpCanaryExposureNeeded(");
  const resolved = source.indexOf("resolveSolanaCanaryPolicy()");
  assert.ok(needed !== -1 && resolved !== -1, "one of the two calls is gone");
  assert.ok(
    needed < resolved,
    "the burn route resolves the owner-canary policy before knowing whether it needs it",
  );
});

test("outside the envelope the policy is never needed, and inside it always is", () => {
  /* The switch itself rather than the routes that call it. An unreadable policy
     must still refuse an owner action, because the ceiling it carries is what
     protects the founder from his own instrument. */
  const verdict = (status) => ({
    schema: "ryntra.solana.canary-verdict",
    schemaVersion: "1.0.0",
    decision: status === "INSIDE_ENVELOPE" ? "ALLOW" : "BLOCK",
    scope: { status, decidedBy: "TRANSFER_CAPABILITY", detail: "" },
  });
  assert.equal(cctpCanaryExposureNeeded(verdict("INSIDE_ENVELOPE")), true);
  assert.equal(cctpCanaryExposureNeeded(verdict("OUTSIDE_ENVELOPE")), false);
});

test("no canary word reaches a person through a money surface", () => {
  /*
   * The codes belong in the receipt, where an auditor reads them, and never on
   * the card where somebody is deciding about their money. The canary is the
   * sharpest case — it is the founder's private instrument, and a customer has
   * no way to act on a word about it.
   *
   * Scanned on what the source renders rather than on the catalogue. The
   * catalogue still holds dozens of canary sentences from the M0/M1/M2
   * surfaces, and a key nobody passes to `text()` harms nobody; asserting on the
   * catalogue would have been a stricter-looking test of the wrong thing —
   * failing on dead entries while missing a live one written inline.
   */
  const said = [];
  for (const path of MONEY_SURFACES) {
    for (const match of read(path).matchAll(LITERAL_TEXT_CALL)) {
      const copy = JSON.parse('"' + match[1] + '"');
      if (CANARY_WORD.test(copy)) said.push(path + ": " + JSON.stringify(copy));
    }
  }
  assert.deepEqual(said, [], "a money surface says a canary word: " + said.join(" | "));
});

test("that scan reads real files and would catch a canary word", () => {
  /* A scanner over a mistyped path passes forever, and a pattern that matches
     nothing passes with it. Both halves are asserted. */
  for (const path of MONEY_SURFACES) {
    assert.ok(read(path).length > 500, path + " did not read as a real source file");
  }
  const found = [...read(MONEY_SURFACES[0]).matchAll(LITERAL_TEXT_CALL)];
  assert.ok(found.length > 5, "the literal-copy pattern matched almost nothing");

  assert.ok(CANARY_WORD.test("Owner canary verified"));
  assert.ok(CANARY_WORD.test("Pair outside the owner canary"));
  assert.ok(CANARY_WORD.test("поза конвертом"));
  assert.ok(!CANARY_WORD.test("Sending is turned off right now."));
});

test("no customer route can refuse anybody because the owner policy did not parse", () => {
  /*
   * The five routes the inventory found. Every one of them used to resolve the
   * founder's experiment configuration and answer 503 when it failed, so a typo
   * in a twenty-dollar internal experiment refused every stranger's transfer.
   * They now read the runtime, which falls back to a declared closed policy and
   * never refuses.
   */
  for (const path of CUSTOMER_ROUTES) {
    const source = read(path);
    assert.ok(
      !/CANARY_POLICY_UNAVAILABLE/.test(source),
      path + " can refuse a customer for the state of the owner-canary configuration again",
    );
    assert.ok(
      !/\bresolveSolanaCanaryPolicy\b/.test(source),
      path + " resolves the strict owner-canary policy directly again; it must read the runtime",
    );
  }
});

test("the two routes that submit refuse an owner canary while the policy is unreadable", () => {
  /* Declared by the caller, never inferred: under a closed fallback every action
     reads outside the envelope, so a mode taken from the scope would let a real
     canary through as a customer and spend real money unaccounted. */
  for (const path of [SETTLE, BURN, BASE_BURN]) {
    const source = read(path);
    assert.match(source, /readCanaryFlow\(request\.headers\)/, path + " no longer reads the declared flow");
    assert.match(source, /canaryFlowPermitted\(/, path + " no longer enforces the flow");
    assert.match(source, /flowPermitted\.code/, path + " does not refuse with the flow decision");

    /* Before the body is parsed. A refusal reachable only with a well-formed
       signed bundle is unverifiable, and later than it needs to be: nothing
       about an unreadable policy depends on what was posted. */
    const flow = source.indexOf("readCanaryFlow(request.headers)");
    const parsed = source.search(/readAgentControlJson\(request\)/);
    assert.ok(flow !== -1 && parsed !== -1, path + " lost one of the two calls");
    assert.ok(flow < parsed, path + " decides the owner-canary flow after parsing the body");
  }
});

test("the degradation is reported wherever the runtime is read on a plan path", () => {
  /* A silent fallback would be worse than the refusal it replaces. */
  for (const path of [
    "app/api/solana/transfer/plan/route.ts",
    "app/api/solana/transfer/adopt/route.ts",
    "app/api/solana/bridge/plan/route.ts",
  ]) {
    assert.match(read(path), /reportCanaryRuntime\(/, path + " uses the fallback without reporting it");
  }
});
