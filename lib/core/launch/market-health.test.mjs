import assert from "node:assert/strict";
import test from "node:test";

import BN from "bn.js";
import * as sdk from "@meteora-ag/dynamic-bonding-curve-sdk";

import { presetCurve } from "../venues/meteora-dbc/launch.server.ts";
import { LAUNCH_PRESETS } from "../venues/meteora-dbc/presets.ts";
import {
  CONCENTRATION_MARK_BPS,
  CYCLE_RANK,
  DBC_MIGRATION_PROGRESS,
  DEPTH_DROPS_BPS,
  MARKET_CYCLE_STATES,
  MARKET_RULE_CODES,
  MARKET_RULE_KEEPING,
  MIGRATION_LATE_SECONDS,
  curveDepthRaw,
  curveQuoteAt,
  holdersAndConcentration,
  isqrt,
  ladderDepthRaw,
  marketCycleState,
  marketRules,
  poolDepthRaw,
  sqrtDropFactor,
  survival,
} from "./market-health.ts";

const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, usdPrice: 1 };
const big = (value) => BigInt(value.toString());

/* ------------------------------------------------------------ the cycle */

const base = {
  migrated: false,
  migrationProgress: DBC_MIGRATION_PROGRESS.PRE_BONDING_CURVE,
  reserveRaw: 5_000_000n,
  thresholdRaw: 15_454_000_000n,
  finishedAt: null,
  launchedAt: 1_000,
  foreignTrade: { seen: false, at: null },
  graduatedAt: null,
  ladder: { placedAt: null, maintainedAt: null },
  budget: null,
  pause: null,
  now: 10_000,
};

test("a market's state on its curve: created, price discovery, ready, migrating, failed", () => {
  assert.deepEqual(marketCycleState(base), { state: "CREATED", since: 1_000 });
  assert.deepEqual(marketCycleState({ ...base, foreignTrade: { seen: true, at: 2_000 } }), { state: "PRICE_DISCOVERY", since: 2_000 });
  /* A history too long to read whole is a traded curve — never «created» on a guess. */
  assert.equal(marketCycleState({ ...base, foreignTrade: { seen: null, at: null } }).state, "PRICE_DISCOVERY");
  assert.deepEqual(marketCycleState({ ...base, reserveRaw: base.thresholdRaw, finishedAt: 9_900 }), { state: "GRADUATION_READY", since: 9_900 });
  assert.equal(marketCycleState({ ...base, reserveRaw: base.thresholdRaw }).state, "GRADUATION_READY", "a full curve before its finish time is read");
  /*
   * Every Ryntra preset needs no locker, so the swap that fills the curve marks it 2 at once: a full curve waiting for its
   * migration, never «migrating» — that is only a send the executor recorded in flight.
   */
  const filled = { ...base, reserveRaw: base.thresholdRaw, migrationProgress: DBC_MIGRATION_PROGRESS.LOCKED_VESTING };
  assert.deepEqual(marketCycleState({ ...filled, finishedAt: 9_900 }), { state: "GRADUATION_READY", since: 9_900 });
  assert.equal(marketCycleState({ ...filled, finishedAt: 9_000 }).state, "MIGRATION_FAILED", "filled 1 000 s ago and not on the DEX");
  assert.deepEqual(marketCycleState({ ...filled, finishedAt: 9_900, migrationSent: true }), { state: "MIGRATING", since: 9_900 });
  assert.equal(marketCycleState({ ...base, migrationProgress: DBC_MIGRATION_PROGRESS.POST_BONDING_CURVE }).state, "GRADUATION_READY", "past the curve by its own mark");
  const late = marketCycleState({ ...base, reserveRaw: base.thresholdRaw, finishedAt: 10_000 - MIGRATION_LATE_SECONDS - 1 });
  assert.equal(late.state, "MIGRATION_FAILED");
  assert.equal(late.since, 10_000 - 1);
  assert.equal(marketCycleState({ ...base, reserveRaw: base.thresholdRaw, finishedAt: 10_000 - MIGRATION_LATE_SECONDS }).state, "GRADUATION_READY", "exactly at the limit it is still on its way");
});

