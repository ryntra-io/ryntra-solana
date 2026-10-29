import { test } from "node:test";
import assert from "node:assert/strict";

import { awaitLanding } from "./landing.ts";

/** A clock that only moves when the loop sleeps. */
function clock() {
  let now = 0;
  return { now: () => now, sleep: async (ms) => { now += ms; } };
}

test("the same bytes go out again every two seconds until the signature is seen", async () => {
  const time = clock();
  const resentAt = [];
  let reads = 0;
  const result = await awaitLanding(
    {
      observe: async () => {
        reads += 1;
        return time.now() >= 4_500 ? { seen: true, settlement: "SETTLED" } : { seen: false, settlement: "NOT_SEEN" };
      },
      resend: async () => { resentAt.push(time.now()); },
      ...time,
    },
    { deadlineMs: 30_000, observeEveryMs: 500, resendEveryMs: 2_000 },
  );
  assert.deepEqual(result.last, { seen: true, settlement: "SETTLED" });
  assert.deepEqual(resentAt, [2_000, 4_000]);
  assert.equal(result.resends, 2);
  /* read every half second: 0, 0.5 … 4.5 s */
  assert.equal(reads, 10);
});

test("a signature seen at the first read sends nothing again", async () => {
  const time = clock();
  let resends = 0;
  const result = await awaitLanding(
    { observe: async () => ({ seen: true, settlement: "SETTLED" }), resend: async () => { resends += 1; }, ...time },
    { deadlineMs: 30_000 },
  );
  assert.equal(result.last.seen, true);
  assert.equal(resends, 0);
  assert.equal(time.now(), 0);
});

test("past the deadline the loop stops unseen and says so — recovery by signature is then the answer", async () => {
  const time = clock();
  let resends = 0;
  const result = await awaitLanding(
    { observe: async () => ({ seen: false, settlement: "NOT_SEEN" }), resend: async () => { resends += 1; }, ...time },
    { deadlineMs: 30_000, observeEveryMs: 500, resendEveryMs: 2_000 },
  );
  assert.equal(result.last.seen, false);
  assert.ok(time.now() >= 30_000 && time.now() <= 30_500, `stopped at ${time.now()}`);
  assert.equal(resends, 14, "at 2, 4 … 28 s — none at or after the deadline");
});

test("a re-send that throws changes nothing: the loop reads on", async () => {
  const time = clock();
  const result = await awaitLanding(
    {
      observe: async () => (time.now() >= 3_000 ? { seen: true, settlement: "LANDED_FAILED" } : { seen: false, settlement: "NOT_SEEN" }),
      resend: async () => { throw new Error("socket hang up"); },
      ...time,
    },
    { deadlineMs: 30_000 },
  );
  assert.deepEqual(result.last, { seen: true, settlement: "LANDED_FAILED" });
});

test("with re-sends switched off the loop only reads (the venue's own lane)", async () => {
  const time = clock();
  let resends = 0;
  const result = await awaitLanding(
    { observe: async () => ({ seen: false, settlement: "NOT_SEEN" }), resend: async () => { resends += 1; }, ...time },
    { deadlineMs: 6_000, resendEveryMs: Number.POSITIVE_INFINITY },
  );
  assert.equal(result.last.seen, false);
  assert.equal(resends, 0);
});

test("a read the caller just made is not repeated: the loop waits first", async () => {
  const time = clock();
  const readAt = [];
  const result = await awaitLanding(
    { observe: async () => { readAt.push(time.now()); return { seen: true, settlement: "SETTLED" }; }, resend: async () => {}, ...time },
    { deadlineMs: 30_000, initial: { seen: false, settlement: "NOT_SEEN" } },
  );
  assert.deepEqual(readAt, [500]);
  assert.equal(result.last.seen, true);
});
