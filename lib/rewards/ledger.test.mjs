import assert from "node:assert/strict";
import test from "node:test";

import { accrueRewards } from "./accrue.ts";
import { rewardBalance, unconfiguredReserve } from "./balance.ts";
import { claimUnresolved, openClaim, readClaim, transitionClaim } from "./claim.ts";
import {
  bindReferrer,
  claimEntry,
  ensureRewardAccount,
  listRewardEntries,
  markEarning,
  readRewardAccount,
  recordClaimEntry,
  recordRewards,
  referralCounts,
  resolveReferralLevels,
  totalRewards,
} from "./ledger.ts";
import { formatUsdMicros } from "./model.ts";
import { decideReferralBind, mintReferralCode, normalizeReferralCode, referralLevels, referralLink } from "./referral.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const C = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const NOW = "2026-09-11T12:00:00.000Z";

function collected(grossRaw, operationRef) {
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", {
    basisPoints: 50, asset: USDC, symbol: "USDC", decimals: 6, amountRaw: grossRaw, providerRetainedPercent: 20,
  });
  const provider = ((BigInt(grossRaw) * 20n + 99n) / 100n).toString();
  return settleServiceFee(quoted, {
    collected: true,
    amountRaw: grossRaw,
    settlement: {
      userPaidRaw: grossRaw,
      providerRaw: provider,
      ryntraRaw: (BigInt(grossRaw) - BigInt(provider)).toString(),
      asset: USDC, symbol: "USDC", decimals: 6,
      basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED",
      operationRef,
    },
  });
}

async function accrueInto(store, { trader, l1 = null, l2 = null, grossRaw = "5000000", ref = "sig-1" }) {
  const result = accrueRewards({
    fee: collected(grossRaw, ref), trader, referrerL1: l1, referrerL2: l2, settledAt: NOW, now: NOW, price: null,
  });
  assert.equal(result.ok, true);
  return recordRewards(store, result.entries, result.ref);
}

test("reading the same operation twice does not pay twice", async () => {
  const store = createMemoryGuardStore();
  const first = await accrueInto(store, { trader: A, l1: B, l2: C });
  assert.equal(first.created.length, 3);
  assert.equal(first.existing, 0);

  /* A reload, a webhook retry, a status poll — all of them look like this. */
  const second = await accrueInto(store, { trader: A, l1: B, l2: C });
  assert.equal(second.created.length, 0);
  assert.equal(second.existing, 3);

  const totals = totalRewards(await listRewardEntries(store, A));
  assert.equal(formatUsdMicros(totals.entitledUsdMicros), "2.50");
});

test("a different operation is new income even with the same wallets", async () => {
  const store = createMemoryGuardStore();
  await accrueInto(store, { trader: A, ref: "sig-1" });
  await accrueInto(store, { trader: A, ref: "sig-2" });
  const totals = totalRewards(await listRewardEntries(store, A));
  assert.equal(formatUsdMicros(totals.entitledUsdMicros), "5.00");
});

test("each level's ledger holds only its own share", async () => {
  const store = createMemoryGuardStore();
  await accrueInto(store, { trader: A, l1: B, l2: C });
  assert.equal(formatUsdMicros(totalRewards(await listRewardEntries(store, B)).entitledUsdMicros), "0.50");
  assert.equal(formatUsdMicros(totalRewards(await listRewardEntries(store, C)).entitledUsdMicros), "0.25");
  const bySource = totalRewards(await listRewardEntries(store, B)).bySource;
  assert.equal(bySource.REFERRAL_L1, 500_000n);
  assert.equal(bySource.CASHBACK, 0n);
});

test("an unvalued reward is pending, and is never counted as zero", async () => {
  const store = createMemoryGuardStore();
  const result = accrueRewards({
    fee: collected("5000000", "sig-x"),
    trader: A, referrerL1: null, referrerL2: null, settledAt: NOW, now: NOW, price: null,
  });
  const unvalued = result.entries.map((entry) => ({ ...entry, usdMicros: null, valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null } }));
  await recordRewards(store, unvalued, "sig-x");
  const totals = totalRewards(await listRewardEntries(store, A));
  assert.equal(totals.entitledUsdMicros, 0n);
  assert.equal(totals.unvaluedCount, 1);

  const balance = rewardBalance({
    entries: await listRewardEntries(store, A),
    reserve: { state: "FUNDED", usdMicros: 100_000_000n, treasury: A, observedAt: NOW }, heldUsdMicros: 0n
  });
  assert.equal(balance.availableUsdMicros, 0n);
  assert.deepEqual(balance.pendingReasons, ["AWAITING_VALUATION"]);
});

