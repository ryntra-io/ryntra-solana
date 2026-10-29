import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { formatPoints } from "../points/model.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";
import { accrueRewards } from "./accrue.ts";
import { bindReferrer, ensureRewardAccount, listRewardEntries, recordRewards, totalRewards } from "./ledger.ts";
import { rankStanding, rankSummary, receivedUsdMicrosOf } from "./rank.ts";
import { listRankEvents, readRankStanding, recordLaunchGraduation, rewardRulesEffectiveFrom, rewardRulesFor } from "./rank-store.ts";
import { recordOperationRewards } from "./record.server.ts";
import {
  maxPayoutBps,
  RANK_THRESHOLDS,
  rankForPoints,
  rankThresholdsOf,
  REWARD_RANKS,
  REWARD_RULES_V1,
  REWARD_RULES_V2,
  REWARD_RULES_V2_1,
} from "./rules.ts";

/*
 * Rules 2.0.0 and ranks — the decision of 2026-10-04 and its worked examples.
 * Every figure below is from the plan's own worked examples or follows from
 * them; nothing is approximated, because these are debts.
 */

const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const C = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ENV = { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T15:25:00Z" };

/** A collected USDC fee: `gross` paid, `received` reached Ryntra (null = not stated). */
function usdcFee({ gross, received, ref, providerRaw }) {
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", {
    basisPoints: 50, asset: USDC, symbol: "USDC", decimals: 6, amountRaw: gross, providerRetainedPercent: 20,
  });
  return settleServiceFee(quoted, {
    collected: true,
    amountRaw: gross,
    settlement: {
      operationRef: ref, userPaidRaw: gross,
      providerRaw: providerRaw === undefined ? (received === null ? null : (BigInt(gross) - BigInt(received)).toString()) : providerRaw,
      ryntraRaw: received, asset: USDC, symbol: "USDC", decimals: 6, basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED",
    },
  });
}

function accrue(fee, { rules = REWARD_RULES_V2, rank = "BRONZE", l1 = B, l2 = A } = {}) {
  return accrueRewards({
    fee, trader: C, referrerL1: l1, referrerL2: l2, settledAt: "2026-10-05T10:00:00.000Z", now: "2026-10-05T10:00:00.000Z",
    price: null, rules, referrerL1Rank: rank,
  });
}

const shares = (result) => Object.fromEntries(result.entries.map((entry) => [entry.type, entry.usdMicros]));

test("ranks begin where the plan says, and each pays its level-1 share", () => {
  /* The ladder of 2026-10-27 (rules 2.2.0, the owner's variant Б): one decade down, and no share moved with it. */
  assert.deepEqual(REWARD_RANKS.map((rank) => RANK_THRESHOLDS[rank]), [0n, 10n, 100n, 1_000n, 10_000n]);
  assert.deepEqual(REWARD_RANKS.map((rank) => rankThresholdsOf(REWARD_RULES_V2_1)[rank]), [0n, 100n, 1_000n, 10_000n, 50_000n], "an operation of 2.1.0 keeps the ladder it settled under");
  assert.deepEqual(REWARD_RANKS.map((rank) => REWARD_RULES_V2.referralL1BpsByRank[rank]), [1000, 1500, 2000, 2500, 3000]);
  assert.equal(REWARD_RULES_V2.cashbackBps, 5000);
  assert.equal(REWARD_RULES_V2.referralL2Bps, 500);
  for (const [points, rank] of [[0n, "BRONZE"], [9n, "BRONZE"], [10n, "SILVER"], [99n, "SILVER"], [100n, "GOLD"], [999n, "GOLD"], [1_000n, "SAPPHIRE"], [9_999n, "SAPPHIRE"], [10_000n, "DIAMOND"], [10n ** 9n, "DIAMOND"]]) {
    assert.equal(rankForPoints(points), rank, `${points} points`);
  }
  /* The same points under the rules they settled under: the old ladder, unmoved. */
  for (const [points, rank] of [[99n, "BRONZE"], [100n, "SILVER"], [1_000n, "GOLD"], [10_000n, "SAPPHIRE"], [50_000n, "DIAMOND"]]) {
    assert.equal(rankForPoints(points, REWARD_RULES_V2_1), rank, `${points} points under 2.1.0`);
  }
});

