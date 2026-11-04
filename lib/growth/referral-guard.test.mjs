import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { replayBenefitJobs } from "../rewards/benefit-replay.server.ts";
import { rewardBalance } from "../rewards/balance.ts";
import { bindReferrer, ensureRewardAccount, listRewardEntries } from "../rewards/ledger.ts";
import { readRankStanding, rewardRulesEffectiveFrom, rewardRulesV21EffectiveFrom, rewardRulesV22EffectiveFrom } from "../rewards/rank-store.ts";
import { reconcileRewards } from "../rewards/reconcile.ts";
import { recordOperationRewards } from "../rewards/record.server.ts";
import { REWARD_RULES_V2_1_NOT_BEFORE, REWARD_RULES_V2_2_NOT_BEFORE } from "../rewards/rules.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";
import { actOnCase, readSubjectEvents } from "./review-store.ts";
import { walletSubject } from "./review.ts";
import {
  circularSwapRefs,
  NO_REFERRAL_GUARD,
  rankCountedEntries,
  REFERRAL_GUARD_RULES,
  referralHeldUsdMicros,
  referralPairEffect,
  referralPairFinding,
  referrerBarMet,
} from "./referral-guard.ts";
import { checkReferralPair, readReferralGuard, readReferralHold, readReferralPairs } from "./referral-guard-store.ts";

/*
 * Ryntra Partners R3 — the friend's trade is checked before its share pays or its points count. One test per attack:
 * a second own wallet as «friend», wash-trading to a rank, circular trades; and the referrer bar on payouts.
 */

const INVITER = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const FRIEND = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const ENV = { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T00:00:00Z" };
const START = "2026-10-01T00:00:00.000Z";
const T = (hours) => new Date(Date.parse("2026-10-28T00:00:00.000Z") + hours * 3_600_000).toISOString();

const SAME = { verdict: "same", reason: "linked_wallet", rules: "protect-1.0.0" };
const SEPARATE = { verdict: "separate", rules: "protect-1.0.0" };
const clusters = (verdict) => ({ check: async () => verdict });

/** A collected USDC fee of `paid` dollars, all of it received. */
function fee(ref, paid) {
  const raw = String(Math.round(paid * 1_000_000));
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: USDC, symbol: "USDC", decimals: 6, amountRaw: raw, providerRetainedPercent: 20 });
  return settleServiceFee(quoted, {
    collected: true,
    amountRaw: raw,
    settlement: { operationRef: ref, userPaidRaw: raw, providerRaw: "0", ryntraRaw: raw, asset: USDC, symbol: "USDC", decimals: 6, basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED" },
  });
}

/** Rules 2.2.0 in force; INVITER brought FRIEND. The inviter has a real trade of its own unless told otherwise. */
async function world({ inviterTrades = true } = {}) {
  const store = createMemoryGuardStore();
  await rewardRulesEffectiveFrom(store, START, ENV);
  await rewardRulesV21EffectiveFrom(store, REWARD_RULES_V2_1_NOT_BEFORE, ENV);
  await rewardRulesV22EffectiveFrom(store, REWARD_RULES_V2_2_NOT_BEFORE, ENV);
  const inviter = await ensureRewardAccount(store, INVITER, START);
  assert.equal((await bindReferrer(store, { wallet: FRIEND, code: inviter.code, now: START })).ok, true);
  if (inviterTrades) await trade(store, INVITER, "inviter-own", 2, T(-200));
  /* The friend's first trade fills its «First $10 back» (where the inviter's share is nought by the rules): from the
     next trade on, every one carries the inviter's share. */
  await trade(store, FRIEND, "friend-first", 40, T(-100));
  return store;
}

const trade = (store, trader, ref, paid, at) => recordOperationRewards(store, { fee: fee(ref, paid), trader, settledAt: at, now: at, env: ENV });

/** A signature-shaped reference, so the ledger's own schema reads the swap. */
const sig = (n) => "5".repeat(80) + String(n).replace(/0/g, "z").padStart(8, "x");

/** A swap in the action ledger, under the same reference as its fee. */
async function swap(store, wallet, ref, at, out, into) {
  await store.collection("solanaWalletActions").set(`solana:mainnet:${wallet}:${ref}`, {
    schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet", wallet, actionId: ref, lane: "SWAP", outcome: "DONE",
    out: { mint: out[0], amountRaw: out[1], decimals: null, symbol: null }, in: { mint: into[0], amountRaw: into[1], decimals: null, symbol: null },
    destination: null, signature: ref, receiptHash: null, sourceTx: null, destinationTx: null, fee: null, origin: null, startedAt: at, updatedAt: at,
  });
}