test("a market's state after the DEX: core market, budget, ladder, maintained, paused, exhausted", () => {
  const dex = { ...base, migrated: true, migrationProgress: DBC_MIGRATION_PROGRESS.CREATED_POOL, reserveRaw: base.thresholdRaw, finishedAt: 5_000, graduatedAt: 5_010 };
  assert.deepEqual(marketCycleState(dex), { state: "CORE_MARKET_LIVE", since: 5_010 });
  assert.deepEqual(marketCycleState({ ...dex, budget: { state: "FUNDED", at: 6_000 } }), { state: "ENDOWMENT_FUNDED", since: 6_000 });
  assert.deepEqual(marketCycleState({ ...dex, ladder: { placedAt: 7_000, maintainedAt: null } }), { state: "LADDER_ACTIVE", since: 7_000 });
  assert.deepEqual(marketCycleState({ ...dex, ladder: { placedAt: 7_000, maintainedAt: 8_000 } }), { state: "MAINTAINING", since: 8_000 });
  assert.deepEqual(marketCycleState({ ...dex, ladder: { placedAt: 7_000, maintainedAt: 8_000 }, budget: { state: "EXHAUSTED", at: 9_000 } }), { state: "ENDOWMENT_EXHAUSTED", since: 9_000 });
  assert.deepEqual(marketCycleState({ ...dex, pause: { at: 9_500 } }), { state: "PAUSED_RISK", since: 9_500 });
  /* No input names maturity: in this version it is never inferred. */
  for (const variant of [base, dex]) assert.notEqual(marketCycleState(variant).state, "MATURE");
});

test("every state has a rank", () => {
  for (const state of MARKET_CYCLE_STATES) assert.equal(typeof CYCLE_RANK[state], "number", state);
  assert.ok(CYCLE_RANK.CORE_MARKET_LIVE > CYCLE_RANK.GRADUATION_READY);
});

/* ------------------------------------------------------------ depth */

test("isqrt and the drop factor", () => {
  for (const n of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 10n ** 36n, 10n ** 36n + 12345n, (1n << 200n) - 1n]) {
    const root = isqrt(n);
    assert.ok(root * root <= n && (root + 1n) * (root + 1n) > n, `isqrt(${n})`);
  }
  assert.equal(sqrtDropFactor(500), isqrt(9_500n * 10n ** 32n));
  const factor = Number(sqrtDropFactor(1_000)) / 1e18;
  assert.ok(Math.abs(factor - Math.sqrt(0.9)) < 1e-15);
  assert.throws(() => sqrtDropFactor(0));
  assert.throws(() => sqrtDropFactor(10_000));
  assert.throws(() => sqrtDropFactor(2.5));
});

test("the curve's depth is Meteora's own reserve at the two prices", () => {
  const config = presetCurve(LAUNCH_PRESETS.classic, USDC);
  const points = config.curve.map((point) => ({ sqrtPrice: big(point.sqrtPrice), liquidity: big(point.liquidity) }));
  const start = big(config.sqrtStartPrice);
  /* The curve's first segment ends at the graduation price; the second only holds what is left over beyond it. */
  const top = points[0].sqrtPrice;
  /* The reserve at a price matches the SDK's, rounded the other way at most one unit a segment. */
  for (const share of [0n, 1n, 10n, 50n, 99n, 100n]) {
    const sqrtPrice = start + ((top - start) * share) / 100n;
    const sdkReserve = big(sdk.getQuoteReserveFromNextSqrtPrice(new BN(sqrtPrice.toString()), { sqrtStartPrice: new BN(start.toString()), curve: config.curve }));
    const ours = curveQuoteAt(sqrtPrice, start, points);
    assert.ok(sdkReserve - ours >= 0n && sdkReserve - ours <= BigInt(points.length), `reserve at ${share} %: ${ours} vs ${sdkReserve}`);
  }
  /* A full curve holds its threshold (the config's own number). */
  const full = curveQuoteAt(top, start, points);
  assert.ok(full - big(config.migrationQuoteThreshold) <= BigInt(points.length) && big(config.migrationQuoteThreshold) - full <= BigInt(points.length), `full ${full} vs threshold ${config.migrationQuoteThreshold}`);
  /* Depth rises with the drop, never exceeds what the curve holds, and is nothing at its opening price. */
  const sqrtPrice = start + (top - start) / 2n;
  const held = curveQuoteAt(sqrtPrice, start, points);
  let last = 0n;
  for (const drop of DEPTH_DROPS_BPS) {
    const depth = curveDepthRaw({ sqrtPrice, sqrtStartPrice: start, points }, drop);
    assert.ok(depth > last && depth <= held, `depth at ${drop}`);
    last = depth;
  }
  assert.equal(curveDepthRaw({ sqrtPrice: start, sqrtStartPrice: start, points }, 500), 0n);
});

