import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import test, { afterEach, beforeEach } from "node:test";

/* The platform's data cache as Next 15 runs it in a request: a kept copy past its time is answered at once
   and read again behind the answer. A refusal thrown behind it was logged on every request («sharedRead: an answer that
   is not kept») and left the copy past its time, so every next request asked the refusing source again; the chart said
   «Delayed 5h». These tests run the real `unstable_cache` over a data cache held in memory. */

/* Next keeps its request stores in the runtime's AsyncLocalStorage, which the server gives it as a global. */
globalThis.AsyncLocalStorage = AsyncLocalStorage;
const require = createRequire(import.meta.url);
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external.js");
const { sharedRead } = await import("./shared-read.ts");

/** A data cache in memory: what `set` stored, and whether `get` calls an entry past its time. */
function dataCache() {
  const entries = new Map();
  return {
    entries,
    sets: 0,
    staleNow: false,
    async generateSimpleCacheKey(key) {
      return key;
    },
    async get(key) {
      const entry = entries.get(key);
      return entry ? { value: entry, isStale: this.staleNow } : null;
    },
    async set(key, value) {
      this.sets += 1;
      entries.set(key, value);
    },
  };
}

/** One request: the work store Next gives a route, and its reads behind the answer awaited as the platform does. */
async function request(cache, run) {
  const store = { incrementalCache: cache, pendingRevalidates: undefined, isDraftMode: false, isOnDemandRevalidate: false, fetchCache: undefined, nextFetchId: 1 };
  const answer = await workAsyncStorage.run(store, run);
  await Promise.all(Object.values(store.pendingRevalidates ?? {}));
  return answer;
}

const kept = (cache) => [...cache.entries.values()].map((entry) => JSON.parse(entry.data.body));
const ok = (value) => value.ok === true;

const errors = [];
const realError = console.error;
beforeEach(() => {
  errors.length = 0;
  console.error = (...args) => errors.push(args.map(String).join(" "));
});
afterEach(() => {
  console.error = realError;
});

test("a refused read behind a kept copy keeps that copy and logs nothing", async () => {
  const cache = dataCache();
  const good = { ok: true, observedAt: "2026-11-23T07:00:00.000Z", bars: 3 };
  const first = await request(cache, () => sharedRead(["candles", "JUP", "m5"], 45, async () => good, ok));
  assert.deepEqual(first, good);
  assert.deepEqual(kept(cache), [good]);

  // Hours later the copy is past its time and the source refuses the platform's addresses.
  cache.staleNow = true;
  const setsBefore = cache.sets;
  let asked = 0;
  const refused = { ok: false, code: "RATE_LIMITED" };
  const answer = await request(cache, () =>
    sharedRead(["candles", "JUP", "m5"], 45, async () => {
      asked += 1;
      return refused;
    }, ok),
  );
  // The caller gets the copy with its own time — it states the age itself; the source was asked once, behind it.
  assert.deepEqual(answer, good);
  assert.equal(asked, 1);
  // Nothing in the log, and the same copy stored again: its time restarts, so the next request does not ask again.
  assert.deepEqual(errors, []);
  assert.equal(cache.sets, setsBefore + 1);
  assert.deepEqual(kept(cache), [good]);
});

test("a refusal that comes back at once is still kept quiet behind a served copy", async () => {
  const cache = dataCache();
  const good = { ok: true, observedAt: "2026-11-23T07:00:00.000Z" };
  await request(cache, () => sharedRead(["k"], 30, async () => good, ok));
  cache.staleNow = true;
  // No await in the read: the refusal is known in the same turn the copy is served.
  const answer = await request(cache, () => sharedRead(["k"], 30, () => Promise.resolve({ ok: false }), ok));
  assert.deepEqual(answer, good);
  assert.deepEqual(errors, []);
  assert.deepEqual(kept(cache), [good]);
});

test("a good read behind a kept copy replaces it", async () => {
  const cache = dataCache();
  await request(cache, () => sharedRead(["k"], 30, async () => ({ ok: true, observedAt: "old" }), ok));
  cache.staleNow = true;
  const answer = await request(cache, () => sharedRead(["k"], 30, async () => ({ ok: true, observedAt: "new" }), ok));
  // The old copy answers this request; the new one is kept for the next.
  assert.equal(answer.observedAt, "old");
  assert.deepEqual(kept(cache), [{ ok: true, observedAt: "new" }]);
  assert.deepEqual(errors, []);
});

test("a first read the source refused is answered as it came and kept nowhere", async () => {
  const cache = dataCache();
  const refused = { ok: false, code: "RATE_LIMITED" };
  const answer = await request(cache, () => sharedRead(["k"], 30, async () => refused, ok));
  assert.deepEqual(answer, refused);
  assert.equal(cache.sets, 0);
  assert.deepEqual(errors, []);
});

test("outside a request the read runs as it is", async () => {
  const answer = await sharedRead(["k"], 30, async () => ({ ok: false, why: "no platform" }), ok);
  assert.deepEqual(answer, { ok: false, why: "no platform" });
});
