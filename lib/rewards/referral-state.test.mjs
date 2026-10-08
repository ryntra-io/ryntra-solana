import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";
import { bindReferrer, changeReferrer, ensureRewardAccount, readRewardAccount } from "./ledger.ts";
import { recordOperationRewards } from "./record.server.ts";
import { readReferralState } from "./referral-state.server.ts";

/*
 * What `GET /api/rewards/referral` answers and the one write it makes: the
 * carried invitation binds on its own for the browser's proven wallet while
 * the window is open (the case of 08.10 — friends never pressed «Confirm»).
 */

const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const D = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const T0 = "2026-10-01T10:00:00.000Z";
const ENV = { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T15:25:00Z" };

const trade = (store, wallet, ref, settledAt) => recordOperationRewards(store, {
  fee: settleServiceFee(
    serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: MINT, symbol: null, decimals: null, amountRaw: "5000000", providerRetainedPercent: 20 }),
    { collected: true, amountRaw: "5000000", settlement: { operationRef: ref, userPaidRaw: "5000000", providerRaw: "1000000", ryntraRaw: "4000000", asset: MINT, symbol: null, decimals: null, basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED" } },
  ),
  trader: wallet, settledAt, now: settledAt, env: ENV,
});

test("without a proven wallet the invitation is reported and nothing is written", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const read = await readReferralState(store, { wallet: null, carried: a.code, now: T0 });
  assert.equal(read.body.pending.inviterMasked, "6dNV…XbLp");
  assert.equal(read.body.confirmed, null);
  assert.equal(read.clearCookie, false);
  assert.equal(await readRewardAccount(store, B), null);
});

test("the proven wallet's first read binds the carried code on its own, once", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const first = await readReferralState(store, { wallet: B, carried: a.code, now: T0 });
  assert.equal(first.body.bound, true);
  assert.equal(first.body.confirmed.inviterMasked, "6dNV…XbLp");
  assert.equal(first.body.pending, null);
  assert.deepEqual(first.body.change, { open: true, until: null });
  assert.equal(first.clearCookie, true);
  assert.equal((await readRewardAccount(store, B)).referrer, A);
  assert.equal((await readRewardAccount(store, A)).directReferrals, 1);
  /* The next read reports it and binds nothing again. */
  const second = await readReferralState(store, { wallet: B, carried: null, now: T0 });
  assert.equal(second.body.bound, undefined);
  assert.equal(second.body.confirmed.inviterMasked, "6dNV…XbLp");
});

test("after the first trade it still binds for seven days, and not after", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  await trade(store, B, "op-1", T0);
  const late = await readReferralState(store, { wallet: B, carried: a.code, now: "2026-10-08T10:00:00.001Z" });
  assert.equal(late.body.bound, undefined);
  assert.equal(late.body.pending.inviterMasked, "6dNV…XbLp", "shown, with the honest «too late»");
  assert.deepEqual(late.body.binding, { open: false, until: "2026-10-08T10:00:00.000Z" });
  assert.equal(late.clearCookie, false, "kept: the read a moment later must give the same answer");
  assert.equal((await readRewardAccount(store, B)).referrer, null);

  const inTime = await readReferralState(store, { wallet: B, carried: a.code, now: "2026-10-08T10:00:00.000Z" });
  assert.equal(inTime.body.bound, true);
});

test("an inviter's own link is never offered back to them", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const read = await readReferralState(store, { wallet: A, carried: a.code, now: T0 });
  assert.equal(read.body.pending, null);
  assert.equal(read.body.bound, undefined);
  assert.equal(read.clearCookie, true);
  assert.equal((await readRewardAccount(store, A)).referrer, null);
});

test("a link that would close a cycle is dropped, not offered", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const b = await ensureRewardAccount(store, B, T0);
  await bindReferrer(store, { wallet: B, code: a.code, now: T0 });
  const read = await readReferralState(store, { wallet: A, carried: b.code, now: T0 });
  assert.equal(read.body.pending, null);
  assert.equal(read.clearCookie, true);
  assert.equal((await readRewardAccount(store, A)).referrer, null);
});

test("another inviter's link after binding is offered as the one change, only while it is possible", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const d = await ensureRewardAccount(store, D, T0);
  await bindReferrer(store, { wallet: B, code: a.code, now: T0 });
  const offered = await readReferralState(store, { wallet: B, carried: d.code, now: T0 });
  assert.equal(offered.body.pending.inviterMasked, "9WzD…AWWM");
  assert.equal(offered.clearCookie, false);
  /* The same inviter's link is noise. */
  const same = await readReferralState(store, { wallet: B, carried: a.code, now: T0 });
  assert.equal(same.body.pending, null);
  assert.equal(same.clearCookie, true);
  /* Once changed, nothing is offered any more. */
  assert.equal((await changeReferrer(store, { wallet: B, code: d.code, now: T0 })).ok, true);
  const after = await readReferralState(store, { wallet: B, carried: a.code, now: T0 });
  assert.equal(after.body.pending, null);
  assert.deepEqual(after.body.change, { open: false, until: null });
  assert.equal(after.clearCookie, true);
});

test("a binding that fails for a reason that may pass is not a failed page", async () => {
  const base = createMemoryGuardStore();
  const a = await ensureRewardAccount(base, A, T0);
  const store = { ...base, compareAndSetMany: async () => { throw new Error("store hiccup"); } };
  const read = await readReferralState(store, { wallet: B, carried: a.code, now: T0 });
  assert.equal(read.body.pending.inviterMasked, "6dNV…XbLp");
  assert.equal(read.body.bound, undefined);
  assert.equal(read.clearCookie, false);
});
