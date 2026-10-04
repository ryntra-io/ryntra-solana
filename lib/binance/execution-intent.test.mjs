// Run from repo root: node --test lib/binance/execution-intent.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateIntent, mockIntent, DISPATCH_IS_NOT_IMPLEMENTED } from "./execution-intent.ts";

const BASE = {
  surface: "binance-spot",
  product: "spot-crypto",
  base: "BTC",
  quote: "USDT",
  side: "BUY",
  orderType: "MARKET",
  notionalUsd: 100,
};

const CONTEXT = {
  grantedScopes: ["market-data", "account", "trade"],
  killSwitchEngaged: false,
  dataState: "fresh",
  tradable: true,
  reviewAboveUsd: 1_000,
};

test("a small, in-scope, fresh-data order on a tradable instrument is ALLOW", () => {
  const decision = evaluateIntent(mockIntent(BASE), CONTEXT);
  assert.equal(decision.verdict, "ALLOW");
  assert.deepEqual(decision.reasons, []);
});

test("an order above the review threshold is REVIEW, not ALLOW", () => {
  const decision = evaluateIntent(mockIntent({ ...BASE, notionalUsd: 5_000 }), CONTEXT);
  assert.equal(decision.verdict, "REVIEW");
  assert.ok(decision.reasons.some((r) => r.code === "ABOVE_REVIEW_THRESHOLD"));
});

test("a scope the user never granted is BLOCK", () => {
  const decision = evaluateIntent(mockIntent(BASE), { ...CONTEXT, grantedScopes: ["market-data"] });
  assert.equal(decision.verdict, "BLOCK");
  assert.ok(decision.reasons.some((r) => r.code === "SCOPE_NOT_GRANTED"));
});

test("an engaged kill switch blocks regardless of everything else", () => {
  const decision = evaluateIntent(mockIntent({ ...BASE, notionalUsd: 1 }), { ...CONTEXT, killSwitchEngaged: true });
  assert.equal(decision.verdict, "BLOCK");
  assert.ok(decision.reasons.some((r) => r.code === "KILL_SWITCH_ENGAGED"));
});

/** A gap in knowledge must never render as safety — the same invariant `dataTone` enforces. */
test("stale or unknown market data downgrades an otherwise allowable order", () => {
  for (const dataState of ["stale", "unknown"]) {
    const decision = evaluateIntent(mockIntent(BASE), { ...CONTEXT, dataState });
    assert.notEqual(decision.verdict, "ALLOW", `${dataState} data must not produce ALLOW`);
  }
  const conflicting = evaluateIntent(mockIntent(BASE), { ...CONTEXT, dataState: "conflicting" });
  assert.equal(conflicting.verdict, "BLOCK");
});

test("a non-tradable instrument is BLOCK", () => {
  const decision = evaluateIntent(mockIntent(BASE), { ...CONTEXT, tradable: false });
  assert.equal(decision.verdict, "BLOCK");
  assert.ok(decision.reasons.some((r) => r.code === "INSTRUMENT_NOT_TRADABLE"));
});

/** BLOCK is absorbing: one blocking reason is not outvoted by any number of softer ones. */
test("BLOCK dominates REVIEW when both apply", () => {
  const decision = evaluateIntent(mockIntent({ ...BASE, notionalUsd: 50_000 }), {
    ...CONTEXT,
    killSwitchEngaged: true,
  });
  assert.equal(decision.verdict, "BLOCK");
  assert.ok(decision.reasons.some((r) => r.code === "ABOVE_REVIEW_THRESHOLD"));
  assert.ok(decision.reasons.some((r) => r.code === "KILL_SWITCH_ENGAGED"));
});

test("a withdrawal is refused as unrepresentable, not merely blocked", () => {
  assert.throws(() => mockIntent({ ...BASE, side: "WITHDRAW" }), /withdraw/i);
});

/**
 * The load-bearing property of this whole module: it decides, and there is no code path that
 * sends anything to Binance.
 */
test("evaluation is local: the decision names the dispatch as not implemented", () => {
  const decision = evaluateIntent(mockIntent(BASE), CONTEXT);
  assert.equal(decision.dispatched, false);
  assert.equal(decision.dispatch, DISPATCH_IS_NOT_IMPLEMENTED);
  assert.match(DISPATCH_IS_NOT_IMPLEMENTED, /not implemented/i);
});

test("evaluation performs no network call", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    throw new Error("evaluateIntent must not reach the network");
  };
  try {
    for (const notional of [1, 100, 10_000]) {
      evaluateIntent(mockIntent({ ...BASE, notionalUsd: notional }), CONTEXT);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

test("the evaluated intent is not mutated by evaluation", () => {
  const intent = mockIntent(BASE);
  const before = JSON.stringify(intent);
  evaluateIntent(intent, CONTEXT);
  assert.equal(JSON.stringify(intent), before);
});

test("every mock intent is marked as a mock and carries no credential field", () => {
  const intent = mockIntent(BASE);
  assert.equal(intent.mock, true);
  const serialized = JSON.stringify(intent);
  for (const forbidden of ["apiKey", "secret", "token", "signature", "privateKey"]) {
    assert.ok(!serialized.includes(forbidden), `a mock intent must not carry ${forbidden}`);
  }
});
