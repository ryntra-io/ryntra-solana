import assert from "node:assert/strict";
import test from "node:test";
import { readQueue } from "./read-queue.ts";

/* «/pro» asked every pool's day together and the engine refused part of them (503); each alone answered. The list
   asks a few at a time and once more, quietly, after a busy refusal. */

const flush = async () => {
  for (let i = 0; i < 50; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

test("no more than four in flight, the first asked first, each key once", async () => {
  let now = 0;
  let most = 0;
  const started = [];
  const gates = new Map();
  const done = new Map();
  const queue = readQueue({
    atOnce: 4,
    retryMs: 10,
    wait: async () => {},
    read: (key) => {
      now += 1;
      most = Math.max(most, now);
      started.push(key);
      return new Promise((resolve) =>
        gates.set(key, () => {
          now -= 1;
          resolve({ status: 200, body: { key } });
        }),
      );
    },
    done: (key, body) => done.set(key, body),
  });
  const keys = Array.from({ length: 26 }, (_, i) => `pool${i}`);
  queue.ask(keys);
  queue.ask(keys.slice(0, 5));
  await flush();
  assert.equal(started.length, 4);
  while (done.size < keys.length) {
    for (const [key, open] of [...gates]) {
      gates.delete(key);
      open();
    }
    await flush();
  }
  assert.equal(most, 4);
  assert.deepEqual(started, keys, "in order, none asked twice");
  assert.deepEqual(done.get("pool7"), { key: "pool7" });
});

test("a busy refusal is asked once more after the pause; a second refusal or another failure is no answer", async () => {
  const answers = { a: [503, 200], b: [429, 503], c: [404], d: [500] };
  const asked = {};
  const waits = [];
  const done = new Map();
  const queue = readQueue({
    atOnce: 4,
    retryMs: 1500,
    wait: async (ms) => void waits.push(ms),
    read: async (key) => {
      asked[key] = (asked[key] ?? 0) + 1;
      const status = answers[key][asked[key] - 1];
      return { status, body: status === 200 ? { ok: key } : null };
    },
    done: (key, body) => done.set(key, body),
  });
  queue.ask(["a", "b", "c", "d"]);
  await flush();
  assert.deepEqual(asked, { a: 2, b: 2, c: 1, d: 1 });
  assert.deepEqual(waits, [1500, 1500]);
  assert.deepEqual(done.get("a"), { ok: "a" });
  assert.equal(done.get("b"), null);
  assert.equal(done.get("c"), null);
  assert.equal(done.get("d"), null);
  assert.equal(queue.busy("a"), false);
});

test("a read that throws is no answer, and the line moves on", async () => {
  const done = new Map();
  const queue = readQueue({ atOnce: 1, retryMs: 0, wait: async () => {}, read: async (key) => { if (key === "x") throw new Error("offline"); return { status: 200, body: key }; }, done: (key, body) => done.set(key, body) });
  queue.ask(["x", "y"]);
  await flush();
  assert.equal(done.get("x"), null);
  assert.equal(done.get("y"), "y");
});
