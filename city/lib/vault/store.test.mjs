// Run from repo root: node --test city/lib/vault/store.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { createVaultStore, guardianOf, firstToCrack } = await import("./store.ts");
const { VaultClientError } = await import("./client.ts");
const { vaultOpen } = await import("./flag.ts");

/**
 * The room's flow on a fake vault: entering picks the first vault to crack, an attempt shows the guard thinking and
 * then acting, a refusal says why in one line, a crack keeps the guard done and lights the beam, and a retry after a
 * lost connection carries the same key.
 */

const view = (id, open, cracked = false) => ({ id, kind: id === "daily" ? "daily" : "practice", level: 1, words: 2, points: 10, guard: { name: "Pip", line: "x" }, open, cracked });
const STATE = (over = {}) => ({
  day: "2026-10-27",
  resetsAt: "2026-10-28T00:00:00.000Z",
  vaults: [view("practice-1", true, true), view("practice-2", true), view("practice-3", false), view("daily", true)],
  me: { points: 10, title: null, limits: { minute: { left: 3, resetS: 0 }, day: { left: 25, resetS: 0 } } },
  ...over,
});
const entry = (id, outcome = "held") => ({ id, vault: "practice-2", at: "2026-10-27T12:00:00.000Z", who: "Guest 0A1B", outcome, reply: "Move along.", pressure: 0, attempt: null });

function fakeClient() {
  const calls = { attempt: [], feed: 0 };
  let next = null;
  return {
    calls,
    fail(error) {
      next = error;
    },
    client: {
      async state() {
        return STATE();
      },
      async feed(vault) {
        calls.feed += 1;
        return { vault, entries: [entry("old")], next: null };
      },
      async attempt(vault, text, key) {
        calls.attempt.push({ vault, text, key });
        if (next) {
          const e = next;
          next = null;
          throw e;
        }
        const cracked = text === "amber falcon";
        return { outcome: cracked ? "cracked" : "held", reply: cracked ? null : "Move along.", pressure: 0, encoding: null, award: cracked ? { points: 20, title: null } : null, entry: entry(`e${calls.attempt.length}`, cracked ? "cracked" : "held"), state: STATE() };
      },
    },
  };
}

function setup() {
  const fake = fakeClient();
  let t = 1000;
  let keys = 0;
  const store = createVaultStore({ client: () => fake.client, now: () => (t += 100), newKey: () => `key-${++keys}` });
  return { store, fake };
}

test("entering reads the vaults and the feed and picks the first vault still to crack", async () => {
  const { store, fake } = setup();
  await store.getState().enter();
  const st = store.getState();
  assert.equal(st.open, true);
  assert.equal(st.vault, "practice-2");
  assert.equal(st.feed["practice-2"][0].id, "old");
  assert.equal(fake.calls.feed, 1);
  assert.equal(firstToCrack(STATE({ vaults: [view("practice-1", true, true), view("daily", true, true)] })), "daily");
});

test("a closed vault cannot be chosen; an open one can", async () => {
  const { store } = setup();
  await store.getState().enter();
  store.getState().choose("practice-3");
  assert.equal(store.getState().vault, "practice-2");
  store.getState().choose("daily");
  assert.equal(store.getState().vault, "daily");
});

test("an attempt: the guard thinks, then acts, then is ready; the answer joins the feed on top", async () => {
  const { store, fake } = setup();
  await store.getState().enter();
  store.getState().setDraft("  hello guard  ");
  const sending = store.getState().send();
  assert.equal(guardianOf(store.getState().phase, 0), "thinking");
  await sending;
  const st = store.getState();
  assert.equal(fake.calls.attempt[0].text, "hello guard");
  assert.equal(st.phase.step, "answered");
  assert.equal(guardianOf(st.phase, st.phase.at + 100), "acting");
  assert.equal(guardianOf(st.phase, st.phase.at + 5000), "ready");
  assert.deepEqual(st.feed["practice-2"].map((e) => e.id), ["e1", "old"]);
  assert.equal(st.draft, "  hello guard  ", "the text stays for the next try");
});

test("the field holds 280 characters at most", () => {
  const { store } = setup();
  store.getState().setDraft("🔒".repeat(300));
  assert.equal([...store.getState().draft].length, 280);
});

