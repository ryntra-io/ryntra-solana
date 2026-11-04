import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CAPTAIN_MIN_COPIES, COPY_PENDING_MS, dayOf } from "./captain.ts";
import { isSolPier, readRecord, readReport, reportCopy, runPass } from "./captain-ledger.ts";
import { captainReady, captainStoreKind, copyOfRow, createMemoryCaptainStore, pointOfRow, REPORTS_PER_DAY } from "./captain-store.ts";
import { createSupabaseCaptainStore } from "./captain-db.ts";

const SOL = "So11111111111111111111111111111111111111112";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const POOL = "BoeMUkCLHchTD31HdXsbDExuZZfcUppSLpYtV3LZTH6U";
const SHALLOW = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const DAY = 86_400_000;
const T0 = Date.parse("2026-09-01T03:41:00Z");

const wallet = (i) => `${"1".repeat(31)}${String.fromCharCode(65 + i)}`;
const positionOf = (i) => `${"2".repeat(31)}${String.fromCharCode(65 + i)}`;

/** The venue's record of the JitoSOL–SOL pool (X JitoSOL, Y SOL), with its prices. */
function record({ address = POOL, tvl = 12_400_000, jito = 252, sol = 200 } = {}) {
  const token = (mint, symbol, priceUsd) => ({ mint, symbol, decimals: 9, priceUsd, verified: true });
  return {
    ok: true,
    at: "2026-09-01T03:40:00Z",
    pool: {
      kind: "dlmm", address, name: "JitoSOL-SOL", x: token(JITO, "JitoSOL", jito), y: token(SOL, "SOL", sol), price: jito / sol, tvlUsd: tvl,
      volume24hUsd: 9_100_000, fees24hUsd: 910, baseFeePct: 0.01, dynamicFeePct: null, maxFeePct: null, protocolSharePct: 5, binStepBps: 1,
      range: null, compounding: false, xAmount: null, yAmount: null, hasFarm: false, blacklisted: false, createdAt: null, launchpad: null,
      source: { api: "fixture", page: "fixture" },
    },
  };
}

const units = (amount) => ({ asset: "", units: String(Math.round(amount * 1e9)), decimals: 9 });

/** A DLMM position as the engine's venue adapter returns it. */
function position({ address = positionOf(0), owner = wallet(0), x = 1, y = 1.26, ux = 0, uy = 0, lower = 1000, upper = 1032, pool = POOL } = {}) {
  return {
    venue: "meteora-dlmm", network: "solana-mainnet", address, pool, owner, feeRecipient: owner, nftMint: null,
    range: { kind: "bins", lowerBin: lower, upperBin: upper, lowerPrice: "1.25", upperPrice: "1.27" },
    rangeState: "in_range",
    amounts: { x: { ...units(x), asset: JITO }, y: { ...units(y), asset: SOL } },
    unclaimedFees: { x: { ...units(ux), asset: JITO }, y: { ...units(uy), asset: SOL } },
    unclaimedRewards: [], lockedBps: 0, source: { slot: 1, at: T0 },
  };
}

function chain({ now = T0, held = {}, records = {} } = {}) {
  const clock = { now };
  return {
    clock,
    deps: {
      positions: async (owner) => (owner in held ? held[owner] : []),
      record: async (pool) => records[pool] ?? record({ address: pool }),
      now: () => clock.now,
    },
  };
}

test("a report is read field by field", () => {
  assert.deepEqual(readReport({ owner: wallet(0), position: positionOf(0), pool: POOL, style: "dense" }), { owner: wallet(0), position: positionOf(0), pool: POOL, style: "dense" });
  assert.equal(readReport({ owner: wallet(0), position: positionOf(0), pool: POOL, style: "wild" }), null);
  assert.equal(readReport({ owner: wallet(0), position: wallet(0), pool: POOL, style: "dense" }), null);
  assert.equal(readReport(null), null);
});

test("only a verified, deep SOL pier is a pier", () => {
  assert.equal(isSolPier(record()), true);
  assert.equal(isSolPier(record({ tvl: 1000 })), false);
  assert.equal(isSolPier({ ok: false, at: null, pool: null }), false);
});

