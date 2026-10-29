/*
 * One behaviour for both stores. The same cases run against memory every
 * time and against the real migration on a throwaway PostgreSQL when
 * WORLD_TEST_DATABASE_URL names a local server (for example
 * postgres://postgres@127.0.0.1:5432/postgres). Never point it at a real
 * project: the test creates and drops its own database there.
 */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test, before, after } from "node:test";

const { MemoryWorldStore } = await import("./memory-store.ts");
const { SupabaseWorldStore } = await import("./supabase-store.ts");

const T0 = Date.parse("2026-10-27T10:00:00.000Z");
const at = (minutes) => new Date(T0 + minutes * 60_000);
const DAY = "2026-10-27";
const SALT = "0123456789abcdef0123456789abcdef";
const salt = () => randomUUID().replace(/-/g, "");

function memoryFixture() {
  const store = new MemoryWorldStore();
  return { store, addAccount: async (id) => store.accounts.add(id), close: async () => {} };
}

async function pgFixture() {
  const { throwawayDatabase } = await import("./testing/pg.mjs");
  const db = await throwawayDatabase(process.env.WORLD_TEST_DATABASE_URL);
  return {
    store: new SupabaseWorldStore(db.rpc),
    addAccount: async (id) => db.client.query("insert into public.beta_users (id) values ($1)", [id]),
    close: db.close,
    db,
  };
}

const build = (store, resident, quarter, version, slot, kind, modules, extra = {}) => store.commitBuild({
  residentId: resident.id, quarterId: quarter.id, version, slot, kind, level: 1 + modules.filter((m) => m.startsWith("floor.")).length,
  modules, day: DAY, progress: [], taskPoints: 10, now: at(1), ...extra,
});

