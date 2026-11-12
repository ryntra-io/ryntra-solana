// Run from repo root: node --test lib/vault/store.test.mjs
/*
 * One behaviour for both stores. The same cases run against memory every time and against the real migration on a
 * throwaway PostgreSQL when VAULT_TEST_DATABASE_URL names a local server (for example
 * postgres://postgres@127.0.0.1:5432/postgres). Never point it at a real project: the test creates and drops its own
 * database there. The database's own wiring — every function the store calls exists with exactly the arguments it
 * sends — is checked from the migration's text every time.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test, before, after } from "node:test";

const { createMemoryVaultStore, VaultStoreUnavailable, applyCrack, emptyProgress } = await import("./store.ts");
const { createSupabaseVaultStore } = await import("./supabase-store.ts");
const { PERSON_LIMITS } = await import("./engine.ts");
const { storeKind, vaultReady, guardSetup, readCeiling, VAULT_ENV, DEV_CEILING_MICRO_USD } = await import("./ready.ts");

const T0 = Date.parse("2026-10-27T12:00:00.000Z");
const DAY = "2026-10-27";
const crack = (vault, day = DAY, extra = {}) => ({ vault, day, points: vault === "daily" ? 15 : 10, title: vault === "practice-3" ? "breaker" : null, keepDays: 31, ...extra });
let n = 0;
const fresh = (prefix = "g") => `${prefix}:test-${++n}-${Math.random().toString(36).slice(2, 10)}`;
const entry = (id, vault = "practice-1", at = T0) => ({ id, vault, at: new Date(at).toISOString(), who: "Guest 0A1B", outcome: "held", reply: "Move along.", pressure: 0.25, attempt: "hello ••••• there" });

function memoryFixture() {
  return { store: createMemoryVaultStore(), close: async () => {} };
}

async function pgFixture() {
  const { throwawayDatabase } = await import("./testing/pg.mjs");
  const db = await throwawayDatabase(process.env.VAULT_TEST_DATABASE_URL);
  return { store: createSupabaseVaultStore(db.rpc), close: db.close };
}

function suite(name, makeFixture, skip = false) {
  describe(`vault store: ${name}`, { skip }, () => {
    let fx;
    before(async () => {
      fx = await makeFixture();
    });
    after(async () => {
      await fx?.close();
    });

    test("three a minute, sliding; the fourth is refused with the wait; a given-back attempt is not counted", async () => {
      const key = fresh();
      const tickets = [];
      for (let i = 0; i < 3; i += 1) {
        const take = await fx.store.take(key, PERSON_LIMITS, T0 + i * 10_000);
        assert.equal(take.ok, true);
        assert.deepEqual(take.left, { minute: 2 - i, day: 24 - i });
        tickets.push(take.ticket);
      }
      const refused = await fx.store.take(key, PERSON_LIMITS, T0 + 30_000);
      assert.deepEqual(refused, { ok: false, window: "minute", retryAfterS: 30 });
      assert.deepEqual(await fx.store.left(key, PERSON_LIMITS, T0 + 30_000), { minute: { left: 0, resetS: 30 }, day: { left: 22, resetS: 43_170 } });
      await fx.store.giveBack(key, tickets[2]);
      assert.equal((await fx.store.take(key, PERSON_LIMITS, T0 + 31_000)).ok, true, "the given-back attempt left room");
      assert.equal((await fx.store.take(key, PERSON_LIMITS, T0 + 61_000)).ok, true, "the first one slid out of the minute");
      assert.deepEqual(await fx.store.left(fresh(), PERSON_LIMITS, T0), { minute: { left: 3, resetS: 0 }, day: { left: 25, resetS: 0 } });
    });

    test("the day is the UTC day: full until midnight, fresh after it", async () => {
      const key = fresh();
      const windows = [{ name: "day", ms: 86_400_000, limit: 2 }];
      assert.equal((await fx.store.take(key, windows, T0)).ok, true);
      assert.equal((await fx.store.take(key, windows, T0 + 1000)).ok, true);
      assert.deepEqual(await fx.store.take(key, windows, T0 + 2000), { ok: false, window: "day", retryAfterS: 43_198 });
      assert.equal((await fx.store.take(key, windows, Date.parse("2026-10-28T00:00:01Z"))).ok, true);
    });

    test("many takes at once never pass the limit", async () => {
      const key = fresh("ip");
      const windows = [{ name: "minute", ms: 60_000, limit: 3 }];
      const takes = await Promise.all(Array.from({ length: 8 }, () => fx.store.take(key, windows, T0)));
      assert.equal(takes.filter((t) => t.ok).length, 3);
    });

    test("a crack is recorded once: a practice level ever, the daily vault once a day, the title once", async () => {
      const who = fresh();
      assert.deepEqual(await fx.store.progress(who), emptyProgress());
      const first = await fx.store.crack(who, crack("practice-1"), T0);
      assert.equal(first.recorded, true);
      assert.deepEqual(first.progress, { cracked: { "practice-1": DAY }, dailyDays: [], points: 10, title: null });
      assert.equal((await fx.store.crack(who, crack("practice-1", "2026-10-28"), T0)).recorded, false, "a level pays once ever");
      const three = await fx.store.crack(who, crack("practice-3"), T0);
      assert.equal(three.title, "breaker");
      assert.equal((await fx.store.crack(who, crack("daily"), T0)).recorded, true);
      assert.equal((await fx.store.crack(who, crack("daily"), T0)).recorded, false, "the daily vault pays once a day");
      const tomorrow = await fx.store.crack(who, crack("daily", "2026-10-28"), T0 + 86_400_000);
      assert.equal(tomorrow.recorded, true);
      assert.deepEqual(tomorrow.progress, {
        cracked: { "practice-1": DAY, "practice-3": DAY, daily: "2026-10-28" },
        dailyDays: ["2026-10-28", DAY],
        points: 10 + 10 + 15 + 15,
        title: "breaker",
      });
      assert.deepEqual(await fx.store.progress(who), tomorrow.progress);
    });

    test("two cracks at once are recorded once", async () => {
      const who = fresh();
      const results = await Promise.all(Array.from({ length: 5 }, () => fx.store.crack(who, crack("practice-1"), T0)));
      assert.equal(results.filter((r) => r.recorded).length, 1);
      assert.equal((await fx.store.progress(who)).points, 10);
    });

    test("the feed: newest first, a page at a time, nothing before an unknown entry", async () => {
      for (let i = 1; i <= 5; i += 1) await fx.store.push(entry(`feed${i}`, "practice-2", T0 + i * 1000));
      await fx.store.push(entry("other1", "daily", T0));
      const page = await fx.store.feed("practice-2", 3, null);
      assert.deepEqual(page.map((e) => e.id), ["feed5", "feed4", "feed3"]);
      assert.deepEqual(page[0], entry("feed5", "practice-2", T0 + 5000));
      assert.deepEqual((await fx.store.feed("practice-2", 3, "feed3")).map((e) => e.id), ["feed2", "feed1"]);
      assert.deepEqual(await fx.store.feed("practice-2", 3, "unknown"), []);
      assert.deepEqual((await fx.store.feed("daily", 3, null)).map((e) => e.id), ["other1"]);
    });

    test("the day's ceiling: a call's worst case fits or not, guests within their share, settled to the real cost", async () => {
      const day = `2026-11-${String(10 + (n % 15)).padStart(2, "0")}`;
      n += 1;
      const caps = { total: 10_000, guest: 7_000 };
      assert.deepEqual(await fx.store.spent(day), { guest: 0, wallet: 0 });
      assert.deepEqual(await fx.store.reserve(day, "guest", 4_000, caps), { ok: true, spent: { guest: 4_000, wallet: 0 } });
      assert.deepEqual(await fx.store.reserve(day, "guest", 3_000, caps), { ok: true, spent: { guest: 7_000, wallet: 0 } });
      assert.deepEqual(await fx.store.reserve(day, "guest", 1, caps), { ok: false, spent: { guest: 7_000, wallet: 0 } }, "the guests' share is used up");
      assert.equal((await fx.store.reserve(day, "wallet", 3_000, caps)).ok, true, "a wallet still finds room");
      assert.equal((await fx.store.reserve(day, "wallet", 1, caps)).ok, false, "the whole day is used up");
      assert.deepEqual(await fx.store.settle(day, "guest", -2_500, caps), { over: 0 });
      assert.deepEqual(await fx.store.spent(day), { guest: 4_500, wallet: 3_000 }, "what a call did not use comes back");
      assert.deepEqual(await fx.store.settle(day, "wallet", 400, caps), { over: 0 });
      assert.deepEqual(await fx.store.spent(day), { guest: 4_500, wallet: 3_400 }, "what it cost beyond the worst case is booked");
      // Review 8.11: a price that changed between the worst case and the call never books the day past its ceiling.
      assert.deepEqual(await fx.store.settle(day, "wallet", 5_000, caps), { over: 2_900 }, "2 100 fit under 10 000, 2 900 do not");
      assert.deepEqual(await fx.store.spent(day), { guest: 4_500, wallet: 5_500 }, "the day stops at its ceiling");
      assert.deepEqual(await fx.store.settle(day, "guest", 300, caps), { over: 300 }, "a full day books nothing more");
      await fx.store.settle(day, "wallet", -1_000_000, caps);
      assert.deepEqual(await fx.store.spent(day), { guest: 4_500, wallet: 0 }, "never below zero");
      assert.deepEqual(await fx.store.settle(day, "guest", 5_000, caps), { over: 2_500 }, "a guest's call stops at the guests' share");
      assert.deepEqual(await fx.store.spent(day), { guest: 7_000, wallet: 0 });
      assert.deepEqual(await fx.store.spent("2026-01-01"), { guest: 0, wallet: 0 }, "each day on its own");
    });

    test("many reservations at once never pass the ceiling", async () => {
      const day = "2026-12-01";
      const results = await Promise.all(Array.from({ length: 12 }, () => fx.store.reserve(day, "wallet", 1_000, { total: 5_000, guest: 3_000 })));
      assert.equal(results.filter((r) => r.ok).length, 5);
      assert.deepEqual(await fx.store.spent(day), { guest: 0, wallet: 5_000 });
    });

    test("a guest's progress is handed over once", async () => {
      const guest = fresh();
      assert.equal(await fx.store.release(guest), null);
      await fx.store.crack(guest, crack("practice-1"), T0);
      await fx.store.crack(guest, crack("practice-2"), T0);
      const both = await Promise.all([fx.store.release(guest), fx.store.release(guest)]);
      const taken = both.filter(Boolean);
      assert.equal(taken.length, 1, "two at once hand it over once");
      assert.deepEqual(taken[0], { cracked: { "practice-1": DAY, "practice-2": DAY }, dailyDays: [], points: 20, title: null });
      assert.deepEqual(await fx.store.progress(guest), emptyProgress());
    });

    test("an answer is kept ten minutes", async () => {
      const key = `${fresh()}:idem-key-1`;
      assert.equal(await fx.store.answer(key, T0), null);
      await fx.store.keepAnswer(key, { status: 200, body: { outcome: "held" }, cookie: "v1.x.y" }, T0);
      assert.deepEqual(await fx.store.answer(key, T0 + 9 * 60_000), { status: 200, body: { outcome: "held" }, cookie: "v1.x.y" });
      assert.equal(await fx.store.answer(key, T0 + 11 * 60_000), null);
    });
  });
}

suite("memory", memoryFixture);
suite("postgres (the migration)", pgFixture, !process.env.VAULT_TEST_DATABASE_URL);

test("only the database is durable; the memory store says it is not", () => {
  assert.equal(createMemoryVaultStore().durable, false);
  assert.equal(createSupabaseVaultStore(async () => ({ ok: false, error: "x" })).durable, true);
});

test("production opens on the database only; the switch still decides everywhere", () => {
  const memory = { durable: false };
  const database = { durable: true };
  assert.equal(vaultReady(memory, "open", "production"), false, "flipping the switch cannot ship the memory store");
  assert.equal(vaultReady(database, "open", "production"), true);
  assert.equal(vaultReady(memory, "open", "development"), true, "a developer's machine plays on memory");
  for (const flag of [undefined, "", "closed", "OPEN"]) {
    assert.equal(vaultReady(database, flag, "production"), false, String(flag));
    assert.equal(vaultReady(memory, flag, "development"), false, String(flag));
  }
  const db = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", BETA_APP_SECRET: "s" };
  assert.equal(storeKind({ ...db, NODE_ENV: "production" }), "database");
  assert.equal(storeKind({ NODE_ENV: "production" }), "memory", "no settings, no database — and then production stays closed");
  assert.equal(storeKind({ ...db, NODE_ENV: "development" }), "memory");
  assert.equal(storeKind({ ...db, NODE_ENV: "development", RYNTRA_VAULT_STORE: "database" }), "database");
});

test("a deployment's guards: the real model with a key and a ceiling, or closed; a developer plays the stub", () => {
  const prod = { NODE_ENV: "production" };
  const key = "sk-or-v1-0123456789abcdef";
  assert.deepEqual(guardSetup(prod).missing, [VAULT_ENV.key, VAULT_ENV.ceiling], "nothing set: closed, and the log says what is missing");
  assert.deepEqual(guardSetup({ ...prod, [VAULT_ENV.key]: key }).missing, [VAULT_ENV.ceiling], "no ceiling, no guards");
  const ready = guardSetup({ ...prod, [VAULT_ENV.key]: key, [VAULT_ENV.ceiling]: "5" });
  assert.deepEqual(ready, { model: "live", apiKey: key, ceilingMicroUsd: 5_000_000, missing: [] });
  const shared = guardSetup({ ...prod, [VAULT_ENV.sharedKey]: key, [VAULT_ENV.ceiling]: "2.5" });
  assert.deepEqual(shared, { model: "live", apiKey: null, ceilingMicroUsd: 2_500_000, missing: [] }, "the gateway's shared key will do");
  assert.deepEqual(guardSetup({ ...prod, [VAULT_ENV.key]: key, [VAULT_ENV.ceiling]: "5", [VAULT_ENV.guard]: "stub" }).missing, [VAULT_ENV.guard], "never the stub in production");
  assert.deepEqual(guardSetup({ NODE_ENV: "development" }), { model: "stub", apiKey: null, ceilingMicroUsd: DEV_CEILING_MICRO_USD, missing: [] });
  assert.equal(guardSetup({ NODE_ENV: "development", [VAULT_ENV.key]: key }).model, "live", "a developer with a key talks to the real model");
  assert.equal(guardSetup({ NODE_ENV: "development", [VAULT_ENV.key]: key, [VAULT_ENV.guard]: "stub" }).model, "stub");
  assert.equal(guardSetup({ NODE_ENV: "development", [VAULT_ENV.ceiling]: "0.004" }).ceilingMicroUsd, 4_000);
});

test("a ceiling is dollars, above nothing and at most a thousand", () => {
  assert.equal(readCeiling("5"), 5_000_000);
  assert.equal(readCeiling(" 2.50 "), 2_500_000);
  assert.equal(readCeiling("0.000001"), 1);
  assert.equal(readCeiling("1000"), 1_000_000_000);
  for (const bad of [undefined, "", "0", "0.0", "-1", "1e3", "1001", "$5", "5 USD", "1,5", "abc", "0.0000001"]) assert.equal(readCeiling(bad), null, String(bad));
});

test("the store calls only functions the migrations make, with exactly their arguments", async () => {
  const sql = ["20261027200000_vault_v1.sql", "20261108120000_vault_v2_spend.sql"]
    .map((f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8"))
    .join("\n");
  const params = new Map();
  for (const m of sql.matchAll(/create function public\.(\w+)\(([^)]*)\)/g)) {
    params.set(m[1], m[2].split(",").map((p) => p.trim().split(/\s+/)[0]).filter((p) => p && p !== "p_secret").sort());
  }
  const calls = [];
  const answers = {
    vault_take: { ok: true, allowed: true, ticket: "00000000-0000-4000-8000-000000000000", left: { minute: 2, day: 24 } },
    vault_give_back: { ok: true },
    vault_left: { ok: true, left: { minute: { left: 3, resetS: 0 }, day: { left: 25, resetS: 0 } } },
    vault_progress: { ok: true, progress: { cracked: {}, dailyDays: [], points: 0, title: null } },
    vault_crack: { ok: true, recorded: true, title: null, progress: { cracked: { "practice-1": DAY }, dailyDays: [], points: 10, title: null } },
    vault_push: { ok: true },
    vault_feed: { ok: true, entries: [entry("e1")] },
    vault_answer: { ok: true, body: null },
    vault_keep_answer: { ok: true },
    vault_spend_reserve: { ok: true, allowed: true, spent: { guest: 2_500, wallet: 0 } },
    vault_spend_settle: { ok: true, over: 0, spent: { guest: 1_000, wallet: 0 } },
    vault_spend_read: { ok: true, spent: { guest: 1_000, wallet: 0 } },
    vault_release: { ok: true, progress: null },
  };
  const store = createSupabaseVaultStore(async (fn, args) => {
    calls.push([fn, Object.keys(args).sort()]);
    return { ok: true, data: answers[fn] };
  });
  await store.take("g:x", PERSON_LIMITS, T0);
  await store.giveBack("g:x", "00000000-0000-4000-8000-000000000000");
  assert.deepEqual(await store.left("g:x", PERSON_LIMITS, T0), { minute: { left: 3, resetS: 0 }, day: { left: 25, resetS: 0 } });
  assert.deepEqual(await store.progress("g:x"), emptyProgress());
  assert.equal((await store.crack("g:x", crack("practice-1"), T0)).recorded, true);
  await store.push(entry("e1"));
  assert.deepEqual(await store.feed("practice-1", 21, null), [entry("e1")]);
  assert.equal(await store.answer("k", T0), null);
  await store.keepAnswer("k", { a: 1 }, T0);
  assert.deepEqual(await store.reserve("2026-11-08", "guest", 2_500, { total: 5_000_000, guest: 3_500_000 }), { ok: true, spent: { guest: 2_500, wallet: 0 } });
  assert.deepEqual(await store.settle("2026-11-08", "guest", -1_500, { total: 5_000_000, guest: 3_500_000 }), { over: 0 });
  assert.deepEqual(await store.spent("2026-11-08"), { guest: 1_000, wallet: 0 });
  assert.equal(await store.release("g:x"), null);
  assert.deepEqual([...new Set(calls.map(([fn]) => fn))].sort(), [...params.keys()].sort(), "every function, and only those");
  for (const [fn, keys] of calls) assert.deepEqual(keys, params.get(fn), fn);
});

test("a refusal, a transport failure or an unreadable answer is VaultStoreUnavailable", async () => {
  const failing = createSupabaseVaultStore(async () => ({ ok: false, error: "temporarily unavailable" }));
  await assert.rejects(failing.progress("g:x"), VaultStoreUnavailable);
  const refusing = createSupabaseVaultStore(async () => ({ ok: true, data: { ok: false, error: "bad_request" } }));
  await assert.rejects(refusing.take("g:x", PERSON_LIMITS, T0), VaultStoreUnavailable);
  const odd = createSupabaseVaultStore(async () => ({ ok: true, data: { ok: true, allowed: "maybe" } }));
  await assert.rejects(odd.take("g:x", PERSON_LIMITS, T0), VaultStoreUnavailable);
  const refused = createSupabaseVaultStore(async () => ({ ok: true, data: { ok: true, allowed: false, window: "minute", retryAfterS: 12 } }));
  assert.deepEqual(await refused.take("g:x", PERSON_LIMITS, T0), { ok: false, window: "minute", retryAfterS: 12 });
});

test("a crack on the progress as it is: what it pays and what it leaves alone", () => {
  const before = emptyProgress();
  const done = applyCrack(before, crack("practice-3"));
  assert.deepEqual(before, emptyProgress(), "the progress it was given is not changed");
  assert.deepEqual(done, { recorded: true, title: "breaker", progress: { cracked: { "practice-3": DAY }, dailyDays: [], points: 10, title: "breaker" } });
  let p = emptyProgress();
  for (let d = 1; d <= 3; d += 1) p = applyCrack(p, crack("daily", `2026-10-0${d}`, { keepDays: 2 })).progress;
  assert.deepEqual(p.dailyDays, ["2026-10-03", "2026-10-02"], "newest first, as many days as kept");
});
