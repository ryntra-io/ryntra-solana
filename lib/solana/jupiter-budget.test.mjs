import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  JUPITER_ORDER_RETRY_WAIT_MAX_MS,
  JUPITER_RETRY_WAIT_MAX_MS,
  jupiterBackgroundAllowed,
  jupiterBudget,
  jupiterReserve,
  jupiterRetryWaitMs,
  noteJupiterResponse,
  readJupiterRateHeaders,
  resetJupiterBudget,
} from "./jupiter-budget.ts";

const T0 = Date.UTC(2026, 8, 15, 0, 20, 0);
const headers = (entries) => new Headers(Object.entries(entries).map(([k, v]) => [k, String(v)]));

beforeEach(() => resetJupiterBudget());

test("the provider's rate headers are read as integers and epoch seconds, and anything else is null", () => {
  const read = readJupiterRateHeaders(headers({ "x-ratelimit-current": "7", "x-ratelimit-remaining": "53", "x-ratelimit-reset": "1789452596", "retry-after": "2" }));
  assert.deepEqual(read, { current: 7, remaining: 53, resetAt: 1789452596000, retryAfterMs: 2000 });
  assert.deepEqual(readJupiterRateHeaders(headers({ "x-ratelimit-remaining": "-1", "x-ratelimit-reset": "soon" })), { current: null, remaining: null, resetAt: null, retryAfterMs: null });
  assert.deepEqual(readJupiterRateHeaders(new Headers()), { current: null, remaining: null, resetAt: null, retryAfterMs: null });
});

test("the reserve is a quarter of the observed window and never fewer than three requests", () => {
  assert.equal(jupiterReserve(null), 3);
  assert.equal(jupiterReserve(5), 3);
  assert.equal(jupiterReserve(60), 15);
  assert.equal(jupiterReserve(600), 150);
});

test("nothing is low until the provider has said so; a healthy window allows background work", () => {
  assert.equal(jupiterBackgroundAllowed(T0), true);
  assert.deepEqual(jupiterBudget("shared", T0), { limit: null, remaining: null, resetAt: null, observedAt: null, low: false });
  noteJupiterResponse(headers({ "x-ratelimit-current": "2", "x-ratelimit-remaining": "58", "x-ratelimit-reset": String(Math.floor(T0 / 1000) + 45) }), "shared", { now: () => T0 });
  const budget = jupiterBudget("shared", T0);
  assert.equal(budget.limit, 60);
  assert.equal(budget.remaining, 58);
  assert.equal(budget.low, false);
  assert.equal(jupiterBackgroundAllowed(T0), true);
});

test("a nearly spent window is low until its reset, then reads as unknown again — never as low forever", () => {
  const warnings = [];
  const reset = Math.floor(T0 / 1000) + 40;
  noteJupiterResponse(headers({ "x-ratelimit-current": "55", "x-ratelimit-remaining": "5", "x-ratelimit-reset": String(reset) }), "shared", { now: () => T0, warn: (m) => warnings.push(m) });
  assert.equal(jupiterBudget("shared", T0).low, true, "5 of 60 is below the 15-request reserve");
  assert.equal(jupiterBackgroundAllowed(T0), false);
  assert.equal(jupiterBackgroundAllowed(T0 + 39_000), false);
  assert.equal(jupiterBackgroundAllowed(T0 + 41_000), true, "the window has reset");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /jupiter budget low \(shared\): 5 of 60 left in the window, reset in 40 s/);
  /* The same window does not warn twice; a new window does. */
  noteJupiterResponse(headers({ "x-ratelimit-current": "57", "x-ratelimit-remaining": "3", "x-ratelimit-reset": String(reset) }), "shared", { now: () => T0 + 1000, warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 1);
  noteJupiterResponse(headers({ "x-ratelimit-current": "58", "x-ratelimit-remaining": "2", "x-ratelimit-reset": String(reset + 60) }), "shared", { now: () => T0 + 61_000, warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 2);
});

test("the execute bucket is its own ledger and never lowers the shared one", () => {
  noteJupiterResponse(headers({ "x-ratelimit-current": "49", "x-ratelimit-remaining": "1", "x-ratelimit-reset": String(Math.floor(T0 / 1000) + 30) }), "execute", { now: () => T0, warn: () => {} });
  assert.equal(jupiterBudget("execute", T0).low, true);
  assert.equal(jupiterBackgroundAllowed(T0), true);
});

test("a stale observation says nothing: ninety seconds without an answer reads as unknown", () => {
  noteJupiterResponse(headers({ "x-ratelimit-current": "59", "x-ratelimit-remaining": "1" }), "shared", { now: () => T0, warn: () => {} });
  assert.equal(jupiterBudget("shared", T0).low, true, "no reset header: low while the observation is fresh");
  assert.equal(jupiterBudget("shared", T0 + 91_000).low, false);
});

test("the observed limit only grows: a smaller current+remaining later does not shrink the known window", () => {
  noteJupiterResponse(headers({ "x-ratelimit-current": "10", "x-ratelimit-remaining": "590" }), "shared", { now: () => T0 });
  noteJupiterResponse(headers({ "x-ratelimit-current": "1", "x-ratelimit-remaining": "9" }), "shared", { now: () => T0 + 500, warn: () => {} });
  assert.equal(jupiterBudget("shared", T0 + 500).limit, 600);
});

test("a bounded wait: retry-after first, else the reset, and null when either is longer than the bound", () => {
  const nowS = Math.floor(T0 / 1000);
  assert.equal(jupiterRetryWaitMs(headers({ "retry-after": "1" }), T0), 1000);
  assert.equal(jupiterRetryWaitMs(headers({ "x-ratelimit-reset": String(nowS + 2) }), T0), 2000);
  assert.equal(jupiterRetryWaitMs(headers({ "retry-after": "1", "x-ratelimit-reset": String(nowS + 2) }), T0), 1000);
  assert.equal(jupiterRetryWaitMs(headers({ "retry-after": "30" }), T0), null);
  assert.equal(jupiterRetryWaitMs(headers({ "x-ratelimit-reset": String(nowS + 40) }), T0), null);
  assert.equal(jupiterRetryWaitMs(new Headers(), T0), null);
  assert.equal(JUPITER_RETRY_WAIT_MAX_MS, 2_500);
});

test("a person's signable order names a longer bound — the window's own ten seconds", () => {
  const nowS = Math.floor(T0 / 1000);
  assert.equal(JUPITER_ORDER_RETRY_WAIT_MAX_MS, 10_000);
  assert.equal(jupiterRetryWaitMs(headers({ "x-ratelimit-reset": String(nowS + 4) }), T0), null, "a read does not wait 4 s");
  assert.equal(jupiterRetryWaitMs(headers({ "x-ratelimit-reset": String(nowS + 4) }), T0, JUPITER_ORDER_RETRY_WAIT_MAX_MS), 4000);
  assert.equal(jupiterRetryWaitMs(headers({ "x-ratelimit-reset": String(nowS + 11) }), T0, JUPITER_ORDER_RETRY_WAIT_MAX_MS), null);
});