/** The reviewer's decision on the inviter's case, having seen its last event. */
async function decide(store, decision, now) {
  const log = await readSubjectEvents(store, walletSubject(INVITER));
  return actOnCase(store, { subject: walletSubject(INVITER), action: { kind: "DECIDE", decision, note: "reviewed", seen: log.events[log.events.length - 1].seq }, by: "reviewer", now });
}

/** «Everything accrued = the sum of the receipts», over every operation of the store. */
async function reconciled(store) {
  const accruals = await store.collection("rewardAccruals").valuesWithPrefix("");
  const receipts = accruals.map((record) => {
    const source = record.entries[0].source;
    return { operationRef: source.operationRef, wallet: record.trader, settledAt: source.settledAt, collected: true, grossRaw: source.grossRaw, ryntraRaw: source.grossRaw };
  });
  return reconcileRewards({ entries: await store.collection("rewardEntries").valuesWithPrefix(""), accruals, claims: [], receipts, queued: new Set(), activationAt: "2026-09-10T00:00:00.000Z", internal: new Set() });
}

const reserve = { usdMicros: 1_000_000_000n, state: "FUNDED" };
async function available(store, wallet, now) {
  const entries = await listRewardEntries(store, wallet);
  const hold = await readReferralHold(store, wallet, entries, now);
  return rewardBalance({ entries, reserve, heldUsdMicros: 0n, referralHeldUsdMicros: hold.heldUsdMicros, minimumUsdMicros: 1n }).availableUsdMicros;
}

/* ------------------------------------------------------------------------------------------------ the rules */

test("the finding: same is a case, never a verdict; a missing read waits; a long trail is a person's; separate is clear", () => {
  assert.deepEqual(referralPairFinding({ verdict: SAME, youngTrader: false, circularTrades: 0 }), { state: "REVIEW", codes: ["S2_DIRECT_FUNDS"] });
  assert.deepEqual(referralPairFinding({ verdict: { verdict: "same", reason: "shared_device", rules: "x" }, youngTrader: false, circularTrades: 0 }).codes, ["S4_SHARED_DEVICE"]);
  assert.equal(referralPairFinding({ verdict: { verdict: "unknown", why: "no_funding" }, youngTrader: false, circularTrades: 0 }).state, "WAIT");
  assert.deepEqual(referralPairFinding({ verdict: { verdict: "unknown", why: "funding_deep" }, youngTrader: false, circularTrades: 0 }), { state: "REVIEW", codes: ["UNVERIFIED"] });
  assert.equal(referralPairFinding({ verdict: SEPARATE, youngTrader: true, circularTrades: 0 }).state, "CLEAR", "one soft signal is no case");
  assert.equal(referralPairFinding({ verdict: SEPARATE, youngTrader: true, circularTrades: 2 }).state, "REVIEW", "two soft signals are (S10)");
});

test("the effect: not checked waits; a flagged pair is let go only by a decision taken after it was flagged", () => {
  assert.equal(referralPairEffect(null, null), "WAITS");
  assert.equal(referralPairEffect({ state: "PENDING", flaggedAt: null }, null), "WAITS");
  assert.equal(referralPairEffect({ state: "CLEAR", flaggedAt: null }, null), "PAYS");
  const flagged = { state: "REVIEW", flaggedAt: T(5) };
  assert.equal(referralPairEffect(flagged, null), "WAITS");
  assert.equal(referralPairEffect(flagged, { kind: "CLEAR", at: T(4) }), "WAITS", "an older decision answered other signals");
  assert.equal(referralPairEffect(flagged, { kind: "CLEAR", at: T(6) }), "PAYS");
  assert.equal(referralPairEffect(flagged, { kind: "CANCEL", at: T(6) }), "STOPPED");
});

