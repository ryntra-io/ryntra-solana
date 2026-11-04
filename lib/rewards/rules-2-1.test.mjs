import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { actOnCase, raiseSignals, readSubjectEvents, recordDevice } from "../growth/review-store.ts";
import { walletSubject } from "../growth/review.ts";
import { signalHash } from "../growth/protect.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";
import { accrueRewards } from "./accrue.ts";
import { claimMinimumUsdMicros, rewardBalance } from "./balance.ts";
import { readGrowthBudget, spendGrowthBudget, GROWTH_BUDGET_MONTHLY_USD_MICROS } from "./budget.ts";
import { checkFirstTen, decideFirstTen, firstTenHeldUsdMicros, readFirstTen } from "./first-ten.ts";
import { bindReferrer, claimEntry, ensureRewardAccount, listRewardEntries, recordClaimEntry, totalRewards } from "./ledger.ts";
import { replayBenefitJobs } from "./benefit-replay.server.ts";
import { readRankStanding, rewardRulesEffectiveFrom, rewardRulesFor, rewardRulesV21EffectiveFrom, readRewardRulesInForce } from "./rank-store.ts";
import { recordOperationRewards } from "./record.server.ts";
import { maxPayoutBps, payoutCeilingBps, REWARD_RULES_V2, REWARD_RULES_V2_1 } from "./rules.ts";
import { rewardsView } from "./view.ts";
import { checkReferralPair } from "../growth/referral-guard-store.ts";

/** A friend the pair check found to be somebody else (Ryntra Partners R3): only then does its trade lift the inviter's rank. */
const clearPair = (store, inviter, trader, now) => checkReferralPair(store, { clusters: { check: async () => ({ verdict: "separate", rules: "protect-1.0.0" }) } }, { inviter, trader, now });

/*
 * Rules 2.1.0 — the decision of 2026-10-17:
 * 1. cashback and friends as in 2.0.0;
 * 2. «First $10 back» — all of the received fee back to a new wallet until $10 came back, 30 days at most, the
 *    first 100 new wallets of a month that pass the cluster check; nothing to the inviter; no rank points; 100 %;
 * 3. 30 % to the inviter for each friend's first 90 days, then by rank; the second level 5 %; 85 % at most;
 * 4. the claim floor — $0.25 with a USDC account, $1 without;
 * 5. the growth budget — $300 a month, stopped when spent, never a bonus or money for a place.
 */

const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const C = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const D = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ENV = { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T15:25:00Z" };
const V20_FROM = "2026-10-01T00:00:00.000Z";
const V21_FROM = "2026-10-18T00:00:00.000Z";
const KEY = new Uint8Array(32).fill(7);

const at = (days, hours = 1) => new Date(Date.parse(V21_FROM) + days * 86_400_000 + hours * 3_600_000).toISOString();
const usd = (dollars) => String(Math.round(dollars * 1_000_000));

/** A collected USDC fee that reached Ryntra whole: `received` dollars. */
function fee(ref, received) {
  const raw = usd(received);
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: USDC, symbol: "USDC", decimals: 6, amountRaw: raw, providerRetainedPercent: 0 });
  return settleServiceFee(quoted, {
    collected: true,
    amountRaw: raw,
    settlement: { operationRef: ref, userPaidRaw: raw, providerRaw: "0", ryntraRaw: raw, asset: USDC, symbol: "USDC", decimals: 6, basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED" },
  });
}

/** A fee in SOL with no price at settlement — written without dollars. */
function solFee(ref, raw) {
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, amountRaw: raw, providerRetainedPercent: 0 });
  return settleServiceFee(quoted, {
    collected: true,
    amountRaw: raw,
    settlement: { operationRef: ref, userPaidRaw: raw, providerRaw: "0", ryntraRaw: raw, asset: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED" },
  });
}

/** A store on which 2.0.0 began on 1 October and 2.1.0 on 18 October; A invited B, B invited C. */
async function world() {
  const store = createMemoryGuardStore();
  await rewardRulesEffectiveFrom(store, V20_FROM, ENV);
  assert.equal(await rewardRulesV21EffectiveFrom(store, V21_FROM, ENV), V21_FROM);
  const a = await ensureRewardAccount(store, A, V20_FROM);
  const b = await ensureRewardAccount(store, B, V20_FROM);
  await bindReferrer(store, { wallet: B, code: a.code, now: V20_FROM });
  await bindReferrer(store, { wallet: C, code: b.code, now: V20_FROM });
  return store;
}

const trade = (store, trader, ref, received, settledAt, extra = {}) =>
  recordOperationRewards(store, { fee: fee(ref, received), trader, settledAt, now: settledAt, env: ENV, ...extra });

const rows = async (store, wallet, filter = () => true) => (await listRewardEntries(store, wallet)).filter(filter);
const sum = (list) => list.reduce((total, entry) => total + BigInt(entry.usdMicros ?? "0"), 0n);
const balanceOf = async (store, wallet, minimum) =>
  rewardBalance({ entries: await listRewardEntries(store, wallet), reserve: { state: "FUNDED", usdMicros: 1_000_000_000n, treasury: A, observedAt: V21_FROM }, heldUsdMicros: 0n, minimumUsdMicros: minimum });

/** Lookups that find the wallet independent: a long life of its own, no transfers. */
const cleanDeps = { key: KEY, funding: async () => ({ state: "DEEP", funder: null, firstAt: "2026-01-01T00:00:00.000Z", lastAt: V21_FROM }), transfers: async () => ({ items: [], complete: true }) };

/* ----------------------------------------------------------------------------------------------- the version */

test("the shares are 2.0.0's, the inviter's window fits 85 %, and only «First $10 back» may return all of a fee", () => {
  assert.equal(REWARD_RULES_V2_1.cashbackBps, REWARD_RULES_V2.cashbackBps);
  assert.deepEqual(REWARD_RULES_V2_1.referralL1BpsByRank, REWARD_RULES_V2.referralL1BpsByRank);
  assert.equal(REWARD_RULES_V2_1.referralL2Bps, 500);
  assert.equal(maxPayoutBps(REWARD_RULES_V2_1), 8500);
  assert.equal(payoutCeilingBps(REWARD_RULES_V2_1), 8500);
  assert.equal(REWARD_RULES_V2_1.firstTen.capUsdMicros, 10_000_000n);
  assert.equal(REWARD_RULES_V2_1.firstTen.days, 30);
  assert.equal(REWARD_RULES_V2_1.firstTen.walletsPerMonth, 100);
  assert.deepEqual(REWARD_RULES_V2_1.inviterWindow, { bps: 3000, days: 90 });
});