test("a refusal says why in one line; a lost connection retries with the same key", async () => {
  const { store, fake } = setup();
  await store.getState().enter();
  store.getState().setDraft("hello");
  fake.fail(new VaultClientError(429, "RATE_LIMITED", "Three tries a minute. Catch your breath.", 40, "minute"));
  await store.getState().send();
  assert.deepEqual([store.getState().phase.step, store.getState().phase.line, store.getState().phase.retryAfterS], ["refused", "Three tries a minute. Catch your breath.", 40]);
  fake.fail(new VaultClientError(0, "OFFLINE", "No connection. Nothing was counted."));
  await store.getState().send();
  const lost = fake.calls.attempt.at(-1).key;
  await store.getState().send();
  assert.equal(fake.calls.attempt.at(-1).key, lost, "the same attempt, the same key");
  assert.equal(store.getState().phase.step, "answered");
});

test("a crack: the guard is done, the field clears, the tower's beam is lit", async () => {
  const { store } = setup();
  await store.getState().enter();
  store.getState().setDraft("amber falcon");
  await store.getState().send();
  const st = store.getState();
  assert.equal(guardianOf(st.phase, st.phase.at + 60_000), "done");
  assert.equal(st.draft, "");
  assert.ok(st.crackedAt > 0);
  assert.deepEqual(st.phase.result.award, { points: 20, title: null });
});

test("the switch opens only on `open`", () => {
  assert.equal(vaultOpen("open"), true);
  assert.equal(vaultOpen(" open "), true);
  for (const value of [undefined, "", "closed", "OPEN", "1", "true"]) assert.equal(vaultOpen(value), false, String(value));
});

/** A clock the test turns by hand: the room's wait for a limit to reset. */
function handTimers() {
  const waits = [];
  return {
    waits,
    timers: {
      set(run, ms) {
        const wait = { run, ms, cleared: false };
        waits.push(wait);
        return wait;
      },
      clear(wait) {
        wait.cleared = true;
      },
    },
    /** Runs the one wait still pending. */
    fire() {
      const pending = waits.filter((w) => !w.cleared && !w.done);
      assert.equal(pending.length, 1, "one wait pending");
      pending[0].done = true;
      pending[0].run();
    },
  };
}

test("a used-up minute: no request goes out, the room waits for the reset, reads again and Try comes back", async () => {
  const fake = fakeClient();
  const limits = [
    { minute: { left: 0, resetS: 40 }, day: { left: 20, resetS: 40_000 } },
    { minute: { left: 3, resetS: 0 }, day: { left: 20, resetS: 40_000 } },
  ];
  let reads = 0;
  fake.client.state = async () => STATE({ me: { points: 10, title: null, limits: limits[Math.min(reads++, 1)] } });
  const clock = handTimers();
  let t = 1000;
  const store = createVaultStore({ client: () => fake.client, now: () => t, newKey: () => `key-${t}`, timers: clock.timers });
  await store.getState().enter();
  assert.equal(store.getState().limited, true);
  assert.equal(clock.waits.at(-1).ms, 40_500, "the room waits until the minute resets, and a moment more");
  store.getState().setDraft("hello");
  t += 10_000;
  await store.getState().send();
  assert.equal(fake.calls.attempt.length, 0, "send keeps to the limit: no request");
  assert.deepEqual([store.getState().phase.step, store.getState().phase.code, store.getState().phase.retryAfterS], ["refused", "RATE_LIMITED", 30]);
  clock.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getState().limited, false, "the reset came and the vaults were read again");
  assert.equal(store.getState().state.me.limits.minute.left, 3);
  await store.getState().send();
  assert.equal(fake.calls.attempt.length, 1);
});

test("an attempt that uses up the minute starts the wait; leaving the room stops it", async () => {
  const fake = fakeClient();
  const used = STATE({ me: { points: 10, title: null, limits: { minute: { left: 0, resetS: 55 }, day: { left: 22, resetS: 40_000 } } } });
  const attempt = fake.client.attempt;
  fake.client.attempt = async (...args) => ({ ...(await attempt(...args)), state: used });
  const clock = handTimers();
  const store = createVaultStore({ client: () => fake.client, now: () => 1000, newKey: () => "k", timers: clock.timers });
  await store.getState().enter();
  assert.equal(store.getState().limited, false);
  store.getState().setDraft("third try");
  await store.getState().send();
  assert.equal(store.getState().limited, true);
  assert.equal(clock.waits.at(-1).ms, 55_500);
  store.getState().leave();
  assert.equal(clock.waits.at(-1).cleared, true);
});
