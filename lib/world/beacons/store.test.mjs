/*
 * One behaviour for both beacon stores: memory every time, and the migration
 * on a throwaway PostgreSQL when WORLD_TEST_DATABASE_URL names a local server
 * (as `lib/world/store.test.mjs`). Never point it at a real project.
 */
import "../testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test, before, after } from "node:test";

const { MemoryBeaconStore, SupabaseBeaconStore } = await import("./store.ts");

const NOW = new Date("2026-10-28T12:00:00.000Z");
const RULE = { id: "beacon01", version: 1, groups: [[{ kind: "price", op: "above", value: 1 }]] };
const STATE = { beacon01: { version: 1, state: { armed: true, since: null, firedAt: null, seen: true }, spent: false } };

function memoryFixture() {
  const store = new MemoryBeaconStore();
  return { store, addAccount: async (id) => store.accounts.add(id), close: async () => {} };
}

async function pgFixture() {
  const { throwawayDatabase } = await import("../testing/pg.mjs");
  const db = await throwawayDatabase(process.env.WORLD_TEST_DATABASE_URL);
  return {
    store: new SupabaseBeaconStore(db.rpc),
    addAccount: async (id) => db.client.query("insert into public.beta_users (id) values ($1)", [id]),
    close: db.close,
    db,
  };
}

function suite(name, makeFixture, skip = false) {
  describe(`beacon store: ${name}`, { skip }, () => {
    let fx;
    before(async () => {
      fx = await makeFixture();
    });
    after(async () => fx?.close());

    test("an account without beacons reads revision 0 and nothing", async () => {
      const id = randomUUID();
      const row = await fx.store.read(id);
      assert.equal(row.revision, 0);
      assert.deepEqual(row.rules, []);
      assert.deepEqual(row.states, {});
    });

    test("rules are written at the revision the person saw; a stale revision gets the row as it is", async () => {
      const id = randomUUID();
      await fx.addAccount(id);
      const first = await fx.store.write({ accountId: id, revision: 0, rules: [RULE], states: {}, now: NOW });
      assert.equal(first.ok, true);
      assert.equal(first.row.revision, 1);
      assert.deepEqual(first.row.rules, [RULE]);
      const stale = await fx.store.write({ accountId: id, revision: 0, rules: [], states: {}, now: NOW });
      assert.equal(stale.ok, false);
      assert.equal(stale.error, "revision");
      assert.equal(stale.row.revision, 1);
      assert.deepEqual(stale.row.rules, [RULE]);
      const second = await fx.store.write({ accountId: id, revision: 1, rules: [], states: {}, now: NOW });
      assert.equal(second.row.revision, 2);
    });

    test("an account that does not exist keeps no beacons", async () => {
      if (name === "memory") fx.store.accounts.add("someone-else");
      const done = await fx.store.write({ accountId: randomUUID(), revision: 0, rules: [RULE], states: {}, now: NOW });
      assert.deepEqual(done, { ok: false, error: "no_account" });
    });

    test("the check's states land only while the rules are still at its revision", async () => {
      const id = randomUUID();
      await fx.addAccount(id);
      await fx.store.write({ accountId: id, revision: 0, rules: [RULE], states: {}, now: NOW });
      assert.equal(await fx.store.step({ accountId: id, revision: 1, states: STATE, now: NOW }), true);
      assert.deepEqual((await fx.store.read(id)).states, STATE);
      assert.equal(await fx.store.step({ accountId: id, revision: 7, states: {}, now: NOW }), false);
      assert.deepEqual((await fx.store.read(id)).states, STATE);
      assert.equal(await fx.store.step({ accountId: randomUUID(), revision: 1, states: {}, now: NOW }), false);
    });

    test("the check walks only rows with rules, in account order, page by page", async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
      for (const id of ids) {
        await fx.addAccount(id);
        await fx.store.write({ accountId: id, revision: 0, rules: id === ids[1] ? [] : [RULE], states: {}, now: NOW });
      }
      const seen = [];
      let after = null;
      for (;;) {
        const rows = await fx.store.due({ after, limit: 1 });
        if (!rows.length) break;
        seen.push(...rows.map((r) => r.accountId));
        after = rows[rows.length - 1].accountId;
      }
      for (const id of [ids[0], ids[2]]) assert.ok(seen.includes(id));
      assert.ok(!seen.includes(ids[1]), "no rules, no check");
      assert.deepEqual(seen, [...seen].sort());
    });
  });
}

suite("memory", memoryFixture);
suite("postgres (the migration)", pgFixture, !process.env.WORLD_TEST_DATABASE_URL);

describe("beacon store: the database's answers", () => {
  test("a transport failure or a refusal is the store not answering", async () => {
    const { WorldStoreUnavailable } = await import("../store.ts");
    const down = new SupabaseBeaconStore(async () => ({ ok: false, error: "network" }));
    await assert.rejects(down.read(randomUUID()), WorldStoreUnavailable);
    const odd = new SupabaseBeaconStore(async () => ({ ok: true, data: { ok: false, error: "bad_request" } }));
    await assert.rejects(odd.write({ accountId: randomUUID(), revision: 0, rules: [], states: {}, now: NOW }), WorldStoreUnavailable);
  });
});