test("2.1.0 begins at the first ask on or after the decision, after 2.0.0, and never reaches back", async () => {
  const store = createMemoryGuardStore();
  /* An ask before 17.10 starts 2.0.0 but not 2.1.0. */
  assert.equal(await rewardRulesV21EffectiveFrom(store, "2026-10-16T12:00:00.000Z", ENV), null);
  assert.equal((await rewardRulesFor(store, "2026-10-16T12:00:00.000Z", "2026-10-16T12:00:00.000Z", ENV)).version, "2.0.0");
  /* The first ask from 17.10 writes the moment once; it never moves. */
  assert.equal((await rewardRulesFor(store, "2026-10-18T09:00:00.000Z", "2026-10-18T10:00:00.000Z", ENV)).version, "2.0.0");
  assert.equal(await rewardRulesV21EffectiveFrom(store, "2026-12-01T00:00:00.000Z", ENV), "2026-10-18T10:00:00.000Z");
  assert.equal((await rewardRulesFor(store, "2026-10-18T10:00:00.000Z", "2026-12-01T00:00:00.000Z", ENV)).version, "2.1.0");
  /* A preview reads the moment and never writes it; the header's read writes nothing at all. */
  const preview = createMemoryGuardStore();
  await rewardRulesEffectiveFrom(preview, V20_FROM, ENV);
  assert.equal(await rewardRulesV21EffectiveFrom(preview, V21_FROM, { VERCEL_ENV: "preview" }), null);
  assert.equal((await readRewardRulesInForce(preview, V21_FROM)).version, "2.0.0");
  assert.equal((await preview.collection("rewardRules").get("2.1.0")) ?? null, null);
});

test("a trade before the moment keeps 2.0.0 and its shape, and is never recomputed; every row of 2.1.0 says it is paid from the fee", async () => {
  const store = await world();
  /* C traded under 2.0.0 the day before 2.1.0 began. */
  await trade(store, C, "before", 4, "2026-10-17T12:00:00.000Z");
  const before = await rows(store, C);
  assert.equal(before.length, 1);
  assert.equal(before[0].rules.version, "2.0.0");
  assert.equal(before[0].usdMicros, usd(2));
  assert.equal(before[0].fundedBy, undefined, "a row of 2.0.0 keeps the shape it always had");
  /* After it — C is not new (it traded before), so no window: ordinary 2.1.0 with the inviter's 90 days. */
  await trade(store, C, "after", 4, at(0));
  const after = await rows(store, C, (entry) => entry.source?.operationRef === "after");
  assert.deepEqual(after.map((entry) => [entry.rules.version, entry.usdMicros, entry.window ?? null, entry.fundedBy]), [["2.1.0", usd(2), null, "fee"]]);
  assert.deepEqual(await rows(store, C, (entry) => entry.source?.operationRef === "before"), before);
  assert.equal((await readFirstTen(store, C)).refused, "NOT_NEW");
  /* B's share of the later trade is the 90-day window's 30 %, from C's first trade on 17.10. */
  const l1 = (await rows(store, B)).find((entry) => entry.source?.operationRef === "after");
  assert.equal(l1.rateBps, 3000);
  assert.equal(l1.window, "INVITER_90");
  assert.equal(l1.usdMicros, usd(1.2));
});

/* ----------------------------------------------------------------------------------------------- First $10 back */

test("a new wallet gets all of the received fee back: half at once, the rest held for the check; its inviter gets a row of nothing", async () => {
  const store = await world();
  const outcome = await trade(store, C, "first", 4, at(0));
  assert.equal(outcome.state, "RECORDED");
  const mine = await rows(store, C);
  assert.deepEqual(mine.map((entry) => [entry.window, entry.usdMicros]).sort(), [["FIRST_TEN", usd(2)], ["FIRST_TEN_REST", usd(2)]]);
  const inviter = await rows(store, B);
  assert.deepEqual(inviter.map((entry) => [entry.type, entry.usdMicros, entry.window]), [["REFERRAL_L1", "0", "FIRST_TEN"]]);
  assert.equal((await rows(store, A)).length, 0, "no second level inside the window");
  const record = await readFirstTen(store, C);
  assert.equal(record.window.check, "PENDING");
  assert.equal(record.window.returnedUsdMicros, usd(4));
  assert.equal(record.window.endsAt, new Date(Date.parse(at(0)) + 30 * 86_400_000).toISOString());
  /* The rest is earned, pending — not claimable before the check. */
  const balance = await balanceOf(store, C, 250_000n);
  assert.equal(balance.availableUsdMicros, 2_000_000n);
  assert.equal(balance.checkUsdMicros, 2_000_000n);
  assert.equal(balance.pendingUsdMicros, 2_000_000n);
  assert.deepEqual(balance.pendingReasons, []);
  /* In the history the rest says it waits for the check. */
  const mineView = rewardsView({ entries: await listRewardEntries(store, C), reserve: { state: "EMPTY", usdMicros: 0n, treasury: A, observedAt: V21_FROM }, heldUsdMicros: 0n, referrals: { level1: 0, level2: 0 }, referral: null, claim: null, locale: "uk" });
  assert.deepEqual(mineView.rows.map((row) => row.detail).sort(), ["USDC", "USDC · після перевірки"]);
  /* The inviter's zero row is not a reward to list. */
  const view = rewardsView({ entries: inviter, reserve: { state: "EMPTY", usdMicros: 0n, treasury: A, observedAt: V21_FROM }, heldUsdMicros: 0n, referrals: { level1: 1, level2: 0 }, referral: null, claim: null, locale: "en" });
  assert.equal(view.rows.length, 0);
});

