import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { createSharedReads, pauseAfterRate, ratePauseLeftMs, RATE_PAUSE_DEFAULT_MS, RATE_PAUSE_MAX_MS, resetRatePauses, retryAfterHeader } from "./shared-reads.ts";

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const realNow = Date.now;
let now = T0;

beforeEach(() => {
  now = T0;
  Date.now = () => now;
  resetRatePauses();
});
afterEach(() => {
  Date.now = realNow;
});

const ok = (value) => ({ ok: true, value });
const limited = (retryAfterMs = null) => ({ ok: false, code: "RATE_LIMITED", reason: "429", retryAfterMs });

function counted(answer) {
  const calls = { n: 0 };
  const load = async () => {
    calls.n += 1;
    return typeof answer === "function" ? answer(calls.n) : answer;
  };
  return { calls, load };
}

test("the same key asked at once is one read: every caller gets the same answer", async () => {
  const reads = createSharedReads({ name: "t", provider: "jupiter", ttlMs: 10_000, heldMs: 60_000 });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const calls = { n: 0 };
  const load = async () => {
    calls.n += 1;
    await gate;
    return ok({ price: 1 });
  };
  const all = Promise.all(Array.from({ length: 12 }, () => reads.read("SOL", load)));
  release();
  const answers = await all;
  assert.equal(calls.n, 1, "twelve requests, one provider call");
  for (const answer of answers) assert.deepEqual(answer, { ok: true, value: { price: 1 }, readAt: T0, stale: false });
});

test("a read younger than its TTL is answered from memory; past it, read again", async () => {
  const reads = createSharedReads({ name: "t", provider: "jupiter", ttlMs: 10_000, heldMs: 60_000 });
  const { calls, load } = counted((n) => ok({ n }));
  assert.equal((await reads.read("k", load)).value.n, 1);
  now = T0 + 9_999;
  const cached = await reads.read("k", load);
  assert.equal(cached.value.n, 1);
  assert.equal(cached.readAt, T0, "the answer keeps the time it was read");
  assert.equal(calls.n, 1);
  now = T0 + 10_000;
  assert.equal((await reads.read("k", load)).value.n, 2);
  assert.equal(calls.n, 2);
});

test("different keys are different reads", async () => {
  const reads = createSharedReads({ name: "t", provider: "jupiter", ttlMs: 10_000, heldMs: 60_000 });
  const { calls, load } = counted(ok(1));
  await Promise.all([reads.read("a", load), reads.read("b", load), reads.read("a", load)]);
  assert.equal(calls.n, 2);
});

test("after a 429 the provider pauses: no key is asked until the pause ends, and the held copy is served stale with its own time", async () => {
  const reads = createSharedReads({ name: "t", provider: "jupiter", ttlMs: 10_000, heldMs: 60_000 });
  const other = createSharedReads({ name: "u", provider: "jupiter", ttlMs: 10_000, heldMs: 60_000 });
  let answer = ok({ price: 100 });
  const calls = { n: 0 };
  const load = async () => {
    calls.n += 1;
    return answer;
  };
  await reads.read("SOL", load);
  now = T0 + 20_000;
  answer = limited(4_000);
  const refused = await reads.read("SOL", load);
  assert.deepEqual(refused, { ok: true, value: { price: 100 }, readAt: T0, stale: true }, "the last good answer, stated stale, dated when it was read");
  assert.equal(calls.n, 2);
  assert.equal(ratePauseLeftMs("jupiter"), 4_000);

  /* Inside the pause: nothing is asked — not this key, not another layer's key of the same provider. */
  now = T0 + 22_000;
  answer = ok({ price: 101 });
  assert.equal((await reads.read("SOL", load)).stale, true);
  const cold = await other.read("BONK", load);
  assert.equal(cold.ok, false);
  assert.equal(cold.code, "RATE_LIMITED");
  assert.equal(cold.retryAfterMs, 2_000, "a key with nothing held says how long to wait");
  assert.equal(calls.n, 2, "no provider call inside the pause");

  /* The pause over: asked again, fresh. */
  now = T0 + 24_001;
  const fresh = await reads.read("SOL", load);
  assert.deepEqual(fresh, { ok: true, value: { price: 101 }, readAt: T0 + 24_001, stale: false });
  assert.equal(calls.n, 3);
});