test("the pool's depth: a compounding pool by its reserves, a concentrated one by its liquidity", () => {
  /* x · y = k: a sale that moves the price 5 % down takes y · (1 − √0.95) of the pair. */
  const y = 688_000_000n;
  const compounding = { compounding: true, tokenIsA: true, pairReserveRaw: y, sqrtPrice: 0n, sqrtMinPrice: 0n, sqrtMaxPrice: 0n, liquidity: 0n };
  const at5 = poolDepthRaw(compounding, 500);
  assert.ok(Math.abs(Number(at5) - 688_000_000 * (1 - Math.sqrt(0.95))) <= 1, `compounding ${at5}`);
  /* The same depth from the constant product directly: sell Δx so that the price falls by 5 %. */
  const x = 1_000_000_000_000n;
  const xAfter = Number(x) / Math.sqrt(0.95);
  const out = Number(y) - (Number(x) * Number(y)) / xAfter;
  assert.ok(Math.abs(Number(at5) - out) <= 1);
  /* Concentrated, token A: L·(√P − √P')/2¹²⁸ — and the same pool as token B gives the pair (A) the other way. */
  const Q64 = 1n << 64n;
  const sqrtPrice = Q64 * 3n;
  const liquidity = 10n ** 6n * Q64;
  const asA = poolDepthRaw({ compounding: false, tokenIsA: true, pairReserveRaw: 0n, sqrtPrice, sqrtMinPrice: 1n, sqrtMaxPrice: Q64 * 100n, liquidity }, 1_000);
  const expectedA = (liquidity * (sqrtPrice - (sqrtPrice * sqrtDropFactor(1_000)) / 10n ** 18n)) >> 128n;
  assert.equal(asA, expectedA);
  const asB = poolDepthRaw({ compounding: false, tokenIsA: false, pairReserveRaw: 0n, sqrtPrice, sqrtMinPrice: 1n, sqrtMaxPrice: Q64 * 100n, liquidity }, 1_000);
  const upper = (sqrtPrice * 10n ** 18n) / sqrtDropFactor(1_000);
  assert.equal(asB, (liquidity * (upper - sqrtPrice)) / (sqrtPrice * upper));
  /* Clamped to the range: nothing below its lowest price. */
  assert.equal(poolDepthRaw({ compounding: false, tokenIsA: true, pairReserveRaw: 0n, sqrtPrice, sqrtMinPrice: sqrtPrice, sqrtMaxPrice: Q64 * 100n, liquidity }, 1_000), 0n);
});

test("Ryntra's steps count from the price now down to the drop, never above the price", () => {
  const bins = [
    { price: 0.96, pairRaw: 5_000_000n },
    { price: 0.95, pairRaw: 5_000_000n },
    { price: 0.9, pairRaw: 5_000_000n },
    { price: 0.89, pairRaw: 5_000_000n },
    { price: 1.2, pairRaw: 7_000_000n },
  ];
  assert.equal(ladderDepthRaw(bins, 1, 200), 0n);
  assert.equal(ladderDepthRaw(bins, 1, 500), 10_000_000n, "a step exactly at −5 % is reached");
  assert.equal(ladderDepthRaw(bins, 1, 1_000), 15_000_000n);
  assert.equal(ladderDepthRaw(bins, 0, 1_000), 0n);
});

/* ------------------------------------------------------------ holders and concentration */