test("the window stops where $10 came back: the trade that reaches it is split, and the next is ordinary", async () => {
  const store = await world();
  await trade(store, C, "t1", 4, at(0));
  await trade(store, C, "t2", 4, at(1));
  /* $8 came back; of the third trade's $4 fee, $2 brings it to $10 — all of it back — and $2 is ordinary. */
  await trade(store, C, "t3", 4, at(2));
  const t3 = await rows(store, C, (entry) => entry.source?.operationRef === "t3");
  assert.deepEqual(t3.map((entry) => [entry.window, entry.usdMicros]).sort(), [["FIRST_TEN", usd(1)], ["FIRST_TEN_AFTER", usd(1)], ["FIRST_TEN_REST", usd(1)]]);
  assert.equal((await rows(store, B, (entry) => entry.source?.operationRef === "t3"))[0].usdMicros, usd(0.6));
  assert.equal((await rows(store, A, (entry) => entry.source?.operationRef === "t3"))[0].usdMicros, usd(0.1));
  assert.equal((await readFirstTen(store, C)).window.returnedUsdMicros, usd(10));
  /* Past the cap: 2.1.0 as usual — B's 30 % (C's first 90 days), A's 5 %. */
  await trade(store, C, "t4", 4, at(3));
  const t4 = await rows(store, C, (entry) => entry.source?.operationRef === "t4");
  assert.deepEqual(t4.map((entry) => [entry.window ?? null, entry.usdMicros]), [[null, usd(2)]]);
  assert.equal((await rows(store, B, (entry) => entry.source?.operationRef === "t4"))[0].usdMicros, usd(1.2));
  assert.equal((await rows(store, A, (entry) => entry.source?.operationRef === "t4"))[0].usdMicros, usd(0.2));
  /* What came back in the window: $10 exactly — the rest held is $5 of it. */
  assert.equal(sum(await rows(store, C, (entry) => entry.window === "FIRST_TEN" || entry.window === "FIRST_TEN_REST")), 10_000_000n);
  assert.equal(firstTenHeldUsdMicros(await listRewardEntries(store, C)), 5_000_000n);
});

test("a trade that passes the cap: the window takes only the room left, the rest of the fee pays as usual", async () => {
  const store = await world();
  await trade(store, C, "big", 8, at(0));
  /* $8 came back. A $3 fee: $2 of it inside the window (all back), $1 ordinary — $0.50 back, B 30 %, A 5 %. */
  await trade(store, C, "edge", 3, at(1));
  const edge = await rows(store, C, (entry) => entry.source?.operationRef === "edge");
  assert.deepEqual(edge.map((entry) => [entry.window, entry.usdMicros]).sort(), [["FIRST_TEN", usd(1)], ["FIRST_TEN_AFTER", usd(0.5)], ["FIRST_TEN_REST", usd(1)]]);
  assert.equal((await rows(store, B, (entry) => entry.source?.operationRef === "edge"))[0].usdMicros, usd(0.3));
  assert.equal((await readFirstTen(store, C)).window.returnedUsdMicros, usd(10));
});

test("a whale's first trade: $10 of its fee comes back whole, the rest pays the inviters and earns points as any trade", async () => {
  const store = await world();
  await trade(store, C, "whale", 25, at(0));
  const mine = await rows(store, C);
  assert.deepEqual(mine.map((entry) => [entry.window, entry.usdMicros]).sort(), [["FIRST_TEN", usd(5)], ["FIRST_TEN_AFTER", usd(7.5)], ["FIRST_TEN_REST", usd(5)]]);
  assert.equal(sum(await rows(store, B)), 4_500_000n, "30 % of the $15 past the window");
  assert.equal(sum(await rows(store, A)), 750_000n, "5 % of it");
  assert.equal((await readRankStanding(store, C, at(1))).fromTrades, 15n);
  await clearPair(store, B, C, at(0, 1));
  assert.equal((await readRankStanding(store, B, at(1))).fromFriends, 15n);
  /* Everything paid: $10 back in the window plus 85 % of the other $15 — never more than was received. */
  assert.equal(sum([...mine, ...(await rows(store, B)), ...(await rows(store, A))]), 10_000_000n + 12_750_000n);
  assert.equal((await readFirstTen(store, C)).window.returnedUsdMicros, usd(10));
});

test("thirty days after the first trade the window is over, though $10 has not come back", async () => {
  const store = await world();
  await trade(store, C, "early", 1, at(0));
  await trade(store, C, "late", 4, at(30, 2));
  const late = await rows(store, C, (entry) => entry.source?.operationRef === "late");
  assert.deepEqual(late.map((entry) => [entry.window ?? null, entry.usdMicros]), [[null, usd(2)]]);
  assert.equal((await rows(store, B, (entry) => entry.source?.operationRef === "late"))[0].rateBps, 3000);
});

test("the same trade read again writes nothing twice — the rows, the rest and what came back", async () => {
  const store = await world();
  for (let round = 0; round < 3; round += 1) await trade(store, C, "again", 4, at(0));
  assert.equal((await rows(store, C)).length, 2);
  assert.equal((await rows(store, B)).length, 1);
  assert.equal((await readFirstTen(store, C)).window.returnedUsdMicros, usd(4));
});

