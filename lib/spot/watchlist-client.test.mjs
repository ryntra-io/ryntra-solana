import assert from "node:assert/strict";
import test from "node:test";
const subject = await import("./watchlist-client.ts").catch(() => ({}));

test("rapid full-list saves reach the server in user order, without an older save winning last", async () => {
  assert.equal(typeof subject.createWatchlistWriter, "function");
  const writes = [];
  let finishFirst;
  const firstDone = new Promise(resolve => { finishFirst = resolve; });
  const writer = subject.createWatchlistWriter(async value => {
    if (value.mints[0] === "first") await firstDone;
    writes.push(value);
    return { ok: true, status: 200 };
  });
  const first = writer({ owner: "a", mints: ["first"] });
  const last = writer({ owner: "a", mints: ["last"] });
  await Promise.resolve();
  assert.deepEqual(writes, []);
  finishFirst();
  await Promise.all([first, last]);
  assert.deepEqual(writes.map(x=>x.mints), [["first"], ["last"]]);
});

test("an offline save does not prevent the next requested list from being saved", async () => {
  assert.equal(typeof subject.createWatchlistWriter, "function");
  let count = 0;
  const writer = subject.createWatchlistWriter(async () => {
    if (++count === 1) throw new Error("offline");
    return { ok: true, status: 200 };
  });
  await assert.rejects(writer({ owner: "a", mints: ["first"] }), /offline/);
  assert.equal((await writer({ owner: "b", mints: ["second"] })).ok, true);
});
