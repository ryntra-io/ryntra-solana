import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DISPATCH_IS_NOT_IMPLEMENTED, evaluateMockIntent, mockIntent } from "./preflight.ts";

function context(overrides) {
  return {
    reachability: "JURISDICTION_BLOCKED",
    topology: "NO_PATH",
    perOrderHumanApproval: "OPTIONAL_CLIENT_SIDE",
    dataState: "unknown",
    reviewAboveUsd: 500,
    ...overrides,
  };
}

test("the evaluator decides and never acts", function () {
  const decision = evaluateMockIntent(mockIntent({ effect: "OBSERVE_LOCAL", symbol: "TSLA" }), context());
  assert.equal(decision.dispatched, false);
  assert.equal(decision.dispatch, DISPATCH_IS_NOT_IMPLEMENTED);
  const source = readFileSync(new URL("./preflight.ts", import.meta.url), "utf8");
  assert.ok(!/\bfetch\s*\(/.test(source), "preflight must not reach the network");
  assert.ok(!/agent\.robinhood\.com/.test(source), "preflight must hold no venue endpoint");
});

test("every intent is marked a mock so it cannot be mistaken for a real one", function () {
  const intent = mockIntent({ effect: "WRITE_ORDER", symbol: "TSLA", side: "BUY", notionalUsd: 10 });
  assert.equal(intent.mock, true);
  assert.equal(intent.venue, "robinhood-brokerage");
  assert.equal(intent.surface, "robinhood-trading-mcp");
});

test("a closed door blocks anything that would touch the venue", function () {
  for (const effect of ["READ_PROVIDER", "WRITE_NO_ASSET", "WRITE_ORDER"]) {
    const decision = evaluateMockIntent(mockIntent({ effect, symbol: "TSLA" }), context());
    assert.equal(decision.verdict, "BLOCK", effect);
    assert.ok(
      decision.reasons.some(function (r) { return r.code === "VENUE_UNREACHABLE"; }),
      effect + " must name the refusal",
    );
  }
});

test("a write is blocked even when the door is open, because no Ryntra adapter carries it", function () {
  const decision = evaluateMockIntent(
    mockIntent({ effect: "WRITE_ORDER", symbol: "TSLA", side: "BUY", notionalUsd: 10 }),
    context({ reachability: "REACHABLE", dataState: "fresh" }),
  );
  assert.equal(decision.verdict, "BLOCK");
  assert.ok(decision.reasons.some(function (r) { return r.code === "NO_ENFORCED_PATH"; }));
  /* And the reason is the topology, not the size: a one-dollar order fails the
     same way a million-dollar one does. */
  const tiny = evaluateMockIntent(
    mockIntent({ effect: "WRITE_ORDER", symbol: "TSLA", side: "BUY", notionalUsd: 1 }),
    context({ reachability: "REACHABLE", dataState: "fresh" }),
  );
  assert.equal(tiny.verdict, "BLOCK");
});

test("an order that no human sees is refused on its own axis", function () {
  const decision = evaluateMockIntent(
    mockIntent({ effect: "WRITE_ORDER", symbol: "TSLA", side: "BUY", notionalUsd: 10 }),
    context({
      reachability: "REACHABLE",
      topology: "AGENT_THROUGH_RYNTRA_ADAPTER",
      dataState: "fresh",
      perOrderHumanApproval: "NONE",
    }),
  );
  assert.equal(decision.verdict, "BLOCK");
  assert.ok(decision.reasons.some(function (r) { return r.code === "NO_HUMAN_AUTHORIZATION"; }));
});

test("BLOCK is absorbing and collects every reason rather than the first", function () {
  const decision = evaluateMockIntent(
    mockIntent({ effect: "WRITE_ORDER", symbol: "TSLA", side: "BUY", notionalUsd: 100000 }),
    context({ dataState: "conflicting", perOrderHumanApproval: "NONE" }),
  );
  assert.equal(decision.verdict, "BLOCK");
  const codes = decision.reasons.map(function (r) { return r.code; });
  for (const code of [
    "VENUE_UNREACHABLE",
    "NO_ENFORCED_PATH",
    "NO_HUMAN_AUTHORIZATION",
    "CONFLICTING_MARKET_DATA",
    "ABOVE_REVIEW_THRESHOLD",
  ]) {
    assert.ok(codes.includes(code), code + " must be reported");
  }
});

test("a local observation of an already-imported record is the one thing that can be allowed", function () {
  const decision = evaluateMockIntent(
    mockIntent({ effect: "OBSERVE_LOCAL", symbol: "TSLA" }),
    context({ dataState: "fresh" }),
  );
  assert.equal(decision.verdict, "ALLOW");
  assert.deepEqual(decision.reasons, []);
});

test("stale or unknown local data is reviewed, never silently allowed", function () {
  for (const dataState of ["stale", "unknown"]) {
    const decision = evaluateMockIntent(
      mockIntent({ effect: "OBSERVE_LOCAL", symbol: "TSLA" }),
      context({ dataState }),
    );
    assert.equal(decision.verdict, "REVIEW", dataState);
  }
});

test("an unknown effect is treated as an order, not as a read", function () {
  const decision = evaluateMockIntent(
    { mock: true, venue: "robinhood-brokerage", surface: "robinhood-trading-mcp", effect: "SOMETHING_NEW", symbol: "TSLA", side: null, notionalUsd: 0 },
    context({ reachability: "REACHABLE", dataState: "fresh" }),
  );
  assert.equal(decision.verdict, "BLOCK");
  assert.ok(decision.reasons.some(function (r) { return r.code === "NO_ENFORCED_PATH"; }));
});