test("a fee with no price inside the window is written whole, without dollars; priced later, it is split at the cap like any trade", async () => {
  const store = await world();
  /* $8 came back first. */
  await trade(store, C, "w8", 8, at(0));
  const input = { fee: solFee("sol-1", "20000000"), trader: C, settledAt: at(0, 2), now: at(0, 2), env: ENV, deps: { readPrice: async () => null } };
  await recordOperationRewards(store, input);
  const first = await rows(store, C, (entry) => entry.source?.operationRef === "sol-1");
  assert.deepEqual(first.map((entry) => [entry.window, entry.usdMicros]).sort(), [["FIRST_TEN", null], ["FIRST_TEN_REST", null]]);
  /* Priced later at $3: $2 of it reaches the cap and comes back whole, $1 is ordinary — $0.50 back, B 30 %, A 5 %. */
  await recordOperationRewards(store, { ...input, now: at(0, 4), providerUsd: 3 });
  const entries = await listRewardEntries(store, C);
  const totals = totalRewards(entries);
  assert.equal(totals.unvaluedCount, 0);
  assert.equal(totals.entitledUsdMicros, 8_000_000n + 2_500_000n);
  assert.equal((await readFirstTen(store, C)).window.returnedUsdMicros, usd(10));
  assert.equal(firstTenHeldUsdMicros(entries), 5_000_000n, "the rest of both trades waits for the check");
  assert.deepEqual((await rows(store, B, (entry) => entry.source?.operationRef === "sol-1")).map((entry) => [entry.window, entry.usdMicros]).sort(), [["FIRST_TEN", "0"], ["FIRST_TEN_AFTER", usd(0.3)]]);
  assert.deepEqual((await rows(store, A, (entry) => entry.source?.operationRef === "sol-1")).map((entry) => [entry.window, entry.usdMicros]), [["FIRST_TEN_AFTER", usd(0.05)]]);
  assert.equal((await readFirstTen(store, C)).window.returnedUsdMicros, usd(10));
  /* A second pricing writes nothing more. */
  await recordOperationRewards(store, { ...input, now: at(0, 5), providerUsd: 3 });
  assert.equal(totalRewards(await listRewardEntries(store, C)).entitledUsdMicros, 10_500_000n);
});

test("the window's fee earns no rank points — the trader's nor the inviter's — and the trade still counts as a friend's", async () => {
  const store = await world();
  await trade(store, C, "pts", 9, at(0));
  const trader = await readRankStanding(store, C, at(1));
  assert.equal(trader.points, 0n);
  const inviter = await readRankStanding(store, B, at(1));
  assert.equal(inviter.points, 0n);
  /* Past the window — the $5 of the next fee beyond its $1 of room, and after: points again. */
  await trade(store, C, "pts-2", 6, at(2));
  await trade(store, C, "pts-3", 200, at(3));
  assert.equal((await readRankStanding(store, C, at(4))).fromTrades, 205n);
  await clearPair(store, B, C, at(3, 1));
  assert.equal((await readRankStanding(store, B, at(4))).fromFriends, 205n);
  /* The zero row is a friend's trade for boards and badges. */
  assert.ok((await rows(store, B)).some((entry) => entry.type === "REFERRAL_L1" && entry.window === "FIRST_TEN" && entry.source.trader === C));
});

/* ----------------------------------------------------------------------------------------------- the 100 places */

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const wallet = (n) => {
  let out = "";
  let value = n + 1;
  while (value > 0) {
    out = BASE58[value % 58] + out;
    value = Math.floor(value / 58);
  }
  return `Nw${out}`.padEnd(44, "z");
};

test("only the first 100 new wallets of a month hold the window; the 101st trades by the ordinary rules; the next month has room again", async () => {
  const store = await world();
  for (let n = 0; n < 100; n += 1) await trade(store, wallet(n), `m-${n}`, 1, at(0, 1 + (n % 20)));
  const month = await store.versioned("rewardWelcomeMonths").get("2026-10");
  assert.equal(month.wallets.length, 100);
  const late = wallet(100);
  await trade(store, late, "m-100", 2, at(1));
  assert.equal((await readFirstTen(store, late)).refused, "MONTH_FULL");
  assert.deepEqual((await rows(store, late)).map((entry) => [entry.window ?? null, entry.usdMicros]), [[null, usd(1)]]);
  /* A refused check frees a place: the wallet that found the month full takes it on its next trade. */
  assert.equal(await decideFirstTen(store, { wallet: wallet(7), check: "FAILED", now: at(1, 5) }), true);
  await trade(store, late, "m-100b", 2, at(1, 6));
  const taken = await readFirstTen(store, late);
  assert.equal(taken.refused, null);
  assert.equal(taken.window.endsAt, new Date(Date.parse(at(1)) + 30 * 86_400_000).toISOString(), "30 days from its first trade, not from the place");
  assert.deepEqual((await rows(store, late, (entry) => entry.source?.operationRef === "m-100b")).map((entry) => entry.window).sort(), ["FIRST_TEN", "FIRST_TEN_REST"]);
  await trade(store, wallet(101), "m-101", 2, at(1, 7));
  assert.equal((await readFirstTen(store, wallet(101))).refused, "MONTH_FULL");
  /* November starts empty. */
  const november = wallet(102);
  await trade(store, november, "m-102", 2, "2026-11-02T00:00:00.000Z");
  assert.equal((await readFirstTen(store, november)).window.month, "2026-11");
});

/* ----------------------------------------------------------------------------------------------- the check */

test("a wallet that passes the check can claim the rest, and later window trades are free at once", async () => {
  const store = await world();
  await trade(store, C, "c-1", 4, at(0));
  const passed = await checkFirstTen(store, C, cleanDeps, at(0, 2));
  assert.equal(passed.state, "DECIDED");
  assert.equal(passed.check, "PASSED");
  assert.equal((await balanceOf(store, C, 250_000n)).availableUsdMicros, 4_000_000n);
  /* A later window trade's rest is free at once. */
  await trade(store, C, "c-2", 2, at(1));
  assert.equal((await balanceOf(store, C, 250_000n)).availableUsdMicros, 6_000_000n);

});

