// Run from repo root: node --test lib/phoenix/feed-lifecycle.test.mjs
//
// PERP-4 — the life of Phoenix's data on the page (spec §18): a snapshot makes it live, deltas keep it live in order,
// a failure or silence makes it stale («Дані не оновлюються» with the last update's time), and only a fresh snapshot
// brings it back — a delta never patches a stale cache to life.
import assert from "node:assert/strict";
import test from "node:test";

import { COLD_FEED, MARKETS_MAX_AGE_MS, feedStale, feedStep } from "./feed-lifecycle.ts";

const run = (events, from = COLD_FEED) => events.reduce(feedStep, from);

test("a snapshot makes the data live, as old as it waited at the edge", () => {
  const live = run([{ kind: "snapshot", at: 1_000, wall: 1_700_000_000_000, ageMs: 2_000 }]);
  assert.equal(live.phase, "live");
  assert.equal(live.freshAt, -1_000, "the edge's two seconds count");
  assert.equal(live.updatedAt, 1_699_999_998_000, "the time a person reads is the data's, not the arrival's");
  assert.equal(feedStale(live), false);
});

test("silence past the limit is stale, and the last update's time stays to be said", () => {
  const live = run([{ kind: "snapshot", at: 0, wall: 5_000, ageMs: 0 }]);
  assert.equal(feedStep(live, { kind: "tick", now: MARKETS_MAX_AGE_MS, maxAgeMs: MARKETS_MAX_AGE_MS }).phase, "live", "at the limit it is still live");
  const quiet = feedStep(live, { kind: "tick", now: MARKETS_MAX_AGE_MS + 1, maxAgeMs: MARKETS_MAX_AGE_MS });
  assert.equal(quiet.phase, "stale");
  assert.equal(quiet.updatedAt, 5_000);
  assert.equal(feedStale(quiet), true);
});

test("a read that failed is stale at once — the old mark is never shown as live (REVIEW §6.2)", () => {
  const live = run([{ kind: "snapshot", at: 0, wall: 10, ageMs: 0 }]);
  const failed = feedStep(live, { kind: "fail" });
  assert.equal(failed.phase, "recovering");
  assert.equal(feedStale(failed), true);
  assert.equal(failed.updatedAt, 10, "the time of the last good read stays");
  /* Before any good read there is nothing to call stale: the page says «unavailable» instead. */
  assert.equal(feedStep(COLD_FEED, { kind: "fail" }).phase, "cold");
});

test("deltas keep it live only in order; a gap or a stale cache waits for a fresh snapshot", () => {
  let state = run([{ kind: "snapshot", at: 0, wall: 0 }, { kind: "delta", at: 100, wall: 100, seq: 7 }, { kind: "delta", at: 200, wall: 200, seq: 8 }]);
  assert.deepEqual([state.phase, state.seq, state.freshAt], ["live", 8, 200]);
  state = feedStep(state, { kind: "delta", at: 300, wall: 300, seq: 10 });
  assert.equal(state.phase, "recovering", "a missed delta: the cache is no longer whole");
  /* Deltas do not bring a stale cache back, however many come. */
  state = feedStep(state, { kind: "delta", at: 400, wall: 400, seq: 11 });
  assert.equal(state.phase, "recovering");
  assert.equal(state.freshAt, 200);
  const quiet = feedStep(run([{ kind: "snapshot", at: 0, wall: 0 }]), { kind: "tick", now: 60_000, maxAgeMs: 1_000 });
  assert.equal(feedStep(quiet, { kind: "delta", at: 61_000, wall: 61_000, seq: 1 }).phase, "stale");
  /* A fresh snapshot recovers, and the deltas' count starts again from it. */
  const back = feedStep(state, { kind: "snapshot", at: 500, wall: 500 });
  assert.deepEqual([back.phase, back.seq], ["live", null]);
});

test("a 15-second break (spec §19, scenario 10) is seen within one poll, and the page comes back by itself", () => {
  /* Polls every five seconds: two good reads, then three that fail — the network or Phoenix gone for fifteen seconds. */
  let state = run([{ kind: "snapshot", at: 0, wall: 0 }, { kind: "snapshot", at: 5_000, wall: 5_000 }]);
  const seen = [];
  for (const at of [10_000, 15_000, 20_000]) {
    state = feedStep(feedStep(state, { kind: "fail" }), { kind: "tick", now: at, maxAgeMs: MARKETS_MAX_AGE_MS });
    seen.push([at, feedStale(state), state.updatedAt]);
  }
  assert.deepEqual(seen, [[10_000, true, 5_000], [15_000, true, 5_000], [20_000, true, 5_000]], "stale from the first failed read, the last update's time held");
  state = feedStep(state, { kind: "snapshot", at: 25_000, wall: 25_000 });
  assert.equal(feedStale(state), false, "the next good read brings it back");
  /* A read that hangs instead of failing: stale once the data is older than the limit. */
  const hung = feedStep(run([{ kind: "snapshot", at: 0, wall: 0 }]), { kind: "tick", now: MARKETS_MAX_AGE_MS + 1_000, maxAgeMs: MARKETS_MAX_AGE_MS });
  assert.equal(feedStale(hung), true);
  assert.ok(MARKETS_MAX_AGE_MS <= 20_000, "a hung break is said within twenty seconds");
});