test("a copy on a pier counts once the chain shows it as the recipe, and never twice", async () => {
  const store = createMemoryCaptainStore();
  const { deps } = chain({ held: { [wallet(0)]: [position()] } });
  const input = { owner: wallet(0), position: positionOf(0), pool: POOL, style: "balanced" };
  assert.deepEqual(await reportCopy(store, input, deps), { ok: true, state: "counted" });
  const [copy] = await store.copies();
  assert.ok(copy.entry);
  assert.equal(copy.entry.lamports, String(Math.round(((1 * 252 + 1.26 * 200) / 200) * 1e9)));
  assert.deepEqual(await reportCopy(store, input, deps), { ok: true, state: "known" });
  assert.deepEqual(await reportCopy(store, { ...input, pool: SHALLOW }, { ...deps, record: async () => record({ address: SHALLOW, tvl: 10 }) }), { ok: false, code: "NOT_A_PIER" });
});

test("a copy the chain does not show yet waits; one shown as something else is dropped", async () => {
  const store = createMemoryCaptainStore();
  const late = chain({ held: { [wallet(0)]: [] } });
  assert.deepEqual(await reportCopy(store, { owner: wallet(0), position: positionOf(0), pool: POOL, style: "balanced" }, late.deps), { ok: true, state: "added" });
  assert.equal((await store.copies())[0].entry, null);

  const wrong = chain({ held: { [wallet(1)]: [position({ address: positionOf(1), owner: wallet(1), lower: 0, upper: 68 })] } });
  assert.deepEqual(await reportCopy(store, { owner: wallet(1), position: positionOf(1), pool: POOL, style: "dense" }, wrong.deps), { ok: true, state: "added" });
  assert.equal((await store.copies()).length, 1, "a calm-wide position reported as dense never enters the ledger");
});

test("a wallet reports a few copies a day", async () => {
  const store = createMemoryCaptainStore();
  const { deps } = chain();
  for (let i = 0; i < REPORTS_PER_DAY; i++) {
    const answer = await reportCopy(store, { owner: wallet(0), position: positionOf(i), pool: POOL, style: "calm" }, deps);
    assert.equal(answer.state, "added");
  }
  assert.deepEqual(await reportCopy(store, { owner: wallet(0), position: positionOf(20), pool: POOL, style: "calm" }, deps), { ok: true, state: "limit" });
});

test("thirty-one daily passes over five wallets' copies make a proven record; the window reads it", async () => {
  const store = createMemoryCaptainStore();
  const held = {};
  for (let i = 0; i < CAPTAIN_MIN_COPIES; i++) held[wallet(i)] = [position({ address: positionOf(i), owner: wallet(i) })];
  const world = chain({ held });
  for (let i = 0; i < CAPTAIN_MIN_COPIES; i++) await reportCopy(store, { owner: wallet(i), position: positionOf(i), pool: POOL, style: "balanced" }, world.deps);

  for (let day = 1; day <= 31; day++) {
    world.clock.now = T0 + day * DAY;
    // Each day a little more in fees, the price steady.
    for (let i = 0; i < CAPTAIN_MIN_COPIES; i++) held[wallet(i)] = [position({ address: positionOf(i), owner: wallet(i), ux: day * 0.0004, uy: day * 0.0005 })];
    const pass = await runPass(store, world.deps);
    assert.equal(pass.live, CAPTAIN_MIN_COPIES);
    assert.equal(pass.points, 1);
  }
  const points = await store.points("2000-01-01");
  assert.equal(points.length, 31);
  assert.equal(points.at(-1).day, dayOf(T0 + 31 * DAY));

  const answer = await readRecord(store, true, world.clock.now + 60_000);
  assert.equal(answer.strategies.length, 1);
  const [card] = answer.strategies;
  assert.equal(card.copies, CAPTAIN_MIN_COPIES);
  assert.ok(card.resultPct > 0);
  assert.ok(Math.abs(card.pricePct) < 1e-9, "the price did not move: the whole result is fees");
  assert.equal(card.drawdownPct, 0);
  assert.deepEqual(await readRecord(store, false, world.clock.now), { strategies: [], counting: false, at: world.clock.now }, "not counting — nothing is shown");
});

