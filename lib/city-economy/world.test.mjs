/*
 * The economy's points reach the world's ledger through one function, `award` (`lib/world/api.ts`): for the person
 * behind the request, by the rules of `points.ts`, once per key. Against memory every time and against the real
 * migrations on a throwaway PostgreSQL when WORLD_TEST_DATABASE_URL names a local server (never a real project).
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

const { createWorldApi, WorldLimiter } = await import("../world/api.ts");
const { MemoryWorldStore } = await import("../world/memory-store.ts");
const { SupabaseWorldStore } = await import("../world/supabase-store.ts");
const { WorldStoreUnavailable } = await import("../world/store.ts");
const { awardPoints } = await import("../world/award.ts");
const { CRACK_POINTS } = await import("./points.ts");
const { judgeSurvival } = await import("./points.ts");
const { survivalFacts } = await import("./fixtures.mjs");

const SITE = "https://ryntra.io";

function world(store) {
  const state = { now: Date.parse("2026-10-27T10:00:00.000Z") };
  const api = createWorldApi({
    store,
    secret: () => "test-secret",
    now: () => new Date(state.now),
    limiter: new WorldLimiter(),
    account: async (req) => {
      const id = req.headers.get("x-test-account");
      return id ? { status: "ok", accountId: id } : { status: "absent" };
    },
    wallet: async () => ({ status: "absent" }),
    verifyLink: async () => "owned",
  });
  return { api, state };
}

let ip = 0;
/** A browser with its guest key: claims a place, then asks the world to pay a step for it. */
async function guest(w) {
  const address = `198.51.100.${++ip % 250}`;
  const headers = new Headers({ origin: SITE, "x-forwarded-for": address, "idempotency-key": `key-${randomUUID()}` });
  const res = await w.api.claim(new Request(`${SITE}/api/world/claim`, { method: "POST", headers, body: "{}" }));
  const cookie = res.headers.get("set-cookie");
  const body = await res.json();
  const rwg = cookie.slice(4, cookie.indexOf(";"));
  const request = () => new Request(`${SITE}/api/vault/attempt`, { method: "POST", headers: { cookie: `rwg=${rwg}`, "x-forwarded-for": address } });
  const me = async () => (await w.api.me(new Request(`${SITE}/api/world/me`, { headers: { cookie: `rwg=${rwg}`, "x-forwarded-for": address } }))).json();
  return { resident: body.resident, request, me };
}

const crack = (vault, extra = {}) => ({ kind: "vault_crack", vault, day: "2026-10-27", points: 9999, title: null, idempotencyKey: `vault:${vault}:forged`, at: "2026-10-27T10:00:00.000Z", ...extra });

function suite(name, fixture, skip = false) {
  describe(name, { skip }, () => {
    let fx;
    before(async () => {
      fx = await fixture();
    });
    after(async () => fx?.close());

    test("a free vault's crack pays the person behind the request, by the vault, once", async () => {
      const w = world(fx.store);
      const g = await guest(w);
      const first = await w.api.award(g.request(), crack("practice-3"));
      assert.deepEqual(first, { status: "awarded", reason: "vault_crack", points: CRACK_POINTS["practice-3"], total: 40 });
      assert.deepEqual(await w.api.award(g.request(), crack("practice-3")), { status: "already", reason: "vault_crack", total: 40 });
      assert.deepEqual(await w.api.award(g.request(), crack("practice-3", { idempotencyKey: "another" })), { status: "already", reason: "vault_crack", total: 40 }, "the report's key is not read");
      const me = await g.me();
      assert.equal(me.points.total, 40);
      assert.deepEqual(me.points.recent.map((p) => [p.reason, p.delta, p.sourceRef, p.idempotencyKey]), [["vault_crack", 40, "practice-3", "vault:practice-3:once"]]);
      assert.equal(me.quarter.level, 2, "points open the quarter's next level in the same step");
    });

    test("the daily vault pays once on the world's day, again the next day", async () => {
      const w = world(fx.store);
      const g = await guest(w);
      assert.equal((await w.api.award(g.request(), crack("daily"))).status, "awarded");
      assert.equal((await w.api.award(g.request(), crack("daily", { day: "2026-10-28" }))).status, "already", "the report's day is not read");
      w.state.now += 86_400_000;
      assert.deepEqual(await w.api.award(g.request(), crack("daily")), { status: "awarded", reason: "vault_crack", points: 15, total: 30 });
    });

    test("a paid vault, a step the request cannot report and a request without a resident pay nothing", async () => {
      const w = world(fx.store);
      const g = await guest(w);
      assert.deepEqual(await w.api.award(g.request(), crack("ryntra-1")), { status: "refused", why: "paid_entry" });
      assert.deepEqual(await w.api.award(g.request(), crack("daily", { paid: true })), { status: "refused", why: "paid_entry" });
      assert.deepEqual(await w.api.award(g.request(), { kind: "survival_90", mint: "x" }), { status: "refused", why: "not_a_step" });
      assert.deepEqual(await w.api.award(new Request(`${SITE}/api/vault/attempt`, { method: "POST" }), crack("practice-1")), { status: "no_resident" });
      assert.equal((await g.me()).points.total, 0);
    });

    test("a job's real step goes through the existing award at the world's price, under the economy's key", async () => {
      const w = world(fx.store);
      const g = await guest(w);
      const verdict = judgeSurvival(survivalFacts({ day: 30 }));
      assert.equal(verdict.paid, true);
      const { reason, sourceRef, key, points } = verdict.award;
      const paid = await awardPoints(fx.store, { residentId: g.resident.id, reason, sourceRef, key });
      assert.deepEqual(paid, { ok: true, awarded: true, total: points });
      assert.equal((await awardPoints(fx.store, { residentId: g.resident.id, reason, sourceRef, key })).awarded, false);
    });
  });
}

suite("memory", async () => ({ store: new MemoryWorldStore(), close: async () => {} }));
suite(
  "postgres (the migrations)",
  async () => {
    const { throwawayDatabase } = await import("../world/testing/pg.mjs");
    const db = await throwawayDatabase(process.env.WORLD_TEST_DATABASE_URL);
    return { store: new SupabaseWorldStore(db.rpc), close: db.close };
  },
  !process.env.WORLD_TEST_DATABASE_URL,
);

test("a store that cannot answer leaves the step to be reported again", async () => {
  const store = new MemoryWorldStore();
  const w = world(store);
  const g = await guest(w);
  store.award = async () => {
    throw new WorldStoreUnavailable("down");
  };
  assert.deepEqual(await w.api.award(g.request(), crack("practice-1")), { status: "unavailable" });
});
