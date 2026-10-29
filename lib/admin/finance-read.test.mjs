import assert from "node:assert/strict";
import test from "node:test";

import { createReadKeeper, settleBy } from "./finance-read.ts";

test("a read past its deadline answers with what it gathered, never with nothing", async () => {
  const gathered = [];
  const work = new Promise((resolve) => {
    gathered.push("claim-1");
    setTimeout(() => resolve({ claims: ["claim-1", "claim-2"], complete: true }), 5_000);
  });
  const answer = await settleBy(work, Date.now() + 50, () => ({ claims: [...gathered], complete: false }));
  assert.deepEqual(answer, { claims: ["claim-1"], complete: false });
});

test("a read that ends in time answers whole; one that fails answers with what it gathered", async () => {
  assert.deepEqual(await settleBy(Promise.resolve({ complete: true }), Date.now() + 1_000, () => ({ complete: false })), { complete: true });
  assert.deepEqual(await settleBy(Promise.reject(new Error("429")), Date.now() + 1_000, () => ({ complete: false })), { complete: false });
  assert.deepEqual(await settleBy(new Promise(() => {}), Date.now() - 1, () => ({ late: true })), { late: true });
});

function keeper() {
  let clock = 0;
  const reads = [];
  const keep = createReadKeeper({
    read: () => {
      let resolve;
      const value = new Promise((done) => (resolve = done));
      reads.push({ resolve });
      return value;
    },
    keepMs: 600,
    budgetMs: 240,
    graceMs: 30,
    now: () => clock,
  });
  return { keep, reads, tick: (ms) => (clock += ms) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("the kept read: shared while fresh, answered at once when old while a new one runs behind, waited for on «Read again»", async () => {
  const { keep, reads, tick } = keeper();
  const first = keep.get();
  assert.equal(reads.length, 1);
  assert.ok(first.running, "the first read runs");
  reads[0].resolve("A");
  assert.deepEqual(await first.answer, { at: 0, value: "A" });
  await flush();
  tick(100);
  const shared = keep.get();
  assert.equal(reads.length, 1, "a fresh read is shared");
  assert.equal(shared.running, null);
  assert.deepEqual(await shared.answer, { at: 0, value: "A" });
  tick(600);
  const old = keep.get();
  assert.equal(reads.length, 2, "an old read starts a new one");
  assert.deepEqual(await old.answer, { at: 0, value: "A" }, "and is answered at once");
  assert.ok(old.running, "with the new one running behind, for the route to keep alive");
  const again = keep.get(true);
  assert.equal(reads.length, 2, "«Read again» while one runs waits for it, it does not start a second");
  reads[1].resolve("B");
  assert.deepEqual(await again.answer, { at: 700, value: "B" });
});

test("a read hanging past its budget is dead: a new one starts, and the dead one never becomes the answer", async () => {
  const { keep, reads, tick } = keeper();
  keep.get();
  tick(300);
  const stuck = keep.get();
  assert.equal(reads.length, 2, "past budget + grace a new read starts");
  reads[1].resolve("fresh");
  assert.deepEqual(await stuck.answer, { at: 300, value: "fresh" });
  await flush();
  reads[0].resolve("dead");
  await flush();
  tick(10);
  assert.deepEqual(await keep.get().answer, { at: 300, value: "fresh" }, "the late dead read is not the last answer");
});
