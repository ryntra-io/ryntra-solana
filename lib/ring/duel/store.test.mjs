// Run from repo root: node --test lib/ring/duel/store.test.mjs
/*
 * CITY-217 «Арена»: the duels' store, one behaviour for both — memory every time, and the real migrations on a
 * throwaway PostgreSQL when RING_TEST_DATABASE_URL names a local server. Never point it at a real project: the test
 * creates and drops its own database there.
 */
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const { createMemoryDuelStore } = await import("./service.ts");
const { createSupabaseDuelStore } = await import("./supabase-store.ts");

const T0 = Date.parse("2026-11-08T09:00:00.000Z");
const DAY = 86_400_000;
let n = 0;

function duel(extra = {}) {
  n += 1;
  const id = `duel-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    format: "duo-crack",
    owner: "a:me",
    status: "live",
    practice: false,
    seats: [
      { kind: "agent", id: "agent-a", name: "A", archetype: "scout", weight: "light" },
      { kind: "agent", id: "agent-b", name: "B", archetype: "host", weight: "light" },
    ],
    rules: { format: "duo-crack", money: "none", limits: { steps: 10, ms: 125_000 } },
    log: { format: "ryntra-ring-log/1", matchId: id, entries: [], result: null },
    secrets: ["amber falcon river", "violet socket tiger"],
    source: null,
    settlement: null,
    voided: null,
    cost: { reserved: 80_000, spent: null },
    createdAt: T0,
    updatedAt: T0,
    ...extra,
  };
}

const limits = (extra = {}) => ({ agents: ["agent-a", "agent-b"], since: T0 - DAY, day: T0 - (T0 % DAY), perOwner: 30, perAgent: 20, cap: 5_000_000, ...extra });

const fixtures = [["memory", async () => ({ store: createMemoryDuelStore(), close: async () => {} })]];
if (process.env.RING_TEST_DATABASE_URL) {
  fixtures.push([
    "postgres",
    async () => {
      const { throwawayDatabase } = await import("../testing/pg.mjs");
      const db = await throwawayDatabase(process.env.RING_TEST_DATABASE_URL);
      return { store: createSupabaseDuelStore(db.rpc), close: db.close, rpc: db.rpc };
    },
  ]);
}

for (const [name, make] of fixtures) {
  describe(`the duels' store: ${name}`, () => {
    let fx;
    before(async () => {
      fx = await make();
    });
    after(async () => fx?.close());

    test("a duel is kept whole and read back; the latest come first", async () => {
      const a = duel({ owner: "a:read" });
      const b = duel({ owner: "a:read", createdAt: T0 + 1, updatedAt: T0 + 1 });
      assert.deepEqual(await fx.store.open(a, limits({ agents: [] })), { ok: true });
      assert.deepEqual(await fx.store.open(b, limits({ agents: [] })), { ok: true });
      assert.deepEqual(await fx.store.get(a.id), a);
      assert.equal(await fx.store.get("duel-00000000-0000-4000-8000-ffffffffffff"), null);
      const recent = await fx.store.recent(50);
      assert.ok(recent.findIndex((d) => d.id === b.id) < recent.findIndex((d) => d.id === a.id));
    });

    test("a second duel under one id is refused as EXISTS and leaves the first as it was (review 8.11)", async () => {
      const first = duel({ owner: "a:retry" });
      assert.deepEqual(await fx.store.open(first, limits({ agents: [] })), { ok: true });
      assert.deepEqual(await fx.store.open({ ...first, owner: "a:retry-2", updatedAt: T0 + 3 }, limits({ agents: [] })), { ok: false, reason: "EXISTS" });
      assert.equal((await fx.store.get(first.id)).owner, "a:retry");
    });

    test("a live duel is written as it goes; once over, never again", async () => {
      const d = duel({ owner: "a:put" });
      await fx.store.open(d, limits({ agents: [] }));
      assert.equal(await fx.store.put({ ...d, log: { ...d.log, entries: [{ at: T0 + 5 }] }, updatedAt: T0 + 5 }), true);
      assert.equal(await fx.store.put({ ...d, status: "done", cost: { reserved: 80_000, spent: 12_345 }, updatedAt: T0 + 9 }), true);
      assert.equal(await fx.store.put({ ...d, status: "void", voided: "stalled", updatedAt: T0 + 10 }), false, "a finished duel stays as it ended");
      const kept = await fx.store.get(d.id);
      assert.equal(kept.status, "done");
      assert.equal(kept.cost.spent, 12_345);
      assert.equal(await fx.store.put(duel()), false, "an unknown duel is not written");
    });

    test("the day's limits: starts per account, duels per agent", async () => {
      for (let i = 0; i < 3; i++) assert.equal((await fx.store.open(duel({ owner: "a:limit", seats: [{ id: "wall" }, { id: "chatty" }], cost: { reserved: 0, spent: null } }), limits({ agents: [], perOwner: 3 }))).ok, true);
      assert.deepEqual(await fx.store.open(duel({ owner: "a:limit" }), limits({ agents: [], perOwner: 3 })), { ok: false, reason: "RATE_LIMITED" });
      assert.equal(await fx.store.count({ owner: "a:limit", since: T0 - DAY }), 3);
      const seat = [{ id: "agent-busy" }, { id: "wall" }];
      for (let i = 0; i < 2; i++) assert.equal((await fx.store.open(duel({ owner: `a:busy-${i}`, seats: seat, cost: { reserved: 0, spent: null } }), limits({ agents: ["agent-busy"], perAgent: 2 }))).ok, true);
      assert.deepEqual(await fx.store.open(duel({ owner: "a:busy-x", seats: seat, cost: { reserved: 0, spent: null } }), limits({ agents: ["agent-busy"], perAgent: 2 })), { ok: false, reason: "RATE_LIMITED" });
      assert.equal(await fx.store.count({ agent: "agent-busy", since: T0 - DAY }), 2);
      assert.equal(await fx.store.count({ agent: "agent-busy", since: T0 + 1 }), 0, "yesterday's do not count");
    });

    test("the ceiling: live duels hold their most, finished ones what they spent; a new UTC day starts at zero", async () => {
      const day = Date.parse("2026-11-20T00:00:00.000Z");
      const at = (ms) => ({ createdAt: day + ms, updatedAt: day + ms });
      const cap = (extra = {}) => limits({ agents: [], since: day - DAY, day, cap: 200_000, ...extra });
      const a = duel({ owner: "a:cap-1", ...at(1) });
      const b = duel({ owner: "a:cap-2", ...at(2) });
      assert.equal((await fx.store.open(a, cap())).ok, true);
      assert.equal((await fx.store.open(b, cap())).ok, true);
      assert.equal(await fx.store.spent(day), 160_000);
      assert.deepEqual(await fx.store.open(duel({ owner: "a:cap-3", ...at(3) }), cap()), { ok: false, reason: "DAILY_CAP" });
      assert.equal((await fx.store.open(duel({ owner: "a:cap-4", ...at(4), cost: { reserved: 0, spent: null } }), cap())).ok, true, "a duel with no model is never held back");
      await fx.store.put({ ...a, status: "done", cost: { reserved: 80_000, spent: 5_000 }, updatedAt: day + 10 });
      assert.equal(await fx.store.spent(day), 85_000);
      assert.equal((await fx.store.open(duel({ owner: "a:cap-5", ...at(11) }), cap())).ok, true, "what the finished duel did not spend is free again");
      const tomorrow = day + DAY;
      assert.equal(await fx.store.spent(tomorrow), 0);
      assert.equal((await fx.store.open(duel({ owner: "a:cap-6", createdAt: tomorrow + 1, updatedAt: tomorrow + 1 }), cap({ since: tomorrow - DAY, day: tomorrow, cap: 80_000 }))).ok, true);
    });

    test("two starts at once never both pass a ceiling only one fits under", async () => {
      const day = Date.parse("2026-12-01T00:00:00.000Z");
      const cap = limits({ agents: [], since: day - DAY, day, cap: 100_000 });
      const both = await Promise.all([0, 1].map((i) => fx.store.open(duel({ owner: `a:race-${i}`, createdAt: day + 1, updatedAt: day + 1 }), cap)));
      assert.deepEqual(both.map((r) => r.ok).sort(), [false, true]);
    });

    if (name === "postgres") {
      test("every duel function refuses a caller without the app secret", async () => {
        assert.equal((await fx.rpc("ring_duel_recent", { p_limit: 1 }, "wrong-secret")).ok, false);
      });
    }
  });
}