test("a wallet that shares its inviter's funder goes to a person; cancelled, its rest goes back, nobody is paid for the window, and an appeal that wins gives it back", async () => {
  /* D, a new wallet B invited, shares B's funder: S1 — a case for a person, not a verdict. */
  const store = await world();
  const b = await ensureRewardAccount(store, B, V20_FROM);
  await bindReferrer(store, { wallet: D, code: b.code, now: V20_FROM });
  await trade(store, D, "d-1", 4, at(2));
  const shared = "So1Funder111111111111111111111111111111111";
  const linked = {
    key: KEY,
    funding: async (address) => (address === D || address === B ? { state: "FOUND", funder: shared, firstAt: "2026-09-01T00:00:00.000Z", lastAt: at(2) } : { state: "DEEP", funder: null, firstAt: "2025-01-01T00:00:00.000Z", lastAt: at(2) }),
    transfers: async () => ({ items: [], complete: true }),
  };
  const waiting = await checkFirstTen(store, D, linked, at(2, 3));
  assert.equal(waiting.state, "WAITING");
  assert.equal(waiting.review, true);
  const log = await readSubjectEvents(store, walletSubject(D));
  assert.deepEqual(log.events.map((event) => [event.kind, event.signals]), [["OPENED", ["S1_SHARED_FUNDING"]]]);
  assert.equal(firstTenHeldUsdMicros(await listRewardEntries(store, D)), 2_000_000n, "the rest waits for the person");
  /* The reviewer cancels: one person's wallets. */
  assert.equal((await actOnCase(store, { subject: walletSubject(D), action: { kind: "DECIDE", decision: "CANCEL", note: "One person's wallets", seen: 0 }, by: "reviewer", now: at(2, 5) })).ok, true);
  const failed = await checkFirstTen(store, D, linked, at(2, 6));
  assert.equal(failed.check, "FAILED");
  /* Nobody is paid for the window's trade: a share to the inviter would pay the same person. No points either. */
  assert.deepEqual((await rows(store, B, (entry) => entry.source?.operationRef === "d-1")).map((entry) => [entry.usdMicros, entry.window]), [["0", "FIRST_TEN"]]);
  assert.equal((await rows(store, A, (entry) => entry.source?.operationRef === "d-1")).length, 0);
  assert.equal((await readRankStanding(store, D, at(3))).fromTrades, 0n);
  const balance = await balanceOf(store, D, 250_000n);
  assert.equal(balance.availableUsdMicros, 2_000_000n, "the half stays on the ledger — the stop of payouts is the queue's");
  assert.equal(balance.checkUsdMicros, 0n);
  assert.equal(totalRewards(await listRewardEntries(store, D)).bySource.CASHBACK, 2_000_000n);
  assert.ok(!(await store.versioned("rewardWelcomeMonths").get("2026-10")).wallets.includes(D));
  /* Decided once: a second run changes nothing. */
  assert.equal((await checkFirstTen(store, D, cleanDeps, at(4))).state, "FAILED");
  /* The person appeals, the reviewer clears: the window is given back — the rest, the place. */
  assert.equal((await actOnCase(store, { subject: walletSubject(D), action: { kind: "APPEAL", note: "These are my own savings" }, by: "person", now: at(5) })).ok, true);
  const seen = (await readSubjectEvents(store, walletSubject(D))).events.at(-1).seq;
  assert.equal((await actOnCase(store, { subject: walletSubject(D), action: { kind: "DECIDE", decision: "CLEAR", note: "Shared exchange address", seen }, by: "reviewer", now: at(5, 2) })).ok, true);
  const back = await checkFirstTen(store, D, null, at(5, 3));
  assert.equal(back.check, "PASSED");
  const after = await balanceOf(store, D, 250_000n);
  assert.equal(after.availableUsdMicros, 4_000_000n);
  assert.equal(totalRewards(await listRewardEntries(store, D)).bySource.CASHBACK, 4_000_000n);
  assert.ok((await store.versioned("rewardWelcomeMonths").get("2026-10")).wallets.includes(D));
  assert.deepEqual((await rows(store, D, (entry) => entry.type === "ADJUSTMENT")).map((entry) => entry.window).sort(), ["FIRST_TEN_PASSED", "FIRST_TEN_REINSTATED", "FIRST_TEN_VOID"]);
});

test("a rest priced while the window was cancelled is taken back on its own row, and an appeal that wins gives back all of it", async () => {
  const store = await world();
  const input = { fee: solFee("late-1", "20000000"), trader: C, settledAt: at(0), now: at(0), env: ENV, deps: { readPrice: async () => null } };
  await recordOperationRewards(store, input);
  await raiseSignals(store, { subject: walletSubject(C), codes: ["S1_SHARED_FUNDING"], now: at(0, 1) });
  await actOnCase(store, { subject: walletSubject(C), action: { kind: "DECIDE", decision: "CANCEL", note: "One person's wallets", seen: 0 }, by: "reviewer", now: at(0, 2) });
  assert.equal((await checkFirstTen(store, C, null, at(0, 3))).check, "FAILED");
  /* Priced now ($4): the half is the trader's; the rest is written and taken back at once. */
  await recordOperationRewards(store, { ...input, now: at(0, 4), providerUsd: 4 });
  assert.equal(totalRewards(await listRewardEntries(store, C)).entitledUsdMicros, 2_000_000n);
  assert.equal((await readFirstTen(store, C)).window.restUsdMicros, usd(2));
  /* The appeal wins: all of it comes back. */
  await actOnCase(store, { subject: walletSubject(C), action: { kind: "APPEAL", note: "My own wallet" }, by: "person", now: at(1) });
  const seen = (await readSubjectEvents(store, walletSubject(C))).events.at(-1).seq;
  await actOnCase(store, { subject: walletSubject(C), action: { kind: "DECIDE", decision: "CLEAR", note: "Cleared", seen }, by: "reviewer", now: at(1, 1) });
  assert.equal((await checkFirstTen(store, C, null, at(1, 2))).check, "PASSED");
  const balance = await balanceOf(store, C, 250_000n);
  assert.equal(balance.availableUsdMicros, 4_000_000n);
  assert.equal(totalRewards(await listRewardEntries(store, C)).bySource.CASHBACK, 4_000_000n);
});

test("after a cancellation the inviter earns the rank's share, not the 90 days'", async () => {
  const store = await world();
  await trade(store, C, "x-1", 4, at(0));
  await raiseSignals(store, { subject: walletSubject(C), codes: ["S2_DIRECT_FUNDS"], now: at(0, 1) });
  await actOnCase(store, { subject: walletSubject(C), action: { kind: "DECIDE", decision: "CANCEL", note: "Self-referral", seen: 0 }, by: "reviewer", now: at(0, 2) });
  await checkFirstTen(store, C, null, at(0, 3));
  await trade(store, C, "x-2", 4, at(1));
  const l1 = (await rows(store, B, (entry) => entry.source?.operationRef === "x-2"))[0];
  assert.equal(l1.rateBps, 1000);
  assert.equal(l1.window, undefined);
});