test("a pass leaves alone what the chain did not answer for, and drops what never opened", async () => {
  const store = createMemoryCaptainStore();
  const world = chain({ held: { [wallet(0)]: [] } });
  await reportCopy(store, { owner: wallet(0), position: positionOf(0), pool: POOL, style: "balanced" }, world.deps);
  world.deps.positions = async () => null;
  world.clock.now = T0 + COPY_PENDING_MS * 2;
  await runPass(store, world.deps);
  assert.equal((await store.copies()).length, 1, "the chain was silent: the copy waits");
  world.deps.positions = async () => [];
  const pass = await runPass(store, world.deps);
  assert.equal(pass.dropped, 1);
  assert.equal((await store.copies()).length, 0);
});

test("the store's rules: memory on a developer's machine, the database in production, counting only where it is shared", () => {
  const db = { SUPABASE_URL: "u", SUPABASE_ANON_KEY: "k", BETA_APP_SECRET: "s" };
  assert.equal(captainStoreKind({ ...db, NODE_ENV: "production" }), "database");
  assert.equal(captainStoreKind({ NODE_ENV: "production" }), "memory");
  assert.equal(captainStoreKind({ ...db, NODE_ENV: "development" }), "memory");
  assert.equal(captainStoreKind({ ...db, NODE_ENV: "development", RYNTRA_CITY_CAPTAIN_STORE: "database" }), "database");
  assert.equal(captainReady({ durable: false }, "open", "production"), false);
  assert.equal(captainReady({ durable: true }, "open", "production"), true);
  assert.equal(captainReady({ durable: false }, "open", "development"), true);
  assert.equal(captainReady({ durable: true }, "closed", "production"), false);
});

test("rows are read field by field; the database store calls its functions and refuses what it cannot read", async () => {
  assert.equal(copyOfRow({ position: "x" }), null);
  assert.equal(pointOfRow({ strategy: `${POOL}:calm`, day: "2026-10-01", copies: 5, holdUsd: 1, netUsd: 0, feesUsd: 0 }), null);
  const calls = [];
  const rpc = async (fn) => {
    calls.push(fn);
    if (fn === "city_captain_report") return { ok: true, data: { ok: true, state: "added" } };
    if (fn === "city_captain_copies") return { ok: true, data: { ok: true, copies: [{ position: positionOf(0), owner: wallet(0), pool: POOL, style: "calm", addedAt: T0, entry: null, claimedUsd: 0 }, { bad: true }] } };
    if (fn === "city_captain_points") return { ok: true, data: { ok: true, points: "nope" } };
    return { ok: false, error: "down" };
  };
  const store = createSupabaseCaptainStore(rpc);
  assert.equal(store.durable, true);
  assert.equal(await store.report({ position: positionOf(0), owner: wallet(0), pool: POOL, style: "calm", addedAt: T0 }, T0), "added");
  assert.equal((await store.copies()).length, 1);
  await assert.rejects(store.points("2026-01-01"));
  await assert.rejects(store.putPoints([{ strategy: `${POOL}:calm`, day: "2026-10-01", copies: 5, holdUsd: 1, netUsd: 0, feesUsd: 0, at: T0 }]));
  await store.save([], [], T0);
  assert.deepEqual(calls, ["city_captain_report", "city_captain_copies", "city_captain_points", "city_captain_points_put"]);
});

test("the ledger's migration is a prepared file: one transaction, private tables, secret-gated functions", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261031120000_city_earn_captain_v1.sql", import.meta.url), "utf8");
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  for (const table of ["city_captain_copies", "city_captain_points"]) {
    assert.match(sql, new RegExp(`create table private\\.${table}`));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security;`));
    assert.match(sql, new RegExp(`revoke all privileges on table private\\.${table} from public, anon, authenticated, service_role;`));
  }
  const code = sql.replace(/^\s*--.*$/gm, "");
  const functions = [...code.matchAll(/create function public\.(city_captain_\w+)/g)].map((m) => m[1]);
  assert.deepEqual(functions.sort(), ["city_captain_copies", "city_captain_points", "city_captain_points_put", "city_captain_report", "city_captain_save"]);
  assert.equal((code.match(/perform private\.beta_check_secret\(p_secret\);/g) ?? []).length, functions.length, "every function checks the secret");
  assert.equal((code.match(/security definer/g) ?? []).length, functions.length);
  const rollback = readFileSync(new URL("../../../supabase/prepared/20261031_city_earn_captain_v1_rollback.sql", import.meta.url), "utf8");
  for (const fn of functions) assert.match(rollback, new RegExp(`drop function if exists public\\.${fn}\\(`));
});