test("no combination of ranks can pay out more than Ryntra received", () => {
  assert.equal(maxPayoutBps(REWARD_RULES_V2), 8500);
  assert.ok(maxPayoutBps(REWARD_RULES_V2) <= 10_000);
});

test("plan §4.3: a $1 000 meme trade at 1 % on the direct route — the trader $5, the inviter $1 to $3 by rank, the second level $0.50", () => {
  const fee = usdcFee({ gross: "10000000", received: "10000000", ref: "meme-direct" });
  for (const [rank, l1] of [["BRONZE", "1000000"], ["SILVER", "1500000"], ["GOLD", "2000000"], ["SAPPHIRE", "2500000"], ["DIAMOND", "3000000"]]) {
    const result = accrue(fee, { rank });
    assert.equal(result.ok, true);
    assert.deepEqual(shares(result), { CASHBACK: "5000000", REFERRAL_L1: l1, REFERRAL_L2: "500000" });
    const l1Row = result.entries.find((entry) => entry.type === "REFERRAL_L1");
    assert.deepEqual(l1Row.rules, { version: "2.0.0", base: "RECEIVED", baseRaw: "10000000", rank });
    assert.equal(result.entries.find((entry) => entry.type === "CASHBACK").rules.rank, null);
  }
});

test("plan §4.3: the same trade through Jupiter /order — shares of the $8 received, so Diamond pays $6.80 and Ryntra keeps $1.20", () => {
  const result = accrue(usdcFee({ gross: "10000000", received: "8000000", ref: "meme-order" }), { rank: "DIAMOND" });
  assert.deepEqual(shares(result), { CASHBACK: "4000000", REFERRAL_L1: "2400000", REFERRAL_L2: "400000" });
  const paid = result.entries.reduce((sum, entry) => sum + BigInt(entry.usdMicros), 0n);
  assert.equal(paid, 6_800_000n);
  assert.equal(8_000_000n - paid, 1_200_000n);
});

test("what reached Ryntra is read from the provider's share when the settlement does not state it, and an unknown is refused", () => {
  const derived = accrue(usdcFee({ gross: "5000000", received: null, providerRaw: "1000000", ref: "derived" }));
  assert.equal(shares(derived).CASHBACK, "2000000");
  const unknown = accrue(usdcFee({ gross: "5000000", received: null, providerRaw: null, ref: "unknown" }));
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /does not state what reached Ryntra/);
  const impossible = accrue(usdcFee({ gross: "5000000", received: "6000000", ref: "impossible" }));
  assert.equal(impossible.ok, false);
});

test("without rules the arithmetic is still 1.0.0: 50/10/5 of the gross, no rules on the rows", () => {
  const result = accrueRewards({
    fee: usdcFee({ gross: "5000000", received: "4000000", ref: "old" }), trader: C, referrerL1: B, referrerL2: A,
    settledAt: "2026-09-12T12:00:00.000Z", now: "2026-09-12T12:00:00.000Z", price: null,
  });
  assert.deepEqual(shares(result), { CASHBACK: "2500000", REFERRAL_L1: "500000", REFERRAL_L2: "250000" });
  assert.ok(result.entries.every((entry) => entry.rules === undefined));
  assert.deepEqual(shares(accrue(usdcFee({ gross: "5000000", received: "4000000", ref: "old" }), { rules: REWARD_RULES_V1, rank: "DIAMOND" })),
    { CASHBACK: "2500000", REFERRAL_L1: "500000", REFERRAL_L2: "250000" });
});

test("a provider-stated dollar figure is scaled from the gross to what was received", () => {
  const fee = usdcFee({ gross: "5000000", received: "4000000", ref: "stated" });
  const native = { ...fee, asset: "So11111111111111111111111111111111111111112", decimals: 9, settlement: { ...fee.settlement, asset: "So11111111111111111111111111111111111111112", decimals: 9 } };
  const result = accrueRewards({ fee: native, trader: C, referrerL1: B, referrerL2: null, settledAt: "2026-10-05T10:00:00.000Z", now: "2026-10-05T10:00:00.000Z", price: null, providerUsd: 2, rules: REWARD_RULES_V2, referrerL1Rank: "GOLD" });
  /* $2.00 paid, four fifths received = $1.60: cashback $0.80, Gold 20 % = $0.32. */
  assert.deepEqual(shares(result), { CASHBACK: "800000", REFERRAL_L1: "320000" });
});

