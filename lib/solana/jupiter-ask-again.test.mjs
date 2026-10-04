import assert from "node:assert/strict";
import test from "node:test";

import { askOnceMoreAfterRate, rateWaitOf } from "./jupiter-ask-again.ts";
import { JUPITER_ORDER_RETRY_WAIT_MAX_MS, JUPITER_RETRY_WAIT_MAX_MS } from "./jupiter-budget.ts";

/**
 * One more ask of Jupiter after a refusal for rate alone — the quote and the
 * signable order: only after the provider's own pause, only once, never for
 * any other refusal; a read waits at most 2.5 s, a person's order up to the
 * window's ten seconds.
 */

const answered = { ok: true, order: { requestId: "a" } };
const rate = (retryWaitMs) => ({ ok: false, code: "RATE_LIMITED", retryWaitMs, reason: "rate-limited" });

function asker(answers) {
  const calls = [];
  return {
    calls,
    ask: async () => {
      calls.push(calls.length);
      return answers[Math.min(calls.length - 1, answers.length - 1)];
    },
  };
}

test("a refusal for rate with a short pause is asked once more after exactly that pause, and the second answer is the answer", async () => {
  const { calls, ask } = asker([rate(1200), answered]);
  const sleeps = [];
  const result = await askOnceMoreAfterRate(ask, { sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(result, answered);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [1200]);
});

test("only once: a second refusal is the answer, never a third ask", async () => {
  const { calls, ask } = asker([rate(300), rate(300), answered]);
  const result = await askOnceMoreAfterRate(ask, { sleep: async () => {} });
  assert.equal(calls.length, 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, "RATE_LIMITED");
});

test("a reset too far away, or none stated, is answered at once — no wait, no second ask", async () => {
  for (const wait of [null, undefined, JUPITER_RETRY_WAIT_MAX_MS + 1, 40_000, -5, Number.NaN]) {
    const { calls, ask } = asker([rate(wait), answered]);
    const sleeps = [];
    const result = await askOnceMoreAfterRate(ask, { sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(calls.length, 1, `wait ${wait}`);
    assert.deepEqual(sleeps, []);
    assert.equal(result.ok, false);
  }
  assert.equal(rateWaitOf(rate(JUPITER_RETRY_WAIT_MAX_MS)), JUPITER_RETRY_WAIT_MAX_MS, "the bound itself is worth the wait");
});

test("a person's order waits for the window itself: the refusal of 2026-09-28, the reset 4 s away, is asked again after 4 s", async () => {
  assert.equal(JUPITER_ORDER_RETRY_WAIT_MAX_MS, 10_000);
  const { calls, ask } = asker([rate(4_000), answered]);
  const sleeps = [];
  const result = await askOnceMoreAfterRate(ask, { sleep: async (ms) => { sleeps.push(ms); }, maxWaitMs: JUPITER_ORDER_RETRY_WAIT_MAX_MS });
  assert.equal(result, answered);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [4_000]);
  /* A read does not wait that long; nor does an order past the window. */
  assert.equal(rateWaitOf(rate(4_000)), null);
  assert.equal(rateWaitOf(rate(JUPITER_ORDER_RETRY_WAIT_MAX_MS + 1), JUPITER_ORDER_RETRY_WAIT_MAX_MS), null);
});

test("any other refusal, and any answer, is never asked again", async () => {
  for (const first of [answered, { ok: false, code: "NO_ROUTE", retryWaitMs: 100 }, { ok: false, code: "HTTP_ERROR" }, { ok: false, code: "UNREACHABLE", retryWaitMs: 0 }, { ok: false, code: "BUILD_FAILED" }]) {
    const { calls, ask } = asker([first, answered]);
    const result = await askOnceMoreAfterRate(ask, { sleep: async () => { throw new Error("no wait expected"); }, maxWaitMs: JUPITER_ORDER_RETRY_WAIT_MAX_MS });
    assert.equal(calls.length, 1);
    assert.equal(result, first);
  }
});