test("a 429 with nothing held is the answer, with the wait; the default pause applies when the provider names none", async () => {
  const reads = createSharedReads({ name: "t", provider: "jupiter", ttlMs: 10_000, heldMs: 60_000 });
  const { calls, load } = counted(limited(null));
  const first = await reads.read("k", load);
  assert.equal(first.ok, false);
  assert.equal(first.code, "RATE_LIMITED");
  assert.equal(ratePauseLeftMs("jupiter"), RATE_PAUSE_DEFAULT_MS.jupiter);
  await reads.read("k", load);
  assert.equal(calls.n, 1);
});

test("the held copy has an age limit: past it the failure is the answer, never an old value", async () => {
  const reads = createSharedReads({ name: "t", provider: "jupiter", ttlMs: 10_000, heldMs: 60_000 });
  let answer = ok("v1");
  const load = async () => answer;
  await reads.read("k", load);
  now = T0 + 60_001;
  answer = { ok: false, code: "UNREACHABLE", reason: "down" };
  const read = await reads.read("k", load);
  assert.deepEqual(read, { ok: false, code: "UNREACHABLE", reason: "down" });
});

test("a caller that keeps its own memory can refuse the held copy", async () => {
  const reads = createSharedReads({ name: "t", provider: "jupiter", ttlMs: 10_000, heldMs: 60_000 });
  let answer = ok("v1");
  const load = async () => answer;
  await reads.read("k", load);
  now = T0 + 20_000;
  answer = limited(1_000);
  const read = await reads.read("k", load, { held: false });
  assert.equal(read.ok, false);
  assert.equal(read.code, "RATE_LIMITED");
});

test("a key whose read just failed is not asked again for a moment", async () => {
  const reads = createSharedReads({ name: "t", provider: "geckoterminal", ttlMs: 10_000, heldMs: 60_000, failureMs: 2_000 });
  const { calls, load } = counted({ ok: false, code: "UNREACHABLE", reason: "down" });
  await reads.read("k", load);
  now = T0 + 1_000;
  await reads.read("k", load);
  assert.equal(calls.n, 1);
  now = T0 + 2_000;
  await reads.read("k", load);
  assert.equal(calls.n, 2);
});

test("a thrown read is a failure, not a crash, and leaves nothing in flight", async () => {
  const reads = createSharedReads({ name: "t", provider: "jupiter", ttlMs: 10_000, heldMs: 60_000, failureMs: 0 });
  const read = await reads.read("k", async () => {
    throw new Error("boom");
  });
  assert.equal(read.ok, false);
  assert.equal(read.code, "UNREACHABLE");
  assert.equal((await reads.read("k", async () => ok(1))).value, 1);
});

test("the pause is bounded and the providers pause apart", () => {
  pauseAfterRate("geckoterminal", 10 * 60_000);
  assert.equal(ratePauseLeftMs("geckoterminal"), RATE_PAUSE_MAX_MS);
  assert.equal(ratePauseLeftMs("jupiter"), 0);
  pauseAfterRate("geckoterminal", 1_000);
  assert.equal(ratePauseLeftMs("geckoterminal"), RATE_PAUSE_MAX_MS, "a shorter pause does not cut a longer one");
});

test("Retry-After is whole seconds, at least one", () => {
  assert.deepEqual(retryAfterHeader(1_200), { "Retry-After": "2" });
  assert.deepEqual(retryAfterHeader(10), { "Retry-After": "1" });
  assert.deepEqual(retryAfterHeader(null), {});
  assert.deepEqual(retryAfterHeader(0), {});
});