/* ------------------------------------------------------------------ standing */

function row({ type, recipient, trader, usd, rateBps, settledAt, rules, mechanism = "JUPITER_REFERRAL", ref }) {
  return {
    type, recipient, rateBps, shareRaw: usd, usdMicros: usd,
    valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: USDC, observedAt: settledAt },
    source: { mechanism, operationRef: ref, trader, grossRaw: "1", asset: USDC, symbol: "USDC", decimals: 6, settledAt },
    createdAt: settledAt, claimId: null, signature: null,
    ...(rules ? { rules: { version: "2.0.0", base: "RECEIVED", baseRaw: "1", rank: type === "REFERRAL_L1" ? "BRONZE" : null } } : {}),
  };
}

test("points are dollars received on your trades and your friends', over the last 30 days", () => {
  const at = "2026-11-01T00:00:00.000Z";
  const entries = [
    /* $60 of cashback at 50 % = $120 received on own trades. */
    row({ type: "CASHBACK", recipient: B, trader: B, usd: "60000000", rateBps: 5000, settledAt: "2026-10-20T00:00:00.000Z", rules: true, ref: "own-1" }),
    /* $3 at 15 % = $20 received on a friend's trade. */
    row({ type: "REFERRAL_L1", recipient: B, trader: C, usd: "3000000", rateBps: 1500, settledAt: "2026-10-25T00:00:00.000Z", rules: true, ref: "friend-1" }),
    /* Rules 1.0.0, Jupiter: $5 cashback of a $10 gross, $8 of it received. */
    row({ type: "CASHBACK", recipient: B, trader: B, usd: "5000000", rateBps: 5000, settledAt: "2026-10-10T00:00:00.000Z", ref: "own-old" }),
    /* A second level never counts — not MLM. */
    row({ type: "REFERRAL_L2", recipient: B, trader: A, usd: "9000000", rateBps: 500, settledAt: "2026-10-25T00:00:00.000Z", rules: true, ref: "l2" }),
    /* Older than 30 days, and exactly on the window's start: outside. */
    row({ type: "CASHBACK", recipient: B, trader: B, usd: "500000000", rateBps: 5000, settledAt: "2026-09-01T00:00:00.000Z", rules: true, ref: "old" }),
    row({ type: "CASHBACK", recipient: B, trader: B, usd: "500000000", rateBps: 5000, settledAt: "2026-10-02T00:00:00.000Z", rules: true, ref: "edge" }),
    /* Still waiting for a price: counts nothing yet. */
    { ...row({ type: "CASHBACK", recipient: B, trader: B, usd: "1", rateBps: 5000, settledAt: "2026-10-30T00:00:00.000Z", rules: true, ref: "pending" }), usdMicros: null },
  ];
  const events = [
    { wallet: B, kind: "LAUNCH_GRADUATED", ref: "MintOne", points: "250", rulesVersion: "2.0.0", at: "2026-10-28T00:00:00.000Z", createdAt: "2026-10-28T00:00:00.000Z" },
    { wallet: B, kind: "LAUNCH_GRADUATED", ref: "MintOld", points: "250", rulesVersion: "2.0.0", at: "2026-09-28T00:00:00.000Z", createdAt: "2026-09-28T00:00:00.000Z" },
  ];
  const standing = rankStanding({ wallet: B, entries, events, at });
  assert.equal(standing.fromTrades, 128n);
  assert.equal(standing.fromFriends, 20n);
  assert.equal(standing.fromLaunches, 250n);
  assert.equal(standing.points, 398n);
  assert.equal(standing.rank, "GOLD");
  assert.deepEqual(standing.next, { rank: "SAPPHIRE", at: 1_000n });
  assert.equal(standing.referralL1Bps, 2000);
  /* The same 398 points under the rules of 2.1.0 are Silver: a ladder travels with the rules that judged the trade. */
  const under21 = rankStanding({ wallet: B, entries, events, at, rules: REWARD_RULES_V2_1 });
  assert.equal(under21.rank, "SILVER");
  assert.equal(under21.referralL1Bps, 1500);
  const summary = rankSummary(standing);
  assert.equal(summary.points, "398");
  assert.deepEqual(summary.next, { rank: "SAPPHIRE", at: formatPoints(1_000n), toGo: "602", friendShare: 25 });
  assert.equal(summary.friendShare, 20);
  assert.equal(summary.windowDays, 30);
  assert.equal(receivedUsdMicrosOf(entries[2]), 8_000_000n);
});