test("an appeal that wins after the month filled gives back what was earned, and keeps the month at a hundred", async () => {
  const store = await world();
  for (let n = 0; n < 100; n += 1) await trade(store, wallet(n), `f-${n}`, 4, at(0, 1 + (n % 20)));
  const first = wallet(0);
  await raiseSignals(store, { subject: walletSubject(first), codes: ["S1_SHARED_FUNDING"], now: at(0, 21) });
  await actOnCase(store, { subject: walletSubject(first), action: { kind: "DECIDE", decision: "CANCEL", note: "Cluster", seen: 0 }, by: "reviewer", now: at(0, 22) });
  assert.equal((await checkFirstTen(store, first, null, at(0, 23))).check, "FAILED");
  /* Its place goes to a wallet that waited. */
  await trade(store, wallet(100), "f-100", 2, at(1));
  assert.ok((await readFirstTen(store, wallet(100))).window);
  await actOnCase(store, { subject: walletSubject(first), action: { kind: "APPEAL", note: "Mine" }, by: "person", now: at(2) });
  const seen = (await readSubjectEvents(store, walletSubject(first))).events.at(-1).seq;
  await actOnCase(store, { subject: walletSubject(first), action: { kind: "DECIDE", decision: "CLEAR", note: "Cleared", seen }, by: "reviewer", now: at(2, 1) });
  assert.equal((await checkFirstTen(store, first, null, at(2, 2))).check, "PASSED");
  assert.equal((await store.versioned("rewardWelcomeMonths").get("2026-10")).wallets.length, 100);
  assert.equal((await balanceOf(store, first, 250_000n)).availableUsdMicros, 4_000_000n, "what it earned comes back");
  /* The window does not reopen for its next trades. */
  await trade(store, first, "f-0b", 4, at(3));
  assert.deepEqual((await rows(store, first, (entry) => entry.source?.operationRef === "f-0b")).map((entry) => entry.window ?? null), [null]);
});

test("a fee worth dust, priced late, is valued — never left pending", async () => {
  const store = await world();
  const input = { fee: solFee("dust", "20000000"), trader: C, settledAt: at(0), now: at(0), env: ENV, deps: { readPrice: async () => null } };
  await recordOperationRewards(store, input);
  const priced = await recordOperationRewards(store, { ...input, now: at(0, 1), providerUsd: 0.000001 });
  assert.equal(priced.state, "RECORDED");
  assert.equal(totalRewards(await listRewardEntries(store, C)).unvaluedCount, 0);
});

test("a decision made before the wallet's first trade is no verdict on its window", async () => {
  const store = await world();
  /* A freeze lifted and cleared on C long before — another matter. */
  await actOnCase(store, { subject: walletSubject(C), action: { kind: "FREEZE", note: "Old matter" }, by: "reviewer", now: "2026-10-02T00:00:00.000Z" });
  const seen = (await readSubjectEvents(store, walletSubject(C))).events.at(-1).seq;
  await actOnCase(store, { subject: walletSubject(C), action: { kind: "DECIDE", decision: "CLEAR", note: "Old matter closed", seen }, by: "reviewer", now: "2026-10-03T00:00:00.000Z" });
  await actOnCase(store, { subject: walletSubject(C), action: { kind: "UNFREEZE", note: "Old matter closed" }, by: "reviewer", now: "2026-10-03T00:00:01.000Z" });
  await trade(store, C, "old-clear", 4, at(0));
  assert.equal((await checkFirstTen(store, C, null, at(0, 2))).state, "WAITING");
  assert.equal((await readFirstTen(store, C)).window.check, "PENDING");
});

test("a person who clears the case lets the rest go", async () => {
  const store = await world();
  await trade(store, C, "cl-1", 4, at(0));
  const crowded = async () => {
    for (const other of [C, A, D]) await recordDevice(store, { wallet: other, signals: [{ kind: "device", hash: signalHash(KEY, "device", "family-tablet") }], now: at(0) });
  };
  await crowded();
  assert.equal((await checkFirstTen(store, C, cleanDeps, at(0, 2))).review, true);
  assert.equal((await actOnCase(store, { subject: walletSubject(C), action: { kind: "DECIDE", decision: "CLEAR", note: "A family's tablet", seen: 0 }, by: "reviewer", now: at(0, 3) })).ok, true);
  const passed = await checkFirstTen(store, C, cleanDeps, at(0, 4));
  assert.equal(passed.check, "PASSED");
  assert.equal(firstTenHeldUsdMicros(await listRewardEntries(store, C)), 0n);
});

test("a check that cannot finish asks a person after three days, rather than waiting for ever", async () => {
  const store = await world();
  await trade(store, C, "st-1", 4, at(0));
  assert.equal((await checkFirstTen(store, C, null, at(1))).review, undefined);
  const late = await checkFirstTen(store, C, null, at(3, 2));
  assert.equal(late.state, "WAITING");
  assert.equal(late.review, true);
  assert.deepEqual((await readSubjectEvents(store, walletSubject(C))).events.map((event) => event.signals), [["UNVERIFIED"]]);
});

test("the check waits rather than guesses: no key, an unread funding or a review hold decide nothing", async () => {
  const store = await world();
  await trade(store, C, "w-1", 4, at(0));
  assert.equal((await checkFirstTen(store, C, null, at(0, 2))).state, "WAITING");
  const unread = { ...cleanDeps, funding: async () => ({ state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null }) };
  assert.equal((await checkFirstTen(store, C, unread, at(0, 2))).state, "WAITING");
  const noTransfers = { ...cleanDeps, transfers: async () => null };
  assert.equal((await checkFirstTen(store, C, noTransfers, at(0, 2))).state, "WAITING");
  assert.equal((await readFirstTen(store, C)).window.check, "PENDING");
  assert.equal(firstTenHeldUsdMicros(await listRewardEntries(store, C)), 2_000_000n);
});