test("circular swaps: A → B and back within a day for about what it cost; a real exit is not one", () => {
  const legs = [
    { ref: "buy", at: T(0), outMint: USDC, outRaw: 100_000_000n, inMint: SOL, inRaw: 500_000_000n },
    { ref: "sell", at: T(2), outMint: SOL, outRaw: 500_000_000n, inMint: USDC, inRaw: 99_000_000n },
    /* Sold back two days later: a position, not a loop. */
    { ref: "buy2", at: T(10), outMint: USDC, outRaw: 50_000_000n, inMint: SOL, inRaw: 250_000_000n },
    { ref: "sell2", at: T(60), outMint: SOL, outRaw: 250_000_000n, inMint: USDC, inRaw: 50_000_000n },
    /* Sold back the same day at a 30 % gain: a trade that moved, not a loop. */
    { ref: "buy3", at: T(70), outMint: USDC, outRaw: 10_000_000n, inMint: SOL, inRaw: 50_000_000n },
    { ref: "sell3", at: T(71), outMint: SOL, outRaw: 50_000_000n, inMint: USDC, inRaw: 13_000_000n },
  ];
  assert.deepEqual([...circularSwapRefs(legs)].sort(), ["buy", "sell"]);
  assert.equal(REFERRAL_GUARD_RULES.circular.windowHours, 24);
});

test("the rows: no point for half of a circular trade or a friend not clear; the bar needs one real own trade", () => {
  const row = (type, recipient, trader, ref, usd) => ({ type, recipient, rateBps: 5000, shareRaw: String(usd), usdMicros: String(usd), valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: USDC, observedAt: T(0) },
    source: { mechanism: "JUPITER_REFERRAL", operationRef: ref, trader, grossRaw: String(usd * 2), asset: USDC, symbol: "USDC", decimals: 6, settledAt: T(0) }, createdAt: T(0), claimId: null, signature: null });
  const entries = [row("CASHBACK", INVITER, INVITER, "own-loop", 5), row("CASHBACK", INVITER, INVITER, "own-real", 5), row("REFERRAL_L1", INVITER, FRIEND, "f-1", 3), row("REFERRAL_L2", INVITER, OTHER, "o-1", 1)];
  const guard = { ownCircular: new Set(["own-loop"]), pairs: new Map([[FRIEND, { effect: "WAITS", circular: new Set() }]]) };
  assert.deepEqual(rankCountedEntries(entries, INVITER, guard).map((entry) => entry.source.operationRef), ["own-real", "o-1"]);
  assert.equal(referrerBarMet(entries, INVITER, guard.ownCircular), true);
  assert.equal(referrerBarMet(entries.filter((entry) => entry.source.operationRef !== "own-real"), INVITER, guard.ownCircular), false, "a loop is no real trade");
  assert.equal(referralHeldUsdMicros(entries, INVITER, guard, true), 4n, "the friend waiting and the unchecked second level");
  assert.equal(referralHeldUsdMicros(entries, INVITER, NO_REFERRAL_GUARD, false), 4n);
});

/* ------------------------------------------------------------------------------------------------ attack 1 */

test("attack 1 — a second own wallet as «friend»: the share waits, a case opens, a person stops it, the next trade pays nobody", async () => {
  const store = await world();
  await trade(store, FRIEND, "f-1", 10, T(1));
  /* Unchecked: earned, not available, no point. */
  const owedBefore = await available(store, INVITER, T(2));
  assert.equal((await readRankStanding(store, INVITER, T(2))).fromFriends, 0n);
  /* The check finds the two to be one person: a case, never a payout. */
  const outcome = await checkReferralPair(store, { clusters: clusters(SAME) }, { inviter: INVITER, trader: FRIEND, now: T(2) });
  assert.equal(outcome.state, "DECIDED");
  assert.equal(outcome.pair.state, "REVIEW");
  const log = await readSubjectEvents(store, walletSubject(INVITER));
  assert.equal(log.events[0].kind, "OPENED");
  assert.deepEqual(log.events[0].signals, ["S2_DIRECT_FUNDS"]);
  assert.equal(await available(store, INVITER, T(3)), owedBefore, "the friend's share never became available");
  /* The reviewer stops it: the share stays with Ryntra — the next trade writes no inviter row at all. */
  assert.equal((await decide(store, "CANCEL", T(4))).ok, true);
  assert.equal((await readReferralGuard(store, INVITER, T(5))).pairs.get(FRIEND).effect, "STOPPED");
  await trade(store, FRIEND, "f-2", 10, T(6));
  const rows = (await listRewardEntries(store, INVITER)).filter((entry) => entry.source?.operationRef === "f-2");
  assert.deepEqual(rows, []);
  /* The friend's own cashback is untouched — protection takes nothing from a trade, it only refuses the share. */
  assert.ok((await listRewardEntries(store, FRIEND)).some((entry) => entry.type === "CASHBACK" && entry.source?.operationRef === "f-2"));
  /* Everything accrued is still the sum of its receipts. */
  const report = await reconciled(store);
  assert.deepEqual(report.differences, []);
  assert.equal(report.totals.accruedUsdMicros, report.totals.byOperationsUsdMicros);
});