test("a fresh wallet is Bronze with nothing to its name, and Diamond has no next rank", () => {
  const fresh = rankStanding({ wallet: C, entries: [], events: [], at: "2026-10-05T00:00:00.000Z" });
  assert.equal(fresh.rank, "BRONZE");
  assert.equal(fresh.points, 0n);
  assert.equal(rankSummary(fresh).next.toGo, "10");
  const diamond = rankStanding({ wallet: B, entries: [row({ type: "CASHBACK", recipient: B, trader: B, usd: "25000000000", rateBps: 5000, settledAt: "2026-10-04T00:00:00.000Z", rules: true, ref: "whale" })], events: [], at: "2026-10-05T00:00:00.000Z" });
  assert.equal(diamond.rank, "DIAMOND");
  assert.equal(diamond.points, 50_000n);
  assert.equal(diamond.next, null);
  assert.equal(rankSummary(diamond).friendShare, 30);
});

/* ------------------------------------------------------------ the durable half */

async function chain(store, now) {
  const a = await ensureRewardAccount(store, A, now);
  const b = await ensureRewardAccount(store, B, now);
  await bindReferrer(store, { wallet: B, code: a.code, now });
  await bindReferrer(store, { wallet: C, code: b.code, now });
}

test("rules 2.0.0 begin at the first ask: earlier settlements keep 1.0.0, later ones use 2.0.0, and the moment never moves", async () => {
  const store = createMemoryGuardStore();
  const from = await rewardRulesEffectiveFrom(store, "2026-10-05T10:00:00.000Z");
  assert.equal(from, "2026-10-05T10:00:00.000Z");
  assert.equal(await rewardRulesEffectiveFrom(store, "2026-12-01T00:00:00.000Z"), from);
  assert.equal((await rewardRulesFor(store, "2026-10-05T09:59:59.000Z", "2026-12-01T00:00:00.000Z")).version, "1.0.0");
  assert.equal((await rewardRulesFor(store, "2026-10-05T10:00:00.000Z", "2026-12-01T00:00:00.000Z")).version, "2.0.0");

  await chain(store, "2026-10-01T00:00:00.000Z");
  const before = await recordOperationRewards(store, { fee: usdcFee({ gross: "5000000", received: "4000000", ref: "before" }), trader: C, settledAt: "2026-10-05T09:00:00.000Z", now: "2026-10-05T11:00:00.000Z", env: ENV });
  const after = await recordOperationRewards(store, { fee: usdcFee({ gross: "5000000", received: "4000000", ref: "after" }), trader: C, settledAt: "2026-10-05T11:00:00.000Z", now: "2026-10-05T11:00:00.000Z", env: ENV });
  assert.equal(before.state, "RECORDED");
  assert.equal(after.state, "RECORDED");
  const cashback = (await listRewardEntries(store, C)).filter((entry) => entry.type === "CASHBACK").map((entry) => [entry.source.operationRef, entry.usdMicros]).sort();
  assert.deepEqual(cashback, [["after", "2000000"], ["before", "2500000"]]);
});