test("holders: more than a dollar, without pools, locks and Ryntra's wallets; concentration without pools and locks", () => {
  const exclusions = {
    poolAccounts: new Set(["curveVault"]),
    poolOwners: new Set(["dammAuthority"]),
    lockOwners: new Set(["escrow"]),
    ryntraOwners: new Set(["executor"]),
  };
  const accounts = [
    { account: "curveVault", owner: "dbcAuthority", amountRaw: 800_000_000_000n },
    { account: "dammVault", owner: "dammAuthority", amountRaw: 100_000_000_000n },
    { account: "escrowAta", owner: "escrow", amountRaw: 20_000_000_000n },
    { account: "a1", owner: "alice", amountRaw: 40_000_000_000n },
    { account: "a2", owner: "alice", amountRaw: 10_000_000_000n },
    { account: "b1", owner: "bob", amountRaw: 20_000_000_000n },
    { account: "c1", owner: "carol", amountRaw: 5_000_000n },
    { account: "e1", owner: "executor", amountRaw: 5_000_000_000n },
    { account: "z1", owner: "zero", amountRaw: 0n },
  ];
  /* One token at $0.01: alice $500, bob $200, carol $0.05, the executor $50. */
  const read = holdersAndConcentration({ accounts, exclusions, tokenDecimals: 6, usdPerToken: 0.01 });
  assert.equal(read.holders, 2, "alice (two accounts as one) and bob; carol under a dollar; the executor is Ryntra's");
  assert.equal(read.circulatingRaw, 75_005_000_000n);
  assert.equal(read.top10Bps, 10_000, "four wallets: the ten largest are all of it");
  assert.equal(read.atLeast, false);
  assert.equal(read.top10AtLeast, false, "every account read: the share is exact");
  assert.equal(holdersAndConcentration({ accounts, exclusions, tokenDecimals: 6, usdPerToken: null }).holders, null, "no dollar price: not counted, never zero");
  const many = Array.from({ length: 20 }, (_, index) => ({ account: `w${index}`, owner: `w${index}`, amountRaw: 1_000_000n }));
  assert.equal(holdersAndConcentration({ accounts: many, exclusions, tokenDecimals: 6, usdPerToken: 2 }).top10Bps, 5_000);
  assert.equal(holdersAndConcentration({ accounts: [], exclusions, tokenDecimals: 6, usdPerToken: 1 }).top10Bps, null);
  assert.equal(CONCENTRATION_MARK_BPS, 6_000);
});

test("holders found but not every account: a floor; the largest accounts give the share over the supply less pools and locks", () => {
  const exclusions = { poolAccounts: new Set(["curveVault"]), poolOwners: new Set(["dammAuthority", "dlmm"]), lockOwners: new Set(["escrow"]), ryntraOwners: new Set() };
  const found = [
    { account: "curveVault", owner: "curveVault", amountRaw: 600n },
    { account: "escrowAta", owner: "escrow", amountRaw: 100n },
    { account: "a", owner: "alice", amountRaw: 150n },
    { account: "b", owner: "bob", amountRaw: 50n },
  ];
  /* Supply 1 000: 600 on the curve, 100 locked, 50 in Ryntra's steps the found accounts missed — 250 outside them. */
  const largest = holdersAndConcentration({ accounts: found, whole: false, largestRead: true, supplyRaw: 1_000n, poolsNotListed: [{ owner: "dlmm", amountRaw: 50n }], exclusions, tokenDecimals: 0, usdPerToken: 10 });
  assert.equal(largest.circulatingRaw, 250n);
  assert.equal(largest.top10Bps, 8_000, "alice and bob: 200 of 250");
  assert.equal(largest.top10AtLeast, true);
  assert.equal(largest.atLeast, true);
  assert.equal(largest.holders, 2);
  /* The steps found among the accounts are not taken off twice. */
  const listed = holdersAndConcentration({ accounts: [...found, { account: "dlmmReserve", owner: "dlmm", amountRaw: 50n }], whole: false, largestRead: true, supplyRaw: 1_000n, poolsNotListed: [{ owner: "dlmm", amountRaw: 50n }], exclusions, tokenDecimals: 0, usdPerToken: 10 });
  assert.equal(listed.circulatingRaw, 250n);
  /* Without the largest accounts the share is not known — never computed from a few. */
  const few = holdersAndConcentration({ accounts: found, whole: false, exclusions, tokenDecimals: 0, usdPerToken: 10 });
  assert.equal(few.top10Bps, null);
  assert.equal(few.top10AtLeast, false);
  assert.equal(few.atLeast, true);
});

/* ------------------------------------------------------------ rules */