/* ------------------------------------------------------------------ reserve */

test("available never exceeds the funded reserve, and no reserve means no claim", async () => {
  const store = createMemoryGuardStore();
  await accrueInto(store, { trader: A, grossRaw: "100000000", ref: "big" });
  const entries = await listRewardEntries(store, A);
  assert.equal(formatUsdMicros(totalRewards(entries).entitledUsdMicros), "50.00");

  const short = rewardBalance({
    entries,
    reserve: { state: "FUNDED", usdMicros: 12_000_000n, treasury: A, observedAt: NOW }, heldUsdMicros: 0n
  });
  assert.equal(formatUsdMicros(short.availableUsdMicros), "12.00");
  assert.equal(formatUsdMicros(short.pendingUsdMicros), "38.00");
  assert.deepEqual(short.pendingReasons, ["AWAITING_RESERVE"]);
  assert.equal(short.claimable, true);

  const none = rewardBalance({ entries, reserve: unconfiguredReserve("nothing is set"), heldUsdMicros: 0n });
  assert.equal(none.availableUsdMicros, 0n);
  assert.equal(none.claimable, false);
  /* Somebody who has genuinely earned enough is not told they are below the
     floor. That sentence would be false. The reason names the reserve and
     never promises a time (canon v5.0 §0.0 rule 10). */
  assert.match(none.claimBlockedReason, /reward reserve/);
  assert.doesNotMatch(none.claimBlockedReason, /shortly|soon/i);
  const uk = rewardBalance({ entries, reserve: unconfiguredReserve("nothing is set"), heldUsdMicros: 0n, locale: "uk" });
  assert.match(uk.claimBlockedReason, /резерв винагород/);
  assert.doesNotMatch(uk.claimBlockedReason, /незабаром|скоро/i);
});

test("below the floor the reason is the floor, and it names the dollar", async () => {
  const store = createMemoryGuardStore();
  await accrueInto(store, { trader: A, grossRaw: "1000000", ref: "small" });
  const balance = rewardBalance({
    entries: await listRewardEntries(store, A),
    reserve: { state: "FUNDED", usdMicros: 100_000_000n, treasury: A, observedAt: NOW }, heldUsdMicros: 0n
  });
  assert.equal(formatUsdMicros(balance.availableUsdMicros), "0.50");
  assert.equal(balance.claimable, false);
  assert.match(balance.claimBlockedReason, /\$1\.00/);

  const uk = rewardBalance({
    entries: await listRewardEntries(store, A),
    reserve: { state: "FUNDED", usdMicros: 100_000_000n, treasury: A, observedAt: NOW },
    heldUsdMicros: 0n,
    locale: "uk",
  });
  assert.match(uk.claimBlockedReason, /\$1\.00/);
  assert.notEqual(uk.claimBlockedReason, balance.claimBlockedReason);
});

test("a claim reduces the balance and shows up as claimed", async () => {
  const store = createMemoryGuardStore();
  await accrueInto(store, { trader: A, grossRaw: "100000000", ref: "big" });
  await recordClaimEntry(store, claimEntry({ wallet: A, claimId: "claim-1", usdMicros: 12_000_000n, signature: "sig", now: NOW }));
  const totals = totalRewards(await listRewardEntries(store, A));
  assert.equal(formatUsdMicros(totals.entitledUsdMicros), "38.00");
  assert.equal(formatUsdMicros(totals.claimedUsdMicros), "12.00");
  /* Lifetime is what was earned. A claim does not un-earn it. */
  assert.equal(formatUsdMicros(totals.lifetimeUsdMicros), "50.00");
});

/* ---------------------------------------------------------------- referrals */

