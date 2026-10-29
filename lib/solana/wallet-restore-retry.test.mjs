import assert from "node:assert/strict";
import test from "node:test";

import { RESTORE_DELAYS_MS, restoreUntilAnswered } from "./wallet-restore.client.ts";

/**
 * SOL-W2.
 * The silent restore used to ask once and be cancelled by a second wallet
 * registering; these hold it to asking again until the wallet answers — and
 * never to anything but the silent question.
 */

const CONNECTION = { wallet: "Phantom", address: "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n", chains: ["solana:mainnet"] };
const NO = { ok: false, state: "REFUSED", reason: "not yet" };

/** A clock the test turns by hand, and a registry it fills by hand. */
function harness({ answers = [], registered = true, hint = "Phantom" } = {}) {
  const timers = new Map();
  let nextId = 1;
  const listeners = new Set();
  const state = { asked: 0, registered, hint, restored: [], pending: [] };
  const deps = {
    hint: () => state.hint,
    registered: () => state.registered,
    reconnect: (name) => {
      state.asked += 1;
      assert.equal(name, "Phantom");
      const answer = answers.shift() ?? NO;
      if (answer === "hold") return new Promise((resolve) => state.pending.push(resolve));
      return Promise.resolve(answer);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    state,
    deps,
    timers,
    listeners,
    flush,
    /** Run the one timer that is due. */
    async tick() {
      const [id, timer] = [...timers.entries()][0] ?? [];
      assert.ok(timer, "a retry is scheduled");
      timers.delete(id);
      timer.run();
      await flush();
      return timer.ms;
    },
    register: async () => {
      for (const listener of [...listeners]) listener();
      await flush();
    },
  };
}

test("a wallet that answers «no account» at first is asked again until it restores", async () => {
  const h = harness({ answers: [NO, NO, { ok: true, connection: CONNECTION }] });
  restoreUntilAnswered((connection) => h.state.restored.push(connection), h.deps);
  await h.flush();
  assert.equal(h.state.asked, 1);
  assert.equal(await h.tick(), RESTORE_DELAYS_MS[0]);
  assert.equal(h.state.asked, 2);
  assert.equal(await h.tick(), RESTORE_DELAYS_MS[1], "the delay widens");
  assert.equal(h.state.asked, 3);
  assert.deepEqual(h.state.restored, [CONNECTION]);
  assert.equal(h.timers.size, 0, "nothing more is scheduled once restored");
  await h.register();
  assert.equal(h.state.asked, 3, "a restored connection is not asked for again");
});

test("a second wallet registering while the first answers does not cancel that answer", async () => {
  const h = harness({ answers: ["hold"] });
  restoreUntilAnswered((connection) => h.state.restored.push(connection), h.deps);
  await h.flush();
  assert.equal(h.state.asked, 1);
  await h.register();
  assert.equal(h.state.asked, 1, "one question at a time");
  h.state.pending.shift()({ ok: true, connection: CONNECTION });
  await h.flush();
  assert.deepEqual(h.state.restored, [CONNECTION], "the answer in flight still restores");
});

test("a wallet that registers late is asked as soon as it appears", async () => {
  const h = harness({ registered: false, answers: [{ ok: true, connection: CONNECTION }] });
  restoreUntilAnswered((connection) => h.state.restored.push(connection), h.deps);
  await h.flush();
  assert.equal(h.state.asked, 0, "nobody to ask yet");
  h.state.registered = true;
  await h.register();
  assert.equal(h.state.asked, 1);
  assert.deepEqual(h.state.restored, [CONNECTION]);
});

test("after the widening retries it waits for a registration or the tab, and still restores", async () => {
  const h = harness({ answers: Array(RESTORE_DELAYS_MS.length + 1).fill(NO).concat([{ ok: true, connection: CONNECTION }]) });
  const restore = restoreUntilAnswered((connection) => h.state.restored.push(connection), h.deps);
  await h.flush();
  for (let i = 0; i < RESTORE_DELAYS_MS.length; i += 1) await h.tick();
  assert.equal(h.timers.size, 0, "the retries end");
  assert.equal(h.state.asked, RESTORE_DELAYS_MS.length + 1);
  assert.ok(RESTORE_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) <= 30_000, "the retries stay within half a minute");
  restore.again();
  await h.flush();
  assert.deepEqual(h.state.restored, [CONNECTION], "the tab coming back asks again");
});

test("Disconnect — the hint cleared, here or in another tab — and stop end it", async () => {
  const h = harness();
  const restore = restoreUntilAnswered((connection) => h.state.restored.push(connection), h.deps);
  await h.flush();
  h.state.hint = null;
  await h.tick();
  assert.equal(h.state.asked, 1, "a cleared hint is never asked for");
  restore.stop();
  assert.equal(h.listeners.size, 0);
  restore.again();
  await h.flush();
  assert.equal(h.state.asked, 1);

  const late = harness({ answers: ["hold"] });
  const stopped = restoreUntilAnswered((connection) => late.state.restored.push(connection), late.deps);
  await late.flush();
  stopped.stop();
  late.state.pending.shift()({ ok: true, connection: CONNECTION });
  await late.flush();
  assert.deepEqual(late.state.restored, [], "an answer after stop is dropped");
});

test("the provider restores through this loop, keyed on the connection alone, and asks again when the tab returns", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../app/solana/workspace/connection.tsx", import.meta.url), "utf8");
  assert.match(source, /restoreUntilAnswered\(/);
  assert.doesNotMatch(source, /restored\.current/, "no once-only guard");
  const effect = source.slice(source.indexOf("restoreUntilAnswered("));
  assert.match(effect, /\}, \[connection\]\);/, "a wallet registering never re-runs (and so cancels) the restore");
  assert.match(effect, /addEventListener\("focus"/);
  assert.match(effect, /addEventListener\("visibilitychange"/);
});

test("an answer that lands after Disconnect — here or in another tab — is dropped", async () => {
  const h = harness({ answers: ["hold"] });
  restoreUntilAnswered((connection) => h.state.restored.push(connection), h.deps);
  await h.flush();
  h.state.hint = null;
  h.state.pending.shift()({ ok: true, connection: CONNECTION });
  await h.flush();
  assert.deepEqual(h.state.restored, [], "no connection over a Disconnect");
});