test("rules and policies: only what is live, rules first, each with its keeper", () => {
  for (const code of MARKET_RULE_CODES) assert.ok(MARKET_RULE_KEEPING[code], code);
  const curveInput = {
    migrated: false,
    tokenMarks: [
      { code: "MINT_REVOKED", account: "mint" },
      { code: "NO_FREEZE", account: "mint" },
      { code: "CURVE_HOLDS_FUNDS", account: "curve" },
    ],
    config: "config",
    curve: "curve",
    launchSignature: "launchSig",
    thresholdRaw: "15454000000",
    lockedPositions: [],
    creatorLock: { escrow: "escrow", cliffAt: 2_000, endsAt: 5_000 },
    feeVault: null,
    firstBuyCapBps: 200,
    executor: null,
    ladderPool: null,
    concentrationRead: true,
    creatorSalesRead: true,
    now: 1_000,
  };
  const curve = marketRules(curveInput);
  assert.deepEqual(
    curve.map((rule) => [rule.code, rule.enforcement]),
    [
      ["MINT_REVOKED", "rule"],
      ["NO_FREEZE", "rule"],
      ["CONFIG_FIXED", "rule"],
      ["CURVE_HOLDS_FUNDS", "rule"],
      ["GRADUATION_AT_THRESHOLD", "rule"],
      ["CREATOR_LOCK", "rule"],
      ["CREATOR_FIRST_BUY_CAP", "policy"],
      ["CREATOR_SALE_MARK", "policy"],
      ["CONCENTRATION_MARK", "policy"],
    ],
    "no executor here: Ryntra sends no graduation, and none is claimed",
  );
  assert.deepEqual(curve.find((rule) => rule.code === "MINT_REVOKED").source, { kind: "account", id: "mint" });
  assert.equal(curve.find((rule) => rule.code === "MINT_REVOKED").by, "token-2022");
  assert.deepEqual(curve.find((rule) => rule.code === "CREATOR_FIRST_BUY_CAP").source, { kind: "tx", id: "launchSig" }, "the cap was applied in the launch's own transaction");
  const unread = marketRules({ ...curveInput, concentrationRead: false, creatorSalesRead: false }).map((rule) => rule.code);
  assert.ok(!unread.includes("CONCENTRATION_MARK") && !unread.includes("CREATOR_SALE_MARK"), "a mark on what was not read is not live");
  assert.ok(marketRules({ ...curveInput, executor: "executor" }).some((rule) => rule.code === "GRADUATION_BY_RYNTRA"), "an executor that runs here sends the graduation");
  const pool = marketRules({
    migrated: true,
    tokenMarks: [],
    config: "config",
    curve: "curve",
    launchSignature: "launchSig",
    thresholdRaw: "1",
    lockedPositions: [
      { position: "creatorPosition", owner: "creator" },
      { position: "partnerPosition", owner: "partner" },
    ],
    creatorLock: { escrow: "escrow", cliffAt: 2_000, endsAt: 5_000 },
    feeVault: "vault",
    firstBuyCapBps: 200,
    executor: "executor",
    ladderPool: "dlmm",
    concentrationRead: true,
    creatorSalesRead: true,
    now: 6_000,
  });
  const codes = pool.map((rule) => rule.code);
  assert.ok(!codes.includes("CURVE_HOLDS_FUNDS") && !codes.includes("GRADUATION_BY_RYNTRA"), "the curve's rules end with the curve");
  assert.ok(!codes.includes("CREATOR_LOCK"), "a lock that has ended is not live");
  assert.deepEqual(pool.filter((rule) => rule.code === "LP_LOCKED_FOREVER").map((rule) => rule.values.owner), ["creator", "partner"], "each locked share named by whose it is");
  assert.ok(codes.includes("FEE_FUNDED_LADDER") && codes.includes("CREATOR_FEES_SHARED"));
  const firstPolicy = pool.findIndex((rule) => rule.enforcement === "policy");
  assert.ok(pool.slice(firstPolicy).every((rule) => rule.enforcement === "policy"), "rules first, then policies");
  assert.ok(pool.filter((rule) => rule.enforcement === "policy").every((rule) => rule.by === "ryntra"), "a policy is always Ryntra's server");
});

/* ------------------------------------------------------------ survival */

test("survival: days since the DEX, the price against the pool's opening, a trade in the last day", () => {
  const now = 100 * 86_400;
  assert.deepEqual(survival({ graduatedAt: now - 3 * 86_400 - 5, priceNow: 1.1, priceAtDex: 1, lastTradeAt: now - 60, dayReadWhole: false, now }), { daysSinceDex: 3, priceVsDexBps: 1_000, traded24h: true });
  assert.deepEqual(survival({ graduatedAt: null, priceNow: 1, priceAtDex: 1, lastTradeAt: null, dayReadWhole: true, now }), { daysSinceDex: null, priceVsDexBps: null, traded24h: false });
  assert.equal(survival({ graduatedAt: null, priceNow: 1, priceAtDex: 1, lastTradeAt: now - 90_000, dayReadWhole: false, now }).traded24h, null, "an old trade seen and the day not read whole: not known");
});