test("a code resolves to its owner and a link is built one way", async () => {
  const store = createMemoryGuardStore();
  const account = await ensureRewardAccount(store, A, NOW);
  assert.equal(normalizeReferralCode(account.code), account.code);
  assert.equal(normalizeReferralCode(account.code.toLowerCase()), account.code);
  assert.equal(normalizeReferralCode("nope"), null);
  assert.equal(referralLink("https://ryntra.io/", account.code), `https://ryntra.io/r/${account.code}`);
  /* Nothing about the owner is recoverable from the code. */
  assert.equal(account.code.includes(A.slice(0, 4)), false);
  /* Calling again is the same account, not a second code. */
  assert.equal((await ensureRewardAccount(store, A, NOW)).code, account.code);
});

test("two levels, and never a third", async () => {
  const store = createMemoryGuardStore();
  const top = await ensureRewardAccount(store, A, NOW);
  const middle = await ensureRewardAccount(store, B, NOW);
  await ensureRewardAccount(store, C, NOW);

  assert.equal((await bindReferrer(store, { wallet: B, code: top.code, now: NOW })).ok, true);
  assert.equal((await bindReferrer(store, { wallet: C, code: middle.code, now: NOW })).ok, true);

  const levels = await resolveReferralLevels(store, C);
  assert.deepEqual(levels, { l1: B, l2: A });

  /* A fourth wallet under C pays C and B — never A. */
  const bottom = "7YHhAcAAqQqU8qgxCsQqmDPqfbFwGyv5CGKPGZTfMfhX";
  const cAccount = await readRewardAccount(store, C);
  assert.equal((await bindReferrer(store, { wallet: bottom, code: cAccount.code, now: NOW })).ok, true);
  assert.deepEqual(await resolveReferralLevels(store, bottom), { l1: C, l2: B });
});

test("self-referral, an unknown code, a cycle and a settled inviter are all refused", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  const b = await ensureRewardAccount(store, B, NOW);

  assert.equal((await bindReferrer(store, { wallet: A, code: a.code, now: NOW })).code, "SELF_REFERRAL");
  assert.equal((await bindReferrer(store, { wallet: A, code: "BBBBBBBBBBBB", now: NOW })).code, "UNKNOWN_CODE");

  await bindReferrer(store, { wallet: B, code: a.code, now: NOW });
  /* B was invited by A, so A cannot now be invited by B. */
  assert.equal((await bindReferrer(store, { wallet: A, code: b.code, now: NOW })).code, "CYCLE");

  /* An inviter does not change once set. */
  const c = await ensureRewardAccount(store, C, NOW);
  assert.equal((await bindReferrer(store, { wallet: B, code: c.code, now: NOW })).code, "ALREADY_REFERRED");
});

test("an inviter cannot be attached after the wallet has started earning", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  await ensureRewardAccount(store, B, NOW);
  await markEarning(store, B, NOW);
  const decision = await bindReferrer(store, { wallet: B, code: a.code, now: NOW });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "ALREADY_EARNING");
  assert.equal((await readRewardAccount(store, B)).referrer, null);
});

test("referral counts move when somebody confirms, not when they first trade", async () => {
  const store = createMemoryGuardStore();
  const top = await ensureRewardAccount(store, A, NOW);
  const middle = await ensureRewardAccount(store, B, NOW);
  await ensureRewardAccount(store, C, NOW);

  /* Nobody has chosen anybody yet. */
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 0, level2: 0 });

  await bindReferrer(store, { wallet: B, code: top.code, now: NOW });
  /* A invited B. The count moves on the confirmation, with B having traded
     nothing at all — a referrer who has invited somebody has invited them. */
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 0 });

  await bindReferrer(store, { wallet: C, code: middle.code, now: NOW });
  assert.deepEqual(referralCounts(await readRewardAccount(store, B)), { level1: 1, level2: 0 });
  /* And C sits two levels under A. */
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 1 });

  /* A refused bind moves nothing. */
  await bindReferrer(store, { wallet: C, code: top.code, now: NOW });
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 1 });
});

