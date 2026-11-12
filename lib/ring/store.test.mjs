// Run from repo root: node --test lib/ring/store.test.mjs
/*
 * CITY-50 «Ринг · агенти»: one behaviour for both stores. The same cases run against memory every time and against
 * the real migration on a throwaway PostgreSQL when RING_TEST_DATABASE_URL names a local server (for example
 * postgres://postgres@127.0.0.1:5432/postgres). Never point it at a real project: the test creates and drops its own
 * database there.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const { createMemoryRingStore } = await import("./store.ts");
const { createSupabaseRingStore } = await import("./supabase-store.ts");
const { createSealer } = await import("./seal.ts");
const { applyResult, emptyRating } = await import("./rating.ts");

const T0 = Date.parse("2026-10-27T22:00:00.000Z");
const sealer = createSealer("ring-test-seal-secret-0123456789abcdef");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(4, "0")}${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`;
const quarter = () => `q-${n}-${Math.random().toString(36).slice(2, 10)}`;
const SONNET = { id: "anthropic/claude-sonnet-5.5", name: "Anthropic Sonnet 5.5", provider: "anthropic", providerName: "Anthropic", weight: "middle", matchMicroUsd: 168000 };
const OPUS = { id: "anthropic/claude-opus-5.5", name: "Anthropic Opus 5.5", provider: "anthropic", providerName: "Anthropic", weight: "heavy", matchMicroUsd: 280000 };

function agent(extra = {}) {
  const at = new Date(T0).toISOString();
  return {
    id: uuid(),
    owner: "a:acc-me-0001",
    quarterId: quarter(),
    slot: 2,
    archetype: "scout",
    brain: SONNET,
    formats: ["duo-crack", "code", "market-replay"],
    scenario: "Read the board.",
    status: "active",
    key: { state: "quiet", hash: null, limitUsd: null },
    version: 1,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

const key = (agentId, limitUsd = 5) => ({ hash: `h${Math.random().toString(36).slice(2, 12)}abcdef`, sealed: sealer.seal(agentId, "sk-or-v1-test"), limitUsd });
const next = (brain = SONNET, extra = {}) => ({ archetype: "host", brain, formats: ["duo-crack", "code"], scenario: "Talk them round.", ...extra });

function memoryFixture() {
  const store = createMemoryRingStore();
  return {
    store,
    seedRating: async (agentId, brain, row) => store.seedRating(agentId, brain, row),
    keyRow: async (hash) => store.keyRows().find((row) => row.hash === hash) ?? null,
    close: async () => {},
  };
}

async function pgFixture() {
  const { throwawayDatabase } = await import("./testing/pg.mjs");
  const db = await throwawayDatabase(process.env.RING_TEST_DATABASE_URL);
  return {
    store: createSupabaseRingStore(db.rpc),
    seedRating: async (agentId, brain, row) => {
      await db.pool.query(
        `insert into private.ring_ratings (agent_id, format, model_id, provider, rating, games, wins, draws, losses, info, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
        [agentId, row.format, brain.id, brain.provider, row.rating, row.games, row.wins, row.draws, row.losses, row.info],
      );
    },
    keyRow: async (hash) => {
      const { rows } = await db.pool.query("select hash, sealed, retired_at, disabled_at from private.ring_keys where hash = $1", [hash]);
      return rows[0] ? { hash: rows[0].hash, sealed: rows[0].sealed, retiredAt: rows[0].retired_at, disabledAt: rows[0].disabled_at } : null;
    },
    rpc: db.rpc,
    close: db.close,
  };
}

const fixtures = [["memory", memoryFixture]];
if (process.env.RING_TEST_DATABASE_URL) fixtures.push(["postgres", pgFixture]);

for (const [name, make] of fixtures) {
  describe(`the Ring's store: ${name}`, () => {
    let fx;
    before(async () => {
      fx = await make();
    });
    after(async () => fx?.close());

    test("an agent is kept as given, with its key's state; the store numbers the version", async () => {
      const quiet = agent();
      const made = await fx.store.create(quiet, null, T0);
      assert.equal(made.ok, true);
      assert.deepEqual(made.agent, quiet);
      assert.deepEqual(await fx.store.agent(quiet.id), quiet);
      assert.deepEqual(await fx.store.agentAt(quiet.quarterId, 2), quiet);
      assert.equal(await fx.store.agentAt(quiet.quarterId, 3), null);
      assert.equal(await fx.store.agent(uuid()), null);

      const live = agent();
      const k = key(live.id);
      const kept = await fx.store.create(live, k, T0);
      assert.deepEqual(kept.agent.key, { state: "live", hash: k.hash, limitUsd: 5 });
      const row = await fx.keyRow(k.hash);
      assert.equal(sealer.open(live.id, row.sealed), "sk-or-v1-test");
      assert.equal(row.retiredAt ?? null, null);
    });

    test("one active agent to a garage slot, even when two creates arrive at once", async () => {
      const q = quarter();
      const results = await Promise.all([fx.store.create(agent({ quarterId: q }), null, T0), fx.store.create(agent({ quarterId: q }), null, T0), fx.store.create(agent({ quarterId: q, slot: 3 }), null, T0)]);
      assert.deepEqual(results.map((r) => r.ok).sort(), [false, true, true]);
      assert.deepEqual(results.filter((r) => !r.ok), [{ ok: false, error: "slot_taken" }]);
    });

    test("a change happens at the version its owner saw, on an active agent of theirs", async () => {
      const a = agent();
      await fx.store.create(a, null, T0);
      assert.deepEqual(await fx.store.change({ id: uuid(), owner: a.owner, version: 1, next: next(), key: null }, T0), { ok: false, error: "not_found", current: null });
      assert.deepEqual(await fx.store.change({ id: a.id, owner: "a:someone-else", version: 1, next: next(), key: null }, T0), { ok: false, error: "not_owner", current: null });
      const stale = await fx.store.change({ id: a.id, owner: a.owner, version: 2, next: next(), key: null }, T0);
      assert.equal(stale.error, "version");
      assert.deepEqual(stale.current, a);
      const changed = await fx.store.change({ id: a.id, owner: a.owner, version: 1, next: next(), key: null }, T0 + 5_000);
      assert.equal(changed.ok, true);
      assert.equal(changed.retired, null);
      assert.deepEqual(changed.agent, { ...a, ...next(), version: 2, updatedAt: new Date(T0 + 5_000).toISOString() });
    });

    test("two changes at the same version: one holds, the other is told the version moved", async () => {
      const a = agent();
      await fx.store.create(a, null, T0);
      const results = await Promise.all([1, 2, 3].map((i) => fx.store.change({ id: a.id, owner: a.owner, version: 1, next: next(SONNET, { scenario: `try ${i}` }), key: null }, T0)));
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.ok(results.filter((r) => !r.ok).every((r) => r.error === "version" && r.current.version === 2));
    });

    test("a new key replaces the live one, which is retired and handed back; a change without one keeps the key", async () => {
      const a = agent();
      const first = key(a.id, 5);
      await fx.store.create(a, first, T0);
      const same = await fx.store.change({ id: a.id, owner: a.owner, version: 1, next: next(), key: null }, T0);
      assert.equal(same.retired, null);
      assert.deepEqual(same.agent.key, { state: "live", hash: first.hash, limitUsd: 5 });
      const second = key(a.id, 20);
      const heavier = await fx.store.change({ id: a.id, owner: a.owner, version: 2, next: next(OPUS), key: second }, T0 + 1_000);
      assert.equal(heavier.retired, first.hash);
      assert.deepEqual(heavier.agent.key, { state: "live", hash: second.hash, limitUsd: 20 });
      assert.ok((await fx.keyRow(first.hash)).retiredAt);
      assert.equal((await fx.keyRow(second.hash)).retiredAt ?? null, null);
      await fx.store.keyDisabled(first.hash, T0 + 2_000);
      assert.ok((await fx.keyRow(first.hash)).disabledAt);
    });

    test("a quiet agent's first key hands nothing back to switch off", async () => {
      const a = agent();
      await fx.store.create(a, null, T0);
      const k = key(a.id);
      const changed = await fx.store.change({ id: a.id, owner: a.owner, version: 1, next: next(), key: k }, T0);
      assert.equal(changed.retired, null);
      assert.equal(changed.agent.key.state, "live");
    });

    test("switching off frees the garage, retires the key and hands it back; an off agent stays off", async () => {
      const a = agent();
      const k = key(a.id);
      await fx.store.create(a, k, T0);
      const off = await fx.store.off({ id: a.id, owner: a.owner, version: 1 }, T0 + 1_000);
      assert.equal(off.ok, true);
      assert.equal(off.retired, k.hash);
      assert.equal(off.agent.status, "off");
      assert.deepEqual(off.agent.key, { state: "off", hash: k.hash, limitUsd: 5 });
      assert.equal(off.agent.version, 2);
      assert.equal(await fx.store.agentAt(a.quarterId, a.slot), null);
      assert.equal((await fx.store.agent(a.id)).status, "off", "the agent's record stays");
      const again = await fx.store.off({ id: a.id, owner: a.owner, version: 2 }, T0);
      assert.equal(again.error, "off");
      assert.equal((await fx.store.change({ id: a.id, owner: a.owner, version: 2, next: next(), key: null }, T0)).error, "off");
      const fresh = agent({ quarterId: a.quarterId });
      assert.equal((await fx.store.create(fresh, null, T0)).ok, true, "the slot takes a new agent");
    });

    test("what an owner made since a moment: agents and keys", async () => {
      const owner = `a:owner-${uuid()}`;
      const one = agent({ owner });
      await fx.store.create(one, key(one.id), T0);
      const two = agent({ owner, createdAt: new Date(T0 + 60_000).toISOString(), updatedAt: new Date(T0 + 60_000).toISOString() });
      await fx.store.create(two, null, T0 + 60_000);
      await fx.store.change({ id: one.id, owner, version: 1, next: next(OPUS), key: key(one.id, 20) }, T0 + 120_000);
      assert.deepEqual(await fx.store.made(owner, T0 - 1), { agents: 2, keys: 2 });
      assert.deepEqual(await fx.store.made(owner, T0 + 30_000), { agents: 1, keys: 1 });
      assert.deepEqual(await fx.store.made("a:nobody", T0 - 1), { agents: 0, keys: 0 });
    });

    test("ratings are read per brain: the model on its provider", async () => {
      const a = agent();
      await fx.store.create(a, null, T0);
      let row = emptyRating("code");
      row = applyResult(row, 1200, 1);
      await fx.seedRating(a.id, SONNET, row);
      await fx.seedRating(a.id, OPUS, { ...emptyRating("duo-crack"), rating: 1300, games: 1, wins: 1, info: 0.00001 });
      const sonnet = await fx.store.ratings(a.id, SONNET);
      assert.deepEqual(sonnet, [row]);
      assert.deepEqual((await fx.store.ratings(a.id, OPUS)).map((r) => [r.format, r.rating]), [["duo-crack", 1300]]);
      assert.deepEqual(await fx.store.ratings(a.id, { id: SONNET.id, provider: "amazon-bedrock" }), []);
    });

    test("an answer is kept ten minutes under its key", async () => {
      const k = `a:acc:create:${uuid()}`;
      assert.equal(await fx.store.answer(k, T0), null);
      await fx.store.keepAnswer(k, { status: 201, body: { agent: { id: "x" } }, hash: "abc" }, T0);
      assert.deepEqual(await fx.store.answer(k, T0 + 9 * 60_000), { status: 201, body: { agent: { id: "x" } }, hash: "abc" });
      assert.equal(await fx.store.answer(k, T0 + 10 * 60_000 + 1), null);
    });

    test("the Arena: an owner's active agents, rivals of a class closest by rating, the board best first (CITY-217)", async () => {
      const owner = `a:arena-${uuid()}`;
      const LIGHT = { ...SONNET, id: `vendor/light-${n}`, weight: "light", matchMicroUsd: 9000 };
      const mine = agent({ owner, brain: LIGHT, formats: ["duo-crack"] });
      const gone = agent({ owner, brain: LIGHT });
      await fx.store.create(mine, null, T0);
      await fx.store.create(gone, null, T0 + 1);
      await fx.store.off({ id: gone.id, owner, version: 1 }, T0 + 2);
      assert.deepEqual((await fx.store.mine(owner)).map((a) => a.id), [mine.id]);
      assert.deepEqual(await fx.store.mine(`a:nobody-${uuid()}`), []);

      const near = agent({ owner: `a:near-${uuid()}`, brain: LIGHT, formats: ["duo-crack", "market-replay"] });
      const far = agent({ owner: `a:far-${uuid()}`, brain: LIGHT, formats: ["duo-crack"] });
      const fresh = agent({ owner: `a:fresh-${uuid()}`, brain: LIGHT, formats: ["duo-crack"] });
      const heavy = agent({ owner: `a:heavy-${uuid()}`, brain: OPUS, formats: ["duo-crack"] });
      const noCrack = agent({ owner: `a:code-${uuid()}`, brain: LIGHT, formats: ["code"] });
      for (const a of [near, far, fresh, heavy, noCrack]) await fx.store.create(a, null, T0);
      await fx.seedRating(near.id, LIGHT, { ...emptyRating("duo-crack"), rating: 1290, games: 4, wins: 3, losses: 1, info: 0.0001 });
      await fx.seedRating(far.id, LIGHT, { ...emptyRating("duo-crack"), rating: 1500, games: 9, wins: 9, info: 0.0002 });
      const rivals = await fx.store.rivals({ owner, weight: "light", format: "duo-crack", near: 1300, limit: 50 });
      const ids = rivals.map((r) => r.agent.id);
      for (const out of [mine.id, heavy.id, noCrack.id]) assert.ok(!ids.includes(out), "own, other class and other format stay out");
      const order = [near.id, fresh.id, far.id].map((id) => ids.indexOf(id));
      assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `closest first: ${order}`);
      assert.equal(rivals.find((r) => r.agent.id === fresh.id).rating, null);
      assert.equal(rivals.find((r) => r.agent.id === near.id).rating.rating, 1290);

      const board = await fx.store.board("duo-crack", 100);
      const placed = board.map((r) => r.agent.id);
      assert.ok(placed.indexOf(far.id) < placed.indexOf(near.id), "best first");
      assert.ok(!placed.includes(fresh.id), "no game, no line");
      for (const row of board) assert.ok(row.rating.games > 0);
    });

    test("a rating is written only at the game count it was read at: two duels at once lose no game", async () => {
      const a = agent();
      await fx.store.create(a, null, T0);
      const first = applyResult(emptyRating("duo-crack"), 1200, 1);
      assert.equal(await fx.store.rate({ agentId: a.id, brain: SONNET, row: first, before: 0 }, T0), true);
      assert.equal(await fx.store.rate({ agentId: a.id, brain: SONNET, row: first, before: 0 }, T0), false, "the second writer read 0 too: refused");
      const second = applyResult(first, 1250, 0);
      assert.equal(await fx.store.rate({ agentId: a.id, brain: SONNET, row: second, before: 1 }, T0), true);
      const [row] = await fx.store.ratings(a.id, SONNET);
      assert.deepEqual([row.games, row.wins, row.losses], [2, 1, 1]);
      assert.ok(Math.abs(row.rating - second.rating) < 1e-9);
    });

    test("an agent's live key comes back sealed for a match; a retired key or another agent's does not", async () => {
      const a = agent();
      const k = key(a.id);
      await fx.store.create(a, k, T0);
      const sealed = await fx.store.sealedKey(a.id, k.hash);
      assert.equal(sealer.open(a.id, sealed), "sk-or-v1-test");
      assert.equal(await fx.store.sealedKey(uuid(), k.hash), null);
      const k2 = key(a.id, 20);
      const changed = await fx.store.change({ id: a.id, owner: a.owner, version: 1, next: next(OPUS), key: k2 }, T0 + 1);
      assert.equal(changed.ok, true);
      assert.equal(await fx.store.sealedKey(a.id, k.hash), null, "the replaced key is retired");
      assert.equal(sealer.open(a.id, await fx.store.sealedKey(a.id, k2.hash)), "sk-or-v1-test");
      await fx.store.off({ id: a.id, owner: a.owner, version: 2 }, T0 + 2);
      assert.equal(await fx.store.sealedKey(a.id, k2.hash), null, "an agent switched off plays no more");
    });

    if (name === "postgres") {
      test("every function refuses a caller without the app secret", async () => {
        const res = await fx.rpc("ring_garage", { p_quarter: "q", p_slot: 1 }, "wrong-secret");
        assert.equal(res.ok, false);
      });
    }
  });
}