function suite(name, makeFixture, skip = false) {
  describe(`world store: ${name}`, { skip }, () => {
    let fx;
    before(async () => { fx = await makeFixture(); });
    after(async () => { await fx?.close(); });

    test("a guest claim makes a resident and a quarter on the newcomers' street, in order", async () => {
      const a = await fx.store.claim({ accountId: null, guestSalt: SALT, displayName: " Ann ", now: at(0) });
      const b = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      assert.equal(a.ok && a.created, true);
      assert.equal(a.quarter.district, "arrivals");
      assert.equal(a.quarter.street, "arrivals-1");
      assert.deepEqual(a.quarter.cell, { x: 0, z: 0 });
      assert.deepEqual(b.quarter.cell, { x: 1, z: 0 });
      assert.equal(a.quarter.level, 1);
      assert.equal(a.quarter.version, 1);
      assert.equal(a.quarter.ownerId, a.resident.id);
      assert.equal(a.resident.homeQuarterId, a.quarter.id);
      assert.equal(a.resident.accountId, null);
      assert.equal(a.resident.displayName, "Ann");
      assert.equal(a.resident.createdAt, "2026-10-27T10:00:00.000Z");
      const stored = await fx.store.resident({ id: a.resident.id });
      assert.equal(stored.guestSalt, SALT);
      assert.equal(await fx.store.resident({ id: randomUUID() }), null);
    });

    test("an account claims once; an unknown account gets no place", async () => {
      assert.deepEqual(await fx.store.claim({ accountId: randomUUID(), guestSalt: null, displayName: null, now: at(0) }), { ok: false, error: "no_account" });
      const account = randomUUID();
      await fx.addAccount(account);
      const first = await fx.store.claim({ accountId: account, guestSalt: null, displayName: null, now: at(0) });
      const again = await fx.store.claim({ accountId: account, guestSalt: null, displayName: null, now: at(5) });
      assert.equal(first.created, true);
      assert.equal(again.created, false);
      assert.equal(again.quarter.id, first.quarter.id);
      assert.equal((await fx.store.resident({ accountId: account })).id, first.resident.id);
      assert.equal((await fx.store.resident({ accountId: account })).guestSalt, null);
    });

    test("a build is written only at the version seen, by the owner, and bumps the version", async () => {
      const { resident, quarter } = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      const other = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      assert.deepEqual(await build(fx.store, other.resident, quarter, 1, 0, "home", ["base.stone"]), { ok: false, error: "not_owner" });
      assert.deepEqual(await build(fx.store, resident, { id: randomUUID() }, 1, 0, "home", ["base.stone"]), { ok: false, error: "not_found" });
      const done = await build(fx.store, resident, quarter, 1, 0, "home", ["base.stone", "floor.glass"]);
      assert.equal(done.ok, true);
      assert.equal(done.quarter.version, 2);
      assert.equal(done.building.slot, 0);
      assert.equal(done.building.level, 2);
      assert.deepEqual(done.building.modules, ["base.stone", "floor.glass"]);
      assert.equal(done.building.link, null);
      const stale = await build(fx.store, resident, quarter, 1, 1, "decor", ["base.stone"]);
      assert.equal(stale.ok, false);
      assert.equal(stale.error, "version");
      assert.equal(stale.quarter.version, 2);
      assert.equal(stale.buildings.length, 1);
      const state = await fx.store.quarter(quarter.id);
      assert.equal(state.quarter.version, 2);
      assert.equal(state.buildings[0].kind, "home");
      assert.equal(await fx.store.quarter(randomUUID()), null);
    });

    test("a task of the day pays once when it reaches its goal, and points raise the level", async () => {
      const { resident, quarter } = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      const progress = [{ kind: "add_floor", delta: 1, goal: 1 }, { kind: "light_street", delta: 1, goal: 1 }];
      const first = await build(fx.store, resident, quarter, 1, 0, "home", ["base.stone", "floor.glass", "light.amber"], { progress });
      assert.equal(first.pointsTotal, 20);
      assert.deepEqual(first.tasks.map((t) => [t.kind, t.progress, t.goal, t.doneAt]), [
        ["add_floor", 1, 1, "2026-10-27T10:01:00.000Z"],
        ["light_street", 1, 1, "2026-10-27T10:01:00.000Z"],
      ]);
      const second = await build(fx.store, resident, quarter, 2, 1, "decor", ["base.stone", "floor.glass"], { progress: [{ kind: "add_floor", delta: 1, goal: 1 }] });
      assert.equal(second.pointsTotal, 20, "the same task on the same day pays once");
      const award = await fx.store.award({ residentId: resident.id, reason: "survival_7", delta: 50, sourceRef: "mint", key: "survival_7:mint", now: at(2) });
      assert.deepEqual(award, { ok: true, awarded: true, total: 70 });
      assert.deepEqual(await fx.store.award({ residentId: resident.id, reason: "survival_7", delta: 50, sourceRef: "mint", key: "survival_7:mint", now: at(3) }), { ok: true, awarded: false, total: 70 });
      assert.equal((await fx.store.quarter(quarter.id)).quarter.level, 2, "70 points pass the 30-point threshold only");
      assert.deepEqual(await fx.store.award({ residentId: randomUUID(), reason: "task_done", delta: 10, sourceRef: "x", key: "k", now: at(3) }), { ok: false, error: "not_found" });
      const me = await fx.store.me({ residentId: resident.id, day: DAY });
      assert.equal(me.points.total, 70);
      assert.equal(me.points.recent[0].reason, "survival_7");
      assert.equal(me.points.recent.length, 3);
      assert.equal(me.points.recent[1].idempotencyKey.startsWith("task_done:2026-10-27:"), true);
      assert.equal(me.tasks.length, 2);
    });

    test("the ledger refuses a reason outside the list", async () => {
      const { resident } = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      await assert.rejects(() => fx.store.award({ residentId: resident.id, reason: "trade_volume", delta: 10, sourceRef: "x", key: "volume", now: at(1) }));
      assert.equal((await fx.store.me({ residentId: resident.id, day: DAY })).points.total, 0);
    });

    test("a linked building keeps its kind; one object shows on one building in the city", async () => {
      const a = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      const b = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      await build(fx.store, a.resident, a.quarter, 1, 0, "coin_tower", ["base.stone"]);
      await build(fx.store, b.resident, b.quarter, 1, 0, "coin_tower", ["base.stone"]);
      const link = { kind: "mint", mint: "So11111111111111111111111111111111111111112" };
      assert.deepEqual(await fx.store.commitLink({ residentId: a.resident.id, quarterId: a.quarter.id, version: 2, slot: 5, link, now: at(2) }), { ok: false, error: "no_building" });
      const linked = await fx.store.commitLink({ residentId: a.resident.id, quarterId: a.quarter.id, version: 2, slot: 0, link, now: at(2) });
      assert.equal(linked.ok, true);
      assert.equal(linked.quarter.version, 3);
      assert.deepEqual(linked.building.link, link);
      assert.deepEqual(await fx.store.commitLink({ residentId: b.resident.id, quarterId: b.quarter.id, version: 2, slot: 0, link, now: at(2) }), { ok: false, error: "link_taken" });
      assert.deepEqual(await build(fx.store, a.resident, a.quarter, 3, 0, "decor", ["base.stone"]), { ok: false, error: "linked" });
      const improved = await build(fx.store, a.resident, a.quarter, 3, 0, "coin_tower", ["base.brick", "floor.glass"]);
      assert.deepEqual(improved.building.link, link, "improving keeps the link");
      const off = await fx.store.commitLink({ residentId: a.resident.id, quarterId: a.quarter.id, version: 4, slot: 0, link: null, now: at(3) });
      assert.equal(off.building.link, null);
      const taken = await fx.store.commitLink({ residentId: b.resident.id, quarterId: b.quarter.id, version: 2, slot: 0, link, now: at(4) });
      assert.equal(taken.ok, true, "a freed object can be shown elsewhere");
      const book = await fx.store.commitLink({ residentId: a.resident.id, quarterId: a.quarter.id, version: 5, slot: 0, link: { kind: "prediction_book" }, now: at(5) });
      assert.deepEqual(book.building.link, { kind: "prediction_book" });
    });

    test("a visit counts once a day, never for one's own quarter, and moves the visitor's task", async () => {
      const host = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      const guest = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      const visit = (quarterId, day = DAY, minutes = 1) => fx.store.visit({ visitorId: guest.resident.id, quarterId, day, verifiedHuman: true, progress: { kind: "visit_quarters", delta: 1, goal: 2 }, taskPoints: 10, now: at(minutes) });
      assert.deepEqual(await visit(guest.quarter.id), { ok: true, counted: false, reason: "own_quarter", visit: null });
      assert.deepEqual(await visit(randomUUID()), { ok: false, error: "not_found" });
      const first = await visit(host.quarter.id);
      assert.deepEqual(first, { ok: true, counted: true, reason: "counted", visit: { visitorId: guest.resident.id, quarterId: host.quarter.id, day: DAY, verifiedHuman: true } });
      assert.equal((await visit(host.quarter.id)).reason, "already_today");
      const third = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      await visit(third.quarter.id);
      const me = await fx.store.me({ residentId: guest.resident.id, day: DAY });
      assert.deepEqual(me.tasks.map((t) => [t.kind, t.progress, t.doneAt !== null]), [["visit_quarters", 2, true]]);
      assert.equal(me.points.total, 10);
      assert.equal((await visit(host.quarter.id, "2026-10-28", 60 * 24)).counted, true, "a new day counts again");
    });

    test("a guest without a resident becomes the account's resident; a second device merges in", async () => {
      const account = randomUUID();
      await fx.addAccount(account);
      const phone = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      const joined = await fx.store.mergeGuest({ guestId: phone.resident.id, accountId: account, now: at(1) });
      assert.equal(joined.merged, true);
      assert.equal(joined.resident.id, phone.resident.id);
      assert.equal(joined.resident.accountId, account);
      assert.equal((await fx.store.resident({ id: phone.resident.id })).guestSalt, null);
      assert.deepEqual(await fx.store.mergeGuest({ guestId: phone.resident.id, accountId: account, now: at(2) }), { ok: true, merged: false, resident: joined.resident });

      const laptop = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(3) });
      const progress = [{ kind: "add_floor", delta: 1, goal: 1 }];
      await build(fx.store, phone.resident, phone.quarter, 1, 0, "home", ["base.stone", "floor.glass"], { progress });
      await build(fx.store, laptop.resident, laptop.quarter, 1, 0, "home", ["base.stone", "floor.glass"], { progress });
      await build(fx.store, laptop.resident, laptop.quarter, 2, 1, "decor", ["base.stone"]);
      await fx.store.award({ residentId: laptop.resident.id, reason: "survival_30", delta: 150, sourceRef: "m", key: "survival_30:m", now: at(4) });
      const host = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      await fx.store.visit({ visitorId: laptop.resident.id, quarterId: host.quarter.id, day: DAY, verifiedHuman: false, progress: null, taskPoints: 10, now: at(5) });

      const merged = await fx.store.mergeGuest({ guestId: laptop.resident.id, accountId: account, now: at(6) });
      assert.equal(merged.merged, true);
      assert.equal(merged.resident.id, phone.resident.id);
      assert.equal(merged.resident.homeQuarterId, laptop.quarter.id, "the quarter with more buildings becomes home");
      assert.equal(await fx.store.resident({ id: laptop.resident.id }), null);
      const me = await fx.store.me({ residentId: phone.resident.id, day: DAY });
      assert.equal(me.points.total, 160, "the same day's task counts once; other points move over");
      assert.deepEqual(me.quarters.map((q) => q.id), [laptop.quarter.id, phone.quarter.id]);
      assert.equal(me.quarter.id, laptop.quarter.id);
      assert.equal(me.quarter.ownerId, phone.resident.id);
      assert.equal(me.quarter.level, 4, "160 points reach level 4 on every quarter of the resident");
      const again = await fx.store.visit({ visitorId: phone.resident.id, quarterId: host.quarter.id, day: DAY, verifiedHuman: true, progress: null, taskPoints: 10, now: at(7) });
      assert.equal(again.reason, "already_today", "the guest's visit moved over");
      const stranger = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      assert.deepEqual(await fx.store.mergeGuest({ guestId: stranger.resident.id, accountId: randomUUID(), now: at(8) }), { ok: false, error: "no_account" });
    });

    test("a district reads in pages by quarter id", async () => {
      const district = await fx.store.district({ district: "arrivals", after: null, limit: 500 });
      assert.ok(district.quarters.length >= 3);
      assert.equal(district.nextCursor, null);
      const one = await fx.store.district({ district: "arrivals", after: null, limit: 2 });
      assert.equal(one.quarters.length, 2);
      assert.equal(one.nextCursor, one.quarters[1].id);
      const two = await fx.store.district({ district: "arrivals", after: one.nextCursor, limit: 2 });
      assert.ok(two.quarters[0].id > one.quarters[1].id);
      const sketch = district.quarters.find((q) => q.buildings.length > 0);
      assert.deepEqual(Object.keys(sketch).sort(), ["buildings", "cell", "id", "level", "ownerId", "street"]);
      assert.deepEqual(Object.keys(sketch.buildings[0]).sort(), ["kind", "level", "slot"]);
      assert.deepEqual(await fx.store.district({ district: "heights", after: null, limit: 10 }), { quarters: [], nextCursor: null });
    });

    test("away shows my quarters, my district and the city, newest first, without my own steps", async () => {
      const me = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(100) });
      const neighbour = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(100) });
      await build(fx.store, me.resident, me.quarter, 1, 0, "home", ["base.stone"], { now: at(101) });
      await build(fx.store, neighbour.resident, neighbour.quarter, 1, 0, "home", ["base.stone"], { now: at(102) });
      await fx.store.visit({ visitorId: neighbour.resident.id, quarterId: me.quarter.id, day: DAY, verifiedHuman: false, progress: null, taskPoints: 10, now: at(103) });
      await fx.store.recordEvent({ source: "market", kind: "pump", subject: "So11111111111111111111111111111111111111112", sourceAt: at(104), district: null, payload: { change: 0.18 }, now: at(105) });
      await fx.store.recordEvent({ source: "engine", kind: "launch", subject: "mintwithouttime", sourceAt: null, district: null, payload: {}, now: at(105) });
      const events = await fx.store.away({ residentId: me.resident.id, since: at(100.5), until: at(200), limit: 100 });
      assert.deepEqual(events.map((e) => [e.kind, e.source]), [["pump", "market"], ["visit", "world"], ["build", "world"]]);
      assert.equal(events[1].subject, me.quarter.id);
      assert.equal(events[0].sourceAt, "2026-10-27T11:44:00.000Z");
      assert.deepEqual(events[0].payload, { change: 0.18 });
      assert.deepEqual(events[1].payload, { street: me.quarter.street, verifiedHuman: false });
      const later = await fx.store.away({ residentId: me.resident.id, since: at(103), until: at(200), limit: 100 });
      assert.deepEqual(later.map((e) => e.kind), ["pump"]);
      assert.equal(await fx.store.away({ residentId: randomUUID(), since: at(0), until: at(200), limit: 10 }), null);
    });

    test("away puts what is mine first: my quarter and the coin my building shows are never crowded out by the city", async () => {
      const me = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(300) });
      const mint = `Mine${randomUUID().replace(/-/g, "").slice(0, 28)}`;
      await build(fx.store, me.resident, me.quarter, 1, 0, "coin_tower", ["base.stone"], { now: at(301) });
      const linked = await fx.store.commitLink({ residentId: me.resident.id, quarterId: me.quarter.id, version: 2, slot: 0, link: { kind: "mint", mint }, now: at(301) });
      assert.equal(linked.ok, true);
      const visitor = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(301) });
      await fx.store.visit({ visitorId: visitor.resident.id, quarterId: me.quarter.id, day: DAY, verifiedHuman: true, progress: null, taskPoints: 10, now: at(302) });
      // My coin, in another district than mine: still mine.
      await fx.store.recordEvent({ source: "engine", kind: "graduate", subject: mint, sourceAt: at(303), district: "docks", payload: {}, now: at(303) });
      for (let i = 0; i < 6; i += 1) {
        await fx.store.recordEvent({ source: "market", kind: "pump", subject: `City${i}${"x".repeat(30)}`, sourceAt: at(310 + i), district: null, payload: { change: 0.1 + i / 100 }, now: at(320) });
      }
      const events = await fx.store.away({ residentId: me.resident.id, since: at(300.5), until: at(400), limit: 4 });
      assert.deepEqual(events.map((e) => e.kind), ["pump", "pump", "graduate", "visit"], "mine first, then the newest of the city, all newest first");
      assert.equal(events[2].subject, mint);
      assert.equal(events[3].subject, me.quarter.id);
      const all = await fx.store.away({ residentId: me.resident.id, since: at(300.5), until: at(400), limit: 100 });
      assert.equal(all.filter((e) => e.kind === "pump").length, 6);
    });

    test("consent is off until chosen, only under an account, and a null leaves a channel as it is", async () => {
      const guest = await fx.store.claim({ accountId: null, guestSalt: salt(), displayName: null, now: at(0) });
      assert.deepEqual(await fx.store.consent(guest.resident.id), { telegram: false, push: false, updatedAt: null });
      assert.deepEqual(await fx.store.setConsent({ residentId: guest.resident.id, telegram: true, push: null, now: at(1) }), { ok: false, error: "account_required" });
      assert.deepEqual(await fx.store.setConsent({ residentId: randomUUID(), telegram: true, push: null, now: at(1) }), { ok: false, error: "not_found" });
      assert.equal(await fx.store.consent(randomUUID()), null);
      const account = randomUUID();
      await fx.addAccount(account);
      const owner = await fx.store.claim({ accountId: account, guestSalt: null, displayName: null, now: at(0) });
      assert.deepEqual(await fx.store.setConsent({ residentId: owner.resident.id, telegram: true, push: null, now: at(2) }), { ok: true, consent: { telegram: true, push: false, updatedAt: "2026-10-27T10:02:00.000Z" } });
      assert.deepEqual(await fx.store.setConsent({ residentId: owner.resident.id, telegram: null, push: true, now: at(3) }), { ok: true, consent: { telegram: true, push: true, updatedAt: "2026-10-27T10:03:00.000Z" } });
      assert.deepEqual((await fx.store.setConsent({ residentId: owner.resident.id, telegram: false, push: null, now: at(4) })).consent, { telegram: false, push: true, updatedAt: "2026-10-27T10:04:00.000Z" });
      assert.deepEqual(await fx.store.consent(owner.resident.id), { telegram: false, push: true, updatedAt: "2026-10-27T10:04:00.000Z" });
    });

    test("a frozen world is made once per day and seed", async () => {
      const towers = [{ mint: "So11111111111111111111111111111111111111112", h: 120 }];
      const first = await fx.store.freezeVersion({ day: DAY, seed: "daily-1", towers, now: at(0) });
      const again = await fx.store.freezeVersion({ day: DAY, seed: "daily-1", towers: [], now: at(9) });
      assert.equal(first.created, true);
      assert.equal(again.created, false);
      assert.equal(again.version.id, first.version.id);
      assert.deepEqual(again.version.towers, towers);
      assert.deepEqual(await fx.store.version(first.version.id), { id: first.version.id, day: DAY, seed: "daily-1", towers, createdAt: "2026-10-27T10:00:00.000Z" });
      assert.equal(await fx.store.version(randomUUID()), null);
    });

    test("an Idempotency-Key is new, then pending, then replays; another body is a mismatch", async () => {
      const ref = { scope: `r:${randomUUID()}`, route: "build", key: "key-0001-abcd" };
      const hash = "a".repeat(64);
      assert.deepEqual(await fx.store.requestBegin({ ...ref, hash, now: at(0) }), { state: "new" });
      assert.deepEqual(await fx.store.requestBegin({ ...ref, hash, now: at(0.5) }), { state: "pending" });
      assert.deepEqual(await fx.store.requestBegin({ ...ref, hash: "b".repeat(64), now: at(0.5) }), { state: "mismatch" });
      await fx.store.requestFinish({ ...ref, status: 200, body: { ok: 1 }, now: at(0.6) });
      assert.deepEqual(await fx.store.requestBegin({ ...ref, hash, now: at(1) }), { state: "replay", status: 200, body: { ok: 1 } });
      const other = { ...ref, key: "key-0002-abcd" };
      await fx.store.requestBegin({ ...other, hash, now: at(0) });
      await fx.store.requestAbandon(other);
      assert.deepEqual(await fx.store.requestBegin({ ...other, hash, now: at(0.1) }), { state: "new" });
      assert.deepEqual(await fx.store.requestBegin({ ...other, hash, now: at(2) }), { state: "new" }, "a key that never finished is taken over after a minute");
      assert.deepEqual(await fx.store.requestBegin({ ...ref, hash, now: at(60 * 25) }), { state: "new" }, "an answer is kept for a day");
    });

    test("a limit counts in fixed windows", async () => {
      const bucket = `claim:${randomUUID()}`;
      const hit = (minutes) => fx.store.limitHit({ bucket, windowSeconds: 3600, max: 2, now: at(minutes) });
      assert.deepEqual(await hit(0), { allowed: true, retryAfterSeconds: 3600 });
      assert.equal((await hit(10)).allowed, true);
      assert.deepEqual(await hit(30), { allowed: false, retryAfterSeconds: 1800 });
      assert.equal((await hit(61)).allowed, true, "the next window starts afresh");
    });
  });
}

suite("memory", memoryFixture);
suite("postgres (the migration)", pgFixture, !process.env.WORLD_TEST_DATABASE_URL);