test("the pure bind rules answer without a store", () => {
  const account = { wallet: B, code: mintReferralCode(), referrer: null, referredAt: null, createdAt: NOW, earning: false, version: 0 };
  assert.equal(decideReferralBind({ wallet: B, referrer: A, account, referrerChain: [A] }).ok, true);
  assert.equal(decideReferralBind({ wallet: B, referrer: B, account, referrerChain: [] }).code, "SELF_REFERRAL");
  assert.equal(decideReferralBind({ wallet: B, referrer: null, account, referrerChain: [] }).code, "UNKNOWN_CODE");
  assert.equal(decideReferralBind({ wallet: B, referrer: A, account, referrerChain: [A, B] }).code, "CYCLE");
  /* `referralLevels` cannot produce a third level under any input. */
  assert.deepEqual(referralLevels({ wallet: C, referrer: B }, { wallet: B, referrer: A }), { l1: B, l2: A });
  assert.deepEqual(referralLevels({ wallet: C, referrer: B }, { wallet: B, referrer: C }), { l1: B, l2: null });
  assert.deepEqual(referralLevels(null, null), { l1: null, l2: null });
});

/* -------------------------------------------------------------------- claim */

test("two tabs cannot claim the same balance", async () => {
  const store = createMemoryGuardStore();
  const first = await openClaim(store, { wallet: A, usdMicros: 12_480_000n, now: NOW });
  assert.equal(first.ok, true);
  const second = await openClaim(store, { wallet: A, usdMicros: 12_480_000n, now: NOW });
  assert.equal(second.ok, false);
  assert.equal(second.code, "ALREADY_RUNNING");
  assert.equal(claimUnresolved(await readClaim(store, A)), true);
});

test("an unknown submission is resolved by looking, never by paying again", async () => {
  const store = createMemoryGuardStore();
  const opened = await openClaim(store, { wallet: A, usdMicros: 5_000_000n, now: NOW });
  const unknown = await transitionClaim(store, {
    wallet: A, claimId: opened.claim.claimId, to: "SUBMITTED_UNKNOWN", at: NOW, signature: "sig-unknown",
  });
  assert.equal(unknown.ok, true);
  /* No new claim while the old one is unresolved. */
  assert.equal((await openClaim(store, { wallet: A, usdMicros: 5_000_000n, now: NOW })).code, "ALREADY_RUNNING");
  /* And no way back to CLAIMING, which would be the route to a second payout. */
  const backwards = await transitionClaim(store, { wallet: A, claimId: opened.claim.claimId, to: "CLAIMING", at: NOW });
  assert.equal(backwards.ok, false);

  const paid = await transitionClaim(store, { wallet: A, claimId: opened.claim.claimId, to: "PAID", at: NOW });
  assert.equal(paid.ok, true);
  /* A resolved claim frees the slot. */
  assert.equal((await openClaim(store, { wallet: A, usdMicros: 1_000_000n, now: NOW })).ok, true);
});

test("a failed claim leaves the balance untouched and lets a person try again", async () => {
  const store = createMemoryGuardStore();
  await accrueInto(store, { trader: A, grossRaw: "10000000", ref: "one" });
  const before = totalRewards(await listRewardEntries(store, A)).entitledUsdMicros;
  const opened = await openClaim(store, { wallet: A, usdMicros: before, now: NOW });
  await transitionClaim(store, { wallet: A, claimId: opened.claim.claimId, to: "FAILED", at: NOW, note: "rpc refused" });
  /* No claim entry was written, so nothing was deducted. */
  assert.equal(totalRewards(await listRewardEntries(store, A)).entitledUsdMicros, before);
  assert.equal((await openClaim(store, { wallet: A, usdMicros: before, now: NOW })).ok, true);
});

test("a claim entry for one claim is written once", async () => {
  const store = createMemoryGuardStore();
  const entry = claimEntry({ wallet: A, claimId: "claim-1", usdMicros: 3_000_000n, signature: "sig", now: NOW });
  assert.equal(await recordClaimEntry(store, entry), true);
  assert.equal(await recordClaimEntry(store, entry), false);
  assert.equal(formatUsdMicros(totalRewards(await listRewardEntries(store, A)).claimedUsdMicros), "3.00");
});
