import { test } from "node:test";
import assert from "node:assert/strict";
import { StrategyAiBudgetController } from "./ai-budget.ts";

const REQUEST_1 = "00000000-0000-4000-8000-000000000001";
const REQUEST_2 = "00000000-0000-4000-8000-000000000002";
const REQUEST_3 = "00000000-0000-4000-8000-000000000003";
const REQUEST_4 = "00000000-0000-4000-8000-000000000004";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function controller(overrides = {}) {
  return new StrategyAiBudgetController({
    perUserLimit: 10,
    perUserWindowMs: 10_000,
    globalLimit: 20,
    globalWindowMs: 10_000,
    completedTtlMs: 1_000,
    maxCompletedEntries: 10,
    maxUserBuckets: 20,
    ...overrides,
  });
}

function input(userKey, requestId, operation = "formalize", payloadHash = HASH_A) {
  return { userKey, requestId, operation, payloadHash };
}

test("requestId and payloadHash are strict canonical digests and validation is synchronous", () => {
  const budget = controller();
  assert.throws(
    () => budget.execute(input("user-a", "NOT-A-UUID"), async () => "unused"),
    /canonical lowercase UUID/,
  );
  assert.throws(
    () => budget.execute(input("user-a", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"), async () => "unused"),
    /canonical lowercase UUID/,
  );
  assert.throws(
    () => budget.execute({ ...input("user-a", REQUEST_1), payloadHash: "not-a-hash" }, async () => "unused"),
    /lowercase SHA-256/,
  );
  assert.equal(budget.inFlightSize, 0);
  assert.equal(budget.userBucketSize, 0);
});

test("one user gets one in-flight call while distinct users can run concurrently", async () => {
  let calls = 0;
  let releaseA;
  let releaseB;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  const gateB = new Promise((resolve) => { releaseB = resolve; });
  const budget = controller({ inFlightRetryAfterSeconds: 3 });

  const first = budget.execute(input("user-a", REQUEST_1), async () => {
    calls += 1;
    await gateA;
    return "a";
  });
  const duplicatePending = await budget.execute(input("user-a", REQUEST_1), async () => {
    calls += 1;
    return "duplicate";
  });
  const otherRequestSameUser = await budget.execute(input("user-a", REQUEST_2, "review"), async () => {
    calls += 1;
    return "overlap";
  });
  const secondUser = budget.execute(input("user-b", REQUEST_1), async () => {
    calls += 1;
    await gateB;
    return "b";
  });

  assert.deepEqual(duplicatePending, { decision: "in-flight", retryAfterSeconds: 3 });
  assert.deepEqual(otherRequestSameUser, { decision: "in-flight", retryAfterSeconds: 3 });
  assert.equal(calls, 2);
  assert.equal(budget.inFlightSize, 2);

  releaseA();
  releaseB();
  assert.deepEqual(await first, {
    decision: "allowed",
    retryAfterSeconds: 0,
    completion: { ok: true, value: "a" },
  });
  assert.deepEqual(await secondUser, {
    decision: "allowed",
    retryAfterSeconds: 0,
    completion: { ok: true, value: "b" },
  });
  assert.equal(budget.inFlightSize, 0);
});

test("completed success is idempotent without consuming another budget slot", async () => {
  let calls = 0;
  const budget = controller({ perUserLimit: 1, globalLimit: 1 });
  const first = await budget.execute(input("user-a", REQUEST_1), async () => {
    calls += 1;
    return { proposal: 7 };
  });
  const replay = await budget.execute(input("user-a", REQUEST_1), async () => {
    calls += 1;
    return { proposal: 8 };
  });
  const newRequest = await budget.execute(input("user-a", REQUEST_2), async () => "unused");

  assert.equal(first.decision, "allowed");
  assert.deepEqual(replay, {
    decision: "idempotent",
    retryAfterSeconds: 0,
    completion: { ok: true, value: { proposal: 7 } },
  });
  assert.deepEqual(newRequest, { decision: "user-budget", retryAfterSeconds: 10 });
  assert.equal(calls, 1);
});

test("same idempotency UUID with a changed payload fails closed while complete or in flight", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const budget = controller();

  await budget.execute(input("user-a", REQUEST_1), async () => ++calls);
  assert.deepEqual(
    await budget.execute(input("user-a", REQUEST_1, "formalize", HASH_B), async () => ++calls),
    { decision: "idempotency-conflict", retryAfterSeconds: 0 },
  );

  const pending = budget.execute(input("user-a", REQUEST_2), async () => {
    calls += 1;
    await gate;
    return "done";
  });
  assert.deepEqual(
    await budget.execute(input("user-a", REQUEST_2, "formalize", HASH_B), async () => ++calls),
    { decision: "idempotency-conflict", retryAfterSeconds: 0 },
  );
  release();
  await pending;
  assert.equal(calls, 2);
});

test("global in-flight capacity stays bounded across expired windows and releases on settlement", async () => {
  let now = 0;
  const releases = [];
  const budget = controller({
    now: () => now,
    maxGlobalInFlight: 2,
    inFlightRetryAfterSeconds: 4,
    perUserWindowMs: 100,
    globalWindowMs: 100,
  });
  const hold = (userKey, requestId) => budget.execute(input(userKey, requestId), async () => {
    await new Promise((resolve) => { releases.push(resolve); });
    return userKey;
  });

  const first = hold("user-a", REQUEST_1);
  const second = hold("user-b", REQUEST_1);
  assert.deepEqual(
    await budget.execute(input("user-c", REQUEST_1), async () => "c"),
    { decision: "global-in-flight", retryAfterSeconds: 4 },
  );

  now = 1_000;
  assert.deepEqual(
    await budget.execute(input("user-c", REQUEST_1), async () => "c"),
    { decision: "global-in-flight", retryAfterSeconds: 4 },
    "expired request windows cannot evict unresolved calls",
  );
  assert.equal(budget.inFlightSize, 2);

  releases.shift()();
  await first;
  const third = hold("user-c", REQUEST_1);
  assert.equal(budget.inFlightSize, 2);
  releases.shift()();
  releases.shift()();
  await Promise.all([second, third]);
  assert.equal(budget.inFlightSize, 0);
});

test("per-user and global fixed-window budgets expose precise Retry-After and reset", async () => {
  let now = 10_000;
  const budget = controller({
    now: () => now,
    perUserLimit: 2,
    perUserWindowMs: 2_500,
    globalLimit: 3,
    globalWindowMs: 4_500,
  });

  assert.equal((await budget.execute(input("user-a", REQUEST_1), async () => 1)).decision, "allowed");
  assert.equal((await budget.execute(input("user-a", REQUEST_2), async () => 2)).decision, "allowed");
  assert.deepEqual(
    await budget.execute(input("user-a", REQUEST_3), async () => 3),
    { decision: "user-budget", retryAfterSeconds: 3 },
  );
  assert.equal((await budget.execute(input("user-b", REQUEST_1), async () => 4)).decision, "allowed");
  assert.deepEqual(
    await budget.execute(input("user-c", REQUEST_1), async () => 5),
    { decision: "global-budget", retryAfterSeconds: 5 },
  );

  now = 12_500;
  assert.deepEqual(
    await budget.execute(input("user-a", REQUEST_3), async () => 6),
    { decision: "global-budget", retryAfterSeconds: 2 },
    "the user window resets independently while the global window remains closed",
  );

  now = 14_500;
  assert.equal((await budget.execute(input("user-a", REQUEST_3), async () => 7)).decision, "allowed");
});

test("completed cache has absolute TTL, LRU capacity, and explicit cleanup", async () => {
  let now = 0;
  let calls = 0;
  const budget = controller({
    now: () => now,
    completedTtlMs: 100,
    maxCompletedEntries: 2,
    perUserWindowMs: 50,
  });
  const run = (requestId) => budget.execute(input("user-a", requestId), async () => ++calls);

  await run(REQUEST_1);
  now = 1;
  await run(REQUEST_2);
  now = 2;
  assert.equal((await run(REQUEST_1)).decision, "idempotent", "a cache hit makes request 1 most recent");
  now = 3;
  await run(REQUEST_3);
  assert.equal(budget.completedSize, 2);
  now = 4;
  assert.equal((await run(REQUEST_2)).decision, "allowed", "the least-recent completed entry was evicted");
  assert.equal(calls, 4);

  now = 104;
  assert.deepEqual(budget.cleanup(), { completedEntries: 0, userBuckets: 0, inFlightUsers: 0 });
  assert.equal((await run(REQUEST_1)).decision, "allowed", "an entry can run again at its TTL boundary");
  assert.equal(calls, 5);
});

test("a failed loader settles, unlocks concurrency, and dedupes an immutable error snapshot", async () => {
  let calls = 0;
  const failure = new Error("provider timeout");
  const budget = controller();
  const first = await budget.execute(input("user-a", REQUEST_1, "review"), async () => {
    calls += 1;
    throw failure;
  });
  const replay = await budget.execute(input("user-a", REQUEST_1, "review"), async () => {
    calls += 1;
    return "must not run";
  });
  const next = await budget.execute(input("user-a", REQUEST_2, "review"), async () => "recovered");

  assert.equal(first.decision, "allowed");
  assert.equal(first.completion.ok, false);
  assert.deepEqual(first.completion.error, { name: "Error", message: "provider timeout" });
  assert.equal(replay.decision, "idempotent");
  assert.equal(replay.completion.ok, false);
  assert.deepEqual(replay.completion.error, { name: "Error", message: "provider timeout" });
  assert.notEqual(replay.completion, first.completion);
  assert.deepEqual(next, {
    decision: "allowed",
    retryAfterSeconds: 0,
    completion: { ok: true, value: "recovered" },
  });
  assert.equal(calls, 1);
  assert.equal(budget.inFlightSize, 0);
});

test("settlement survives an invalid clock, unlocks, and caches using admission time", async () => {
  let clockReads = 0;
  let now = 0;
  const budget = controller({
    now: () => {
      clockReads += 1;
      if (clockReads === 2) throw new Error("clock failed");
      return now;
    },
  });

  const first = await budget.execute(input("user-a", REQUEST_1), async () => "settled");
  assert.equal(first.decision, "allowed");
  assert.equal(budget.inFlightSize, 0);
  assert.equal(budget.completedSize, 1);

  now = 100;
  const replay = await budget.execute(input("user-a", REQUEST_1), async () => "must not run");
  assert.equal(replay.decision, "idempotent");

  const invalidAtAdmission = controller({ now: () => Number.NaN });
  assert.throws(
    () => invalidAtAdmission.execute(input("user-a", REQUEST_2), async () => "unused"),
    /non-negative finite timestamp/,
  );
});

test("cached completions are immutable snapshots and unsafe values or errors fail closed", async () => {
  const budget = controller();
  const original = { nested: { score: 7 } };
  const first = await budget.execute(input("user-a", REQUEST_1), async () => original);
  original.nested.score = 99;
  assert.deepEqual(first.completion, { ok: true, value: { nested: { score: 7 } } });
  assert.throws(() => { first.completion.value.nested.score = 11; }, TypeError);

  const replay = await budget.execute(input("user-a", REQUEST_1), async () => ({ nested: { score: 12 } }));
  assert.equal(replay.decision, "idempotent");
  assert.notEqual(replay.completion, first.completion);
  assert.deepEqual(replay.completion, { ok: true, value: { nested: { score: 7 } } });

  const unsafe = await budget.execute(input("user-a", REQUEST_2), async () => ({ callback() {} }));
  assert.equal(unsafe.decision, "allowed");
  assert.deepEqual(unsafe.completion, {
    ok: false,
    error: { name: "UncacheableCompletion", message: "AI loader completion was not JSON-safe" },
  });
  const unsafeReplay = await budget.execute(input("user-a", REQUEST_2), async () => "must not run");
  assert.equal(unsafeReplay.decision, "idempotent");
  assert.notEqual(unsafeReplay.completion, unsafe.completion);
  assert.deepEqual(unsafeReplay.completion, unsafe.completion);

  const protoPayload = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
  const protoSafe = await budget.execute(input("user-a", REQUEST_4), async () => protoPayload);
  assert.equal(protoSafe.completion.ok, true);
  assert.equal(Object.getPrototypeOf(protoSafe.completion.value), Object.prototype);
  assert.equal(Object.hasOwn(protoSafe.completion.value, "__proto__"), true);
  assert.equal({}.polluted, undefined);

  const hostileError = {};
  Object.defineProperty(hostileError, "message", { get() { throw new Error("getter ran"); } });
  const failed = await budget.execute(input("user-a", REQUEST_3), async () => { throw hostileError; });
  assert.deepEqual(failed.completion, {
    ok: false,
    error: { name: "Error", message: "AI loader failed" },
  });
});

test("user bucket capacity fails closed and expired buckets free capacity", async () => {
  let now = 0;
  const budget = controller({
    now: () => now,
    maxUserBuckets: 2,
    perUserWindowMs: 2_100,
  });
  await budget.execute(input("user-a", REQUEST_1), async () => "a");
  await budget.execute(input("user-b", REQUEST_1), async () => "b");
  assert.deepEqual(
    await budget.execute(input("user-c", REQUEST_1), async () => "c"),
    { decision: "global-budget", retryAfterSeconds: 3 },
  );

  now = 2_100;
  assert.equal((await budget.execute(input("user-c", REQUEST_1), async () => "c")).decision, "allowed");
  assert.equal(budget.userBucketSize, 1);
});

test("idempotency is scoped by user and operation", async () => {
  let calls = 0;
  const budget = controller();
  const run = (userKey, operation) => budget.execute(input(userKey, REQUEST_4, operation), async () => ++calls);

  assert.equal((await run("user-a", "formalize")).decision, "allowed");
  assert.equal((await run("user-a", "review")).decision, "allowed");
  assert.equal((await run("user-b", "formalize")).decision, "allowed");
  assert.equal((await run("user-a", "formalize")).decision, "idempotent");
  assert.equal(calls, 3);
});