test("attack 1 — a pair the reviewer clears pays as earned, and a later clean run does not answer for a person", async () => {
  const store = await world();
  await trade(store, FRIEND, "f-1", 10, T(1));
  await checkReferralPair(store, { clusters: clusters(SAME) }, { inviter: INVITER, trader: FRIEND, now: T(2) });
  const held = await available(store, INVITER, T(2));
  /* A quiet run while the case is open keeps it the reviewer's. */
  await checkReferralPair(store, { clusters: clusters(SEPARATE) }, { inviter: INVITER, trader: FRIEND, now: T(3) });
  assert.equal((await readReferralPairs(store, INVITER)).get(FRIEND).state, "REVIEW");
  const decided = await decide(store, "CLEAR", T(4));
  assert.equal(decided.ok, true, JSON.stringify(decided));
  assert.ok(await available(store, INVITER, T(5)) > held, "the friend's share is free once a person cleared the pair");
});

/* ------------------------------------------------------------------------------------------------ attack 2 */

test("attack 2 — wash-trading to a rank through a linked wallet earns the inviter no point; a clear friend does", async () => {
  const store = await world();
  /* $10 000 of received fee — Diamond by the 2.2.0 ladder, if it counted. */
  for (let i = 0; i < 10; i += 1) await trade(store, FRIEND, `wash-${i}`, 1000, T(1 + i));
  assert.equal((await readRankStanding(store, INVITER, T(20))).rank, "BRONZE", "unchecked: nothing counts");
  await checkReferralPair(store, { clusters: clusters(SAME) }, { inviter: INVITER, trader: FRIEND, now: T(20) });
  const linked = await readRankStanding(store, INVITER, T(21));
  assert.equal(linked.fromFriends, 0n);
  assert.equal(linked.rank, "BRONZE");
  /* The same volume from a friend the check clears is a real friend's. */
  const clean = await world();
  for (let i = 0; i < 10; i += 1) await trade(clean, FRIEND, `real-${i}`, 1000, T(1 + i));
  await checkReferralPair(clean, { clusters: clusters(SEPARATE) }, { inviter: INVITER, trader: FRIEND, now: T(20) });
  const standing = await readRankStanding(clean, INVITER, T(21));
  assert.ok(standing.fromFriends > 0n);
  assert.notEqual(standing.rank, "BRONZE");
});

/* ------------------------------------------------------------------------------------------------ attack 3 */

test("attack 3 — circular trades: neither half lifts a rank, the trader's own nor its inviter's; the cashback stays", async () => {
  const store = await world();
  /* A clear pair to begin with: what the friend's ordinary trades are worth to both ranks. */
  await checkReferralPair(store, { clusters: clusters(SEPARATE) }, { inviter: INVITER, trader: FRIEND, now: T(-1) });
  const friendBefore = (await readRankStanding(store, FRIEND, T(-1))).fromTrades;
  const inviterBefore = (await readRankStanding(store, INVITER, T(-1))).fromFriends;
  assert.ok(inviterBefore > 0n);
  /* The friend buys and sells back the same SOL within hours, twenty times over. */
  for (let i = 0; i < 20; i += 1) {
    const at = T(i * 2);
    const back = T(i * 2 + 1);
    await swap(store, FRIEND, sig(i * 2 + 1), at, [USDC, "1000000000"], [SOL, "5000000000"]);
    await trade(store, FRIEND, sig(i * 2 + 1), 100, at);
    await swap(store, FRIEND, sig(i * 2 + 2), back, [SOL, "5000000000"], [USDC, "995000000"]);
    await trade(store, FRIEND, sig(i * 2 + 2), 100, back);
  }
  /* The friend's own rank: not a point more for $4 000 of loops. */
  assert.equal((await readRankStanding(store, FRIEND, T(50))).fromTrades, friendBefore);
  /* The pair is otherwise clear, and still the inviter earns no point from the loop. */
  const outcome = await checkReferralPair(store, { clusters: clusters(SEPARATE) }, { inviter: INVITER, trader: FRIEND, now: T(50) });
  assert.equal(outcome.pair.state, "CLEAR");
  assert.ok(outcome.pair.codes.includes("S6_ROUND_TRIP"));
  assert.equal(outcome.pair.circular.length, 40);
  assert.equal((await readRankStanding(store, INVITER, T(51))).fromFriends, inviterBefore);
  /* The fee was real: the trader's cashback is there for every half. */
  const cashback = (await listRewardEntries(store, FRIEND)).filter((entry) => entry.type === "CASHBACK" && entry.source?.operationRef.startsWith("5".repeat(80)));
  assert.equal(cashback.length, 40);
});