test("the inviter's share follows the inviter's rank when the friend's trade settled", async () => {
  const store = createMemoryGuardStore();
  await rewardRulesEffectiveFrom(store, "2026-10-01T00:00:00.000Z");
  await chain(store, "2026-10-01T00:00:00.000Z");
  /* B's own trades: $1 000 received in the last 30 days — Gold. */
  const own = accrueRewards({ fee: usdcFee({ gross: "1000000000", received: "1000000000", ref: "b-own" }), trader: B, referrerL1: null, referrerL2: null,
    settledAt: "2026-10-03T00:00:00.000Z", now: "2026-10-03T00:00:00.000Z", price: null, rules: REWARD_RULES_V2 });
  await recordRewards(store, own.entries, own.ref);
  assert.equal((await readRankStanding(store, B, "2026-10-05T00:00:00.000Z")).rank, "GOLD");

  await recordOperationRewards(store, { fee: usdcFee({ gross: "10000000", received: "10000000", ref: "c-trade" }), trader: C, settledAt: "2026-10-05T00:00:00.000Z", now: "2026-10-05T00:00:00.000Z", env: ENV });
  const l1 = (await listRewardEntries(store, B)).find((entry) => entry.type === "REFERRAL_L1");
  assert.equal(l1.rateBps, 2000);
  assert.equal(l1.usdMicros, "2000000");
  assert.equal(l1.rules.rank, "GOLD");
  /* A is Bronze; the second level is 5 % whatever anyone's rank. */
  assert.equal((await listRewardEntries(store, A)).find((entry) => entry.type === "REFERRAL_L2").usdMicros, "500000");

  /* Thirty days later B's own trade has left the window; the friend's $10 is
     10 points: Bronze. */
  assert.equal((await readRankStanding(store, B, "2026-11-03T00:00:00.000Z")).rank, "BRONZE");
});

test("pricing a pending row later keeps the share frozen at the rank it was first written with", async () => {
  const store = createMemoryGuardStore();
  await rewardRulesEffectiveFrom(store, "2026-10-01T00:00:00.000Z");
  await chain(store, "2026-10-01T00:00:00.000Z");
  const own = accrueRewards({ fee: usdcFee({ gross: "200000000", received: "200000000", ref: "b-silver" }), trader: B, referrerL1: null, referrerL2: null,
    settledAt: "2026-10-03T00:00:00.000Z", now: "2026-10-03T00:00:00.000Z", price: null, rules: REWARD_RULES_V2 });
  await recordRewards(store, own.entries, own.ref);
  const fee = usdcFee({ gross: "5000000", received: "4000000", ref: "c-native" });
  const native = { ...fee, asset: "So11111111111111111111111111111111111111112", decimals: 9, settlement: { ...fee.settlement, asset: "So11111111111111111111111111111111111111112", decimals: 9 } };
  const input = { fee: native, trader: C, settledAt: "2026-10-05T00:00:00.000Z", now: "2026-10-05T00:00:00.000Z", env: ENV, deps: { readPrice: async () => null } };
  await recordOperationRewards(store, input);
  assert.equal((await listRewardEntries(store, B)).find((entry) => entry.type === "REFERRAL_L1").rateBps, 1500);

  /* B climbs to Gold before the price arrives. */
  const more = accrueRewards({ fee: usdcFee({ gross: "900000000", received: "900000000", ref: "b-gold" }), trader: B, referrerL1: null, referrerL2: null,
    settledAt: "2026-10-04T00:00:00.000Z", now: "2026-10-06T00:00:00.000Z", price: null, rules: REWARD_RULES_V2 });
  await recordRewards(store, more.entries, more.ref);
  const valued = await recordOperationRewards(store, { ...input, now: "2026-10-06T00:00:00.000Z", providerUsd: 2 });
  assert.equal(valued.state, "RECORDED");
  /* $2 paid, $1.60 received, Silver's 15 % = $0.24 — not Gold's 20 %. */
  const l1 = totalRewards((await listRewardEntries(store, B)).filter((entry) => entry.source?.operationRef === "c-native")).bySource.REFERRAL_L1;
  assert.equal(l1, 240_000n);
});

test("a launch that reached a DEX adds its points once per mint", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual(await recordLaunchGraduation(store, { creator: B, mint: "MintOne111", graduatedAt: "2026-10-05T00:00:00.000Z", now: "2026-10-05T00:00:01.000Z" }), { state: "RECORDED" });
  assert.deepEqual(await recordLaunchGraduation(store, { creator: B, mint: "MintOne111", graduatedAt: "2026-10-05T00:00:00.000Z" }), { state: "EXISTING" });
  assert.equal((await recordLaunchGraduation(store, { creator: B, mint: "MintTwo222", graduatedAt: "not a date" })).state, "SKIPPED");
  assert.equal((await listRankEvents(store, B)).length, 1);
  const standing = await readRankStanding(store, B, "2026-10-06T00:00:00.000Z");
  assert.equal(standing.fromLaunches, 250n);
  assert.equal(standing.rank, "SILVER");
});