test("money between the wallet and its inviter, a crowded device or a shared one send the wallet to a person", async () => {
  for (const [label, setup, deps] of [
    ["S2 — a transfer from the inviter", async () => undefined, { ...cleanDeps, transfers: async () => ({ items: [{ counterparty: B, direction: "in", at: at(0) }], complete: true }) }],
    ["S4 — a device with three wallets", async (store) => {
      for (const other of [C, A, D]) await recordDevice(store, { wallet: other, signals: [{ kind: "device", hash: signalHash(KEY, "device", "phone") }], now: at(0) });
    }, cleanDeps],
    ["S4 — the inviter's device", async (store) => {
      for (const other of [C, B]) await recordDevice(store, { wallet: other, signals: [{ kind: "device", hash: signalHash(KEY, "device", "laptop") }], now: at(0) });
    }, cleanDeps],
  ]) {
    const store = await world();
    await trade(store, C, "s-1", 4, at(0));
    await setup(store);
    const outcome = await checkFirstTen(store, C, deps, at(0, 3));
    assert.equal(outcome.review, true, label);
    assert.equal((await readSubjectEvents(store, walletSubject(C))).events.length, 1, label);
    assert.equal((await readFirstTen(store, C)).window.check, "PENDING", label);
  }
});

test("the bookkeeping queue runs the check until it decides", async () => {
  const store = await world();
  await trade(store, C, "q-1", 4, at(0));
  assert.equal((await store.collection("benefitJobs").valuesWithPrefix(`${C}:FIRST_TEN_CHECK:`)).length, 1);
  await replayBenefitJobs(store, { wallet: C, now: at(0, 2), firstTen: null });
  assert.equal((await readFirstTen(store, C)).window.check, "PENDING");
  assert.equal((await store.collection("benefitJobs").valuesWithPrefix(`${C}:FIRST_TEN_CHECK:`)).length, 1, "waiting keeps the job");
  await replayBenefitJobs(store, { wallet: C, now: at(0, 4), firstTen: cleanDeps });
  assert.equal((await readFirstTen(store, C)).window.check, "PASSED");
  assert.equal((await store.collection("benefitJobs").valuesWithPrefix(`${C}:FIRST_TEN_CHECK:`)).length, 0);
});

test("a lost queue write is mended by the next window trade, and the page leaves the check to the schedule", async () => {
  const store = await world();
  await trade(store, C, "lq-1", 1, at(0));
  await store.collection("benefitJobs").delete(`${C}:FIRST_TEN_CHECK:first-ten`);
  await trade(store, C, "lq-2", 1, at(0, 2));
  assert.equal((await store.collection("benefitJobs").valuesWithPrefix(`${C}:FIRST_TEN_CHECK:`)).length, 1);
  await replayBenefitJobs(store, { wallet: C, now: at(0, 4), firstTen: cleanDeps, exclude: ["FIRST_TEN_CHECK"] });
  assert.equal((await readFirstTen(store, C)).window.check, "PENDING");
});

/* ----------------------------------------------------------------------------------------------- the inviter's 90 days */

test("the inviter gets 30 % of a friend's trades for 90 days from the friend's first trade, then the share of their rank", async () => {
  const store = await world();
  /* C, an older wallet, first traded on 17.10 (before 2.1.0) — no window, the 90 days run from then. */
  await trade(store, C, "old", 2, "2026-10-17T00:30:00.000Z");
  await trade(store, C, "day-40", 10, at(40));
  const l1 = (ref) => rows(store, B, (entry) => entry.source?.operationRef === ref).then((list) => list[0]);
  assert.equal((await l1("day-40")).rateBps, 3000);
  assert.equal((await l1("day-40")).usdMicros, usd(3));
  /* 50 + 30 + 5 — the ceiling of 85 % exactly. */
  const paid = sum(await rows(store, C, (entry) => entry.source?.operationRef === "day-40")) + BigInt((await l1("day-40")).usdMicros)
    + sum(await rows(store, A, (entry) => entry.source?.operationRef === "day-40"));
  assert.equal(paid, 8_500_000n);
  /* Day 90 from 17.10: back to B's rank — Bronze, 10 %. */
  await trade(store, C, "day-91", 10, at(90));
  assert.equal((await l1("day-91")).rateBps, 1000);
  assert.equal((await l1("day-91")).window, undefined);
});

test("in the window the inviter's share is 30 % whatever the rank; past it, the rank's — Gold's 20 %", async () => {
  const store = await world();
  /* B's own trades make it Gold: $100 received over the last 30 days — the ladder of 2.2.0, in force by then
     (B is not new — a trade under 2.0.0). */
  await trade(store, B, "b-gold-0", 2, "2026-10-17T06:00:00.000Z");
  await trade(store, B, "b-gold", 100, at(80));
  await trade(store, C, "c-old", 2, "2026-10-17T00:30:00.000Z");
  await trade(store, C, "c-85", 10, at(85));
  await trade(store, C, "c-95", 10, at(95));
  const l1 = async (ref) => (await rows(store, B, (entry) => entry.source?.operationRef === ref))[0];
  assert.equal((await l1("c-85")).rateBps, 3000);
  assert.equal((await l1("c-85")).rules.rank, "GOLD");
  assert.equal((await l1("c-95")).rateBps, 2000);
});

test("accrual itself refuses a layout past its ceiling: 85 % outside the window, all of it inside", () => {
  const received = fee("ceil", 10);
  const base = { fee: received, trader: C, referrerL1: B, referrerL2: A, settledAt: at(0), now: at(0), price: null, referrerL1Rank: "BRONZE" };
  const window = accrueRewards({ ...base, rules: REWARD_RULES_V2_1, window: { firstTen: { remainingUsdMicros: 10_000_000n } } });
  assert.equal(sum(window.entries), 10_000_000n);
  const ordinary = accrueRewards({ ...base, rules: REWARD_RULES_V2_1, window: { inviter: true } });
  assert.equal(sum(ordinary.entries), 8_500_000n);
  /* A rules object that would pay 95 % is refused on the figures. */
  const greedy = accrueRewards({ ...base, rules: { ...REWARD_RULES_V2_1, inviterWindow: { bps: 4000, days: 90 } }, window: { inviter: true } });
  assert.equal(greedy.ok, false);
});

/* ----------------------------------------------------------------------------------------------- the claim floor */