test("attack 3 — a young wallet that loops: two soft signals open a case on the inviter; youth alone does not", async () => {
  const store = await world();
  await swap(store, FRIEND, sig(1), T(1), [USDC, "1000000000"], [SOL, "5000000000"]);
  await trade(store, FRIEND, sig(1), 100, T(1));
  await swap(store, FRIEND, sig(2), T(2), [SOL, "5000000000"], [USDC, "998000000"]);
  await trade(store, FRIEND, sig(2), 100, T(2));
  const young = async () => true;
  const looped = await checkReferralPair(store, { clusters: clusters(SEPARATE), young }, { inviter: INVITER, trader: FRIEND, now: T(3) });
  assert.equal(looped.pair.state, "REVIEW");
  assert.deepEqual([...looped.pair.codes].sort(), ["S5_YOUNG_WALLETS", "S6_ROUND_TRIP"]);
  const log = await readSubjectEvents(store, walletSubject(INVITER));
  assert.equal(log.events[0].kind, "OPENED", "a case for a person, never a ban");
  assert.equal((await readReferralGuard(store, INVITER, T(4))).pairs.get(FRIEND).effect, "WAITS");
  /* A young friend who trades for real is one soft signal: clear, paid. */
  const fresh = await world();
  await trade(fresh, FRIEND, "f-1", 10, T(1));
  const real = await checkReferralPair(fresh, { clusters: clusters(SEPARATE), young }, { inviter: INVITER, trader: FRIEND, now: T(2) });
  assert.deepEqual([real.pair.state, real.pair.codes], ["CLEAR", ["S5_YOUNG_WALLETS"]]);
  /* A young-wallet read that fails counts as not young — it never decides on its own. */
  const unknown = await world();
  const quiet = await checkReferralPair(unknown, { clusters: clusters(SEPARATE), young: async () => { throw new Error("rpc down"); } }, { inviter: INVITER, trader: FRIEND, now: T(2) });
  assert.equal(quiet.pair.state, "CLEAR");
});

/* ------------------------------------------------------------------------------------------------ the bar */

test("the referrer bar: a friend's share waits until the inviter's own first real trade — the link itself was free", async () => {
  const store = await world({ inviterTrades: false });
  await trade(store, FRIEND, "f-1", 10, T(1));
  await checkReferralPair(store, { clusters: clusters(SEPARATE) }, { inviter: INVITER, trader: FRIEND, now: T(2) });
  const entries = await listRewardEntries(store, INVITER);
  const before = await readReferralHold(store, INVITER, entries, T(3));
  assert.equal(before.barMet, false);
  assert.ok(before.heldUsdMicros > 0n);
  assert.equal(await available(store, INVITER, T(3)), 0n);
  await trade(store, INVITER, "inviter-first", 1, T(4));
  const mine = await listRewardEntries(store, INVITER);
  const after = await readReferralHold(store, INVITER, mine, T(5));
  assert.ok(mine.some((entry) => entry.type === "CASHBACK"), JSON.stringify(mine.map((entry) => [entry.type, entry.window, entry.shareRaw, entry.source?.trader === INVITER])));
  assert.deepEqual([after.barMet, after.heldUsdMicros], [true, 0n]);
});

test("the pair check runs from the bookkeeping queue after a friend's trade, and a missing check key only waits", async () => {
  const store = await world();
  await trade(store, FRIEND, "f-1", 10, T(1));
  const jobs = await store.collection("benefitJobs").valuesWithPrefix(`${FRIEND}:REFERRAL_CHECK:`);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].data.operationId, INVITER);
  await replayBenefitJobs(store, { wallet: FRIEND, now: T(2), env: ENV, referral: null });
  assert.equal((await readReferralPairs(store, INVITER)).get(FRIEND).state, "PENDING");
  await replayBenefitJobs(store, { wallet: FRIEND, now: T(30), env: ENV, referral: { clusters: clusters(SEPARATE) } });
  assert.equal((await readReferralPairs(store, INVITER)).get(FRIEND).state, "CLEAR");
  assert.equal((await store.collection("benefitJobs").valuesWithPrefix(`${FRIEND}:REFERRAL_CHECK:`)).length, 0);
});