test("only a production build starts rules 2.0.0; a preview reads the moment and computes by 1.0.0 until it exists", async () => {
  const store = createMemoryGuardStore();
  const preview = { VERCEL_ENV: "preview" };
  assert.equal(await rewardRulesEffectiveFrom(store, "2026-10-05T10:00:00.000Z", preview), null);
  assert.equal((await rewardRulesFor(store, "2026-10-05T11:00:00.000Z", "2026-10-05T11:00:00.000Z", preview)).version, "1.0.0");
  assert.equal(await rewardRulesEffectiveFrom(store, "2026-10-05T12:00:00.000Z", { VERCEL_ENV: "production", VERCEL_DEPLOYMENT_ID: "dpl_test" }), "2026-10-05T12:00:00.000Z");
  assert.equal((await store.collection("rewardRules").get("2.0.0")).setBy, "dpl_test");
  /* Once production wrote it, a preview reads the same moment. */
  assert.equal(await rewardRulesEffectiveFrom(store, "2026-12-01T00:00:00.000Z", preview), "2026-10-05T12:00:00.000Z");
});

test("one mint earns launch points once, whoever is named as its creator", async () => {
  const store = createMemoryGuardStore();
  assert.equal((await recordLaunchGraduation(store, { creator: B, mint: "MintShared1", graduatedAt: "2026-10-05T00:00:00.000Z" })).state, "RECORDED");
  assert.equal((await recordLaunchGraduation(store, { creator: A, mint: "MintShared1", graduatedAt: "2026-10-05T00:00:00.000Z" })).state, "EXISTING");
  assert.equal((await listRankEvents(store, A)).length, 0);
  assert.equal((await listRankEvents(store, B)).length, 1);
});

test("an inviter's rank that cannot be read leaves the whole accrual for its retry rather than freezing Bronze", async () => {
  const base = createMemoryGuardStore();
  await rewardRulesEffectiveFrom(base, "2026-10-01T00:00:00.000Z");
  await chain(base, "2026-10-01T00:00:00.000Z");
  let broken = true;
  const store = { ...base, collection(name) {
    const collection = base.collection(name);
    return name === "rankEvents" && broken ? { ...collection, async valuesWithPrefix() { throw new Error("injected read failure"); } } : collection;
  } };
  const input = { fee: usdcFee({ gross: "10000000", received: "10000000", ref: "retry-me" }), trader: C, settledAt: "2026-10-05T00:00:00.000Z", now: "2026-10-05T00:00:00.000Z", env: ENV };
  const first = await recordOperationRewards(store, input);
  assert.equal(first.state, "SKIPPED");
  assert.equal(first.retryable, true);
  assert.equal((await listRewardEntries(base, C)).length, 0);
  broken = false;
  assert.equal((await recordOperationRewards(store, input)).state, "RECORDED");
  assert.equal((await listRewardEntries(base, B)).find((entry) => entry.type === "REFERRAL_L1").rateBps, 1000);
});

test("a script on the shared store cannot start the rules; its own store or an explicit word can", async () => {
  const shared = { RYNTRA_GUARD_STORE: "postgres" };
  assert.equal(await rewardRulesEffectiveFrom(createMemoryGuardStore(), "2026-10-05T10:00:00.000Z", shared), null);
  assert.equal(await rewardRulesEffectiveFrom(createMemoryGuardStore(), "2026-10-05T10:00:00.000Z", { RYNTRA_GUARD_STORE: "file" }), "2026-10-05T10:00:00.000Z");
  assert.equal(await rewardRulesEffectiveFrom(createMemoryGuardStore(), "2026-10-05T10:00:00.000Z", { ...shared, RYNTRA_REWARDS_RULES_START: "1" }), "2026-10-05T10:00:00.000Z");
});