test("the claim floor is $0.25 with a USDC account and $1 without or unread — and $1 under the earlier rules", async () => {
  assert.equal(claimMinimumUsdMicros(REWARD_RULES_V2_1, "EXISTS"), 250_000n);
  assert.equal(claimMinimumUsdMicros(REWARD_RULES_V2_1, "MISSING"), 1_000_000n);
  assert.equal(claimMinimumUsdMicros(REWARD_RULES_V2_1, "UNKNOWN"), 1_000_000n);
  assert.equal(claimMinimumUsdMicros(REWARD_RULES_V2, "EXISTS"), 1_000_000n);
  assert.equal(claimMinimumUsdMicros(null, "EXISTS"), 1_000_000n);
  const store = await world();
  await trade(store, C, "old", 0.6, "2026-10-17T00:30:00.000Z");
  const withAccount = await balanceOf(store, C, 250_000n);
  assert.equal(withAccount.claimable, true);
  assert.equal(withAccount.availableUsdMicros, 300_000n);
  const without = await balanceOf(store, C, 1_000_000n);
  assert.equal(without.claimable, false);
  assert.equal(without.claimBlockedReason, "Claim available from $1.00");
  /* A caller that names no floor is held to the dollar. */
  const unnamed = rewardBalance({ entries: await listRewardEntries(store, C), reserve: { state: "FUNDED", usdMicros: 10_000_000n, treasury: A, observedAt: V21_FROM }, heldUsdMicros: 0n, locale: "uk" });
  assert.equal(unnamed.claimable, false);
  assert.equal(unnamed.claimBlockedReason, "Отримати можна від $1.00");
});

/* ----------------------------------------------------------------------------------------------- the growth budget */

test("the growth budget spends up to $300 a month, stops when spent, never goes below zero, and starts again next month", async () => {
  const store = createMemoryGuardStore();
  const spend = (ref, dollars, when = "2026-10-20T10:00:00.000Z", purpose = "SEASON_PRIZE") =>
    spendGrowthBudget(store, { ref, purpose, usdMicros: BigInt(usd(dollars)), wallet: C, note: "Season 1 prize", approvedBy: "approver", at: when });
  assert.equal(GROWTH_BUDGET_MONTHLY_USD_MICROS, 300_000_000n);
  assert.equal((await spend("p1", 200)).state, "SPENT");
  const second = await spend("p2", 100);
  assert.equal(second.state, "SPENT");
  assert.equal(second.leftUsdMicros, 0n);
  const stopped = await spend("p3", 0.01);
  assert.deepEqual(stopped, { state: "STOPPED", leftUsdMicros: 0n });
  /* The same line again writes nothing. */
  assert.equal((await spend("p1", 200)).state, "EXISTING");
  /* November has its own $300. */
  assert.equal((await spend("n1", 300, "2026-11-01T00:00:00.000Z")).state, "SPENT");
  const october = await readGrowthBudget(store, "2026-10");
  assert.equal(october.spentUsdMicros, 300_000_000n);
  assert.equal(october.leftUsdMicros, 0n);
  assert.equal(october.lines.length, 2);
  assert.equal(october.reconciled, true);
  assert.ok(october.lines.every((line) => line.fundedBy === "budget"));
});

test("the growth budget never pays a bonus or money for a place, and two spends at once cannot both take the last dollars", async () => {
  const store = createMemoryGuardStore();
  for (const purpose of ["BONUS", "FIRST_TRADE_BONUS", "LEADERBOARD_PLACE"]) {
    const refused = await spendGrowthBudget(store, { ref: `x-${purpose}`, purpose, usdMicros: 1_000_000n, note: "no", approvedBy: "approver", at: "2026-10-20T00:00:00.000Z" });
    assert.equal(refused.state, "REFUSED");
  }
  await spendGrowthBudget(store, { ref: "a", purpose: "AMBASSADOR_WORK", usdMicros: 250_000_000n, note: "Videos", approvedBy: "approver", at: "2026-10-20T00:00:00.000Z" });
  const race = await Promise.all(["r1", "r2", "r3"].map((ref) => spendGrowthBudget(store, { ref, purpose: "SEASON_PRIZE", usdMicros: 30_000_000n, note: "Prize", approvedBy: "approver", at: "2026-10-21T00:00:00.000Z" })));
  assert.equal(race.filter((outcome) => outcome.state === "SPENT").length, 1);
  const read = await readGrowthBudget(store, "2026-10");
  assert.equal(read.spentUsdMicros, 280_000_000n);
  assert.equal(read.reconciled, true);
});

/* ----------------------------------------------------------------------------------------------- reconciliation */

test("everything a wallet is owed is the sum of its rows — accruals, the window's rows, the refusal and the claims", async () => {
  const store = await world();
  await trade(store, C, "r-1", 4, at(0));
  await trade(store, C, "r-2", 3, at(1));
  await decideFirstTen(store, { wallet: C, check: "FAILED", now: at(1, 2) });
  await trade(store, C, "r-3", 5, at(2));
  await recordClaimEntry(store, claimEntry({ wallet: C, claimId: "claim-1", usdMicros: 1_000_000n, signature: "sig-1", now: at(3) }));
  const entries = await listRewardEntries(store, C);
  const totals = totalRewards(entries);
  /* $2 + $1.50 halves, the $3.50 rest taken back, $2.50 of the ordinary trade, $1 claimed. */
  assert.equal(totals.entitledUsdMicros, sum(entries));
  assert.equal(totals.entitledUsdMicros, 5_000_000n);
  assert.equal(totals.lifetimeUsdMicros - totals.claimedUsdMicros, totals.entitledUsdMicros);
  assert.equal(totals.bySource.CASHBACK, 6_000_000n);
  /* Across every wallet, after the cancellation: the window's trades paid their ordinary half and nothing else, the
     ordinary trade 50 + 10 (the rank's share — the 90 days end with a cancellation) + 5 = 65 %. */
  const all = [...entries, ...(await listRewardEntries(store, B)), ...(await listRewardEntries(store, A))].filter((entry) => entry.type !== "CLAIM");
  const received = 4_000_000n + 3_000_000n + 5_000_000n;
  assert.equal(sum(all), ((4_000_000n + 3_000_000n) * 50n) / 100n + (5_000_000n * 65n) / 100n);
  assert.ok(sum(all) <= received);
});
