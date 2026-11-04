import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";
import {
  bindReferrer,
  changeReferrer,
  earliestEarningAt,
  ensureRewardAccount,
  listRewardEntries,
  readReferralBindWindow,
  readReferralChangeWindow,
  readRewardAccount,
  totalRewards,
} from "./ledger.ts";
import { recordOperationRewards } from "./record.server.ts";
import { carriedCodeHolds, nextEarningSince, normalizeReferralCode, referralBindWindow, referralLevelsAt, referrerAt } from "./referral.ts";

/*
 * The seven days after a wallet's first trade in which an inviter can still be
 * added — the friend who traded before pressing «Підтвердити», and the code
 * pasted in afterwards. The case of 08.10: two friends traded first and
 * then saw "this wallet already has an inviter" for a wallet that had none.
 */

const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const D = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const E = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const T0 = "2026-10-01T10:00:00.000Z";
const ENV = { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T15:25:00Z" };

function fee(ref) {
  return settleServiceFee(
    serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: MINT, symbol: null, decimals: null, amountRaw: "5000000", providerRetainedPercent: 20 }),
    { collected: true, amountRaw: "5000000", settlement: { operationRef: ref, userPaidRaw: "5000000", providerRaw: "1000000", ryntraRaw: "4000000", asset: MINT, symbol: null, decimals: null, basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED" } },
  );
}
const trade = (store, ref, settledAt, now = settledAt) =>
  recordOperationRewards(store, { fee: fee(ref), trader: B, settledAt, now, env: ENV });

test("a whole link is read as its code, and junk is still nothing", () => {
  const code = "F8ZJMW8Q9HSB";
  for (const typed of [
    code,
    ` ${code.toLowerCase()} `,
    `https://ryntra.io/r/${code}`,
    `ryntra.io/r/${code.toLowerCase()}/`,
    `https://ryntra.io/r/${code}?to=/app/launch/abc`,
    `https://ryntra.io/r/${code}/c/card-1`,
    `r/${code}`,
  ]) assert.equal(normalizeReferralCode(typed), code, typed);
  assert.equal(normalizeReferralCode("https://ryntra.io/app/rewards"), null);
  assert.equal(normalizeReferralCode("https://ryntra.io/r/nope"), null);
  assert.equal(normalizeReferralCode(""), null);
});

test("the window: open before earning, seven days after, then shut; undated is shut", () => {
  assert.deepEqual(referralBindWindow(null, T0), { open: true, until: null });
  assert.deepEqual(referralBindWindow({ earning: false, earningSince: null }, T0), { open: true, until: null });
  const earning = { earning: true, earningSince: T0 };
  assert.deepEqual(referralBindWindow(earning, "2026-10-08T10:00:00.000Z"), { open: true, until: "2026-10-08T10:00:00.000Z" });
  assert.deepEqual(referralBindWindow(earning, "2026-10-08T10:00:00.001Z"), { open: false, until: "2026-10-08T10:00:00.000Z" });
  assert.deepEqual(referralBindWindow({ earning: true, earningSince: null }, T0), { open: false, until: null });
});

test("the first earning is dated by the settlement, moves back for an older one, never forward", () => {
  const fresh = { earning: false, earningSince: null };
  assert.equal(nextEarningSince(fresh, false, T0), null, "nothing earned, nothing dated");
  assert.equal(nextEarningSince(fresh, true, T0), T0);
  const dated = { earning: true, earningSince: T0 };
  assert.equal(nextEarningSince(dated, true, "2026-10-03T00:00:00.000Z"), T0, "a later trade does not reopen the window");
  assert.equal(nextEarningSince(dated, true, "2026-09-30T00:00:00.000Z"), "2026-09-30T00:00:00.000Z", "an older trade recorded late");
  assert.equal(nextEarningSince({ earning: true, earningSince: null }, true, T0), null, "a record earning before the field is never handed a fresh window");
});

test("a friend who traded first can still confirm for seven days, and nothing before the binding moves", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);

  /* B trades with no inviter: cashback only, and the window starts. */
  assert.equal((await trade(store, "op-before", T0)).state, "RECORDED");
  const b = await readRewardAccount(store, B);
  assert.equal(b.earning, true);
  assert.equal(b.earningSince, T0);

  /* Two days later B pastes A's link. */
  const bindAt = "2026-10-03T10:00:00.000Z";
  assert.deepEqual(await readReferralBindWindow(store, b, bindAt), { open: true, until: "2026-10-08T10:00:00.000Z" });
  assert.equal((await bindReferrer(store, { wallet: B, code: normalizeReferralCode(`https://ryntra.io/r/${a.code}`), now: bindAt })).ok, true);
  assert.equal((await readRewardAccount(store, A)).directReferrals, 1, "the friend now shows under the inviter");

  /* The earlier trade still pays A nothing, on a replay too. */
  await trade(store, "op-before", T0, "2026-10-03T11:00:00.000Z");
  assert.equal((await listRewardEntries(store, A)).length, 0);

  /* A trade after the binding pays A Level 1. */
  assert.equal((await trade(store, "op-after", "2026-10-04T10:00:00.000Z")).state, "RECORDED");
  const level1 = (await listRewardEntries(store, A)).filter((entry) => entry.type === "REFERRAL_L1");
  assert.equal(level1.length, 1);
  assert.equal(level1[0].source.operationRef, "op-after");
  assert.equal(totalRewards(await listRewardEntries(store, A)).bySource.REFERRAL_L1, 400000n);
  assert.equal(await readReferralBindWindow(store, await readRewardAccount(store, B), bindAt), null, "settled: the question is gone");
});

test("past the seven days the refusal is ALREADY_EARNING and nothing is written", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  await trade(store, "op-1", T0);
  const late = "2026-10-08T10:00:00.001Z";
  assert.deepEqual(await readReferralBindWindow(store, await readRewardAccount(store, B), late), { open: false, until: "2026-10-08T10:00:00.000Z" });
  const decision = await bindReferrer(store, { wallet: B, code: a.code, now: late });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "ALREADY_EARNING");
  assert.equal((await readRewardAccount(store, B)).referrer, null);
  assert.equal((await readRewardAccount(store, A)).directReferrals, 0);
});

test("the inviter's own first earning is dated too — a friend's trade that paid them", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  await bindReferrer(store, { wallet: B, code: a.code, now: T0 });
  await trade(store, "op-1", "2026-10-02T09:00:00.000Z");
  assert.equal((await readRewardAccount(store, A)).earningSince, "2026-10-02T09:00:00.000Z");
});

test("a record earning before the field existed is dated from its own oldest row", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  await trade(store, "op-old", T0);
  /* Production as it is before this release: earning, no moment. */
  const accounts = store.versioned("rewardAccounts");
  const current = await accounts.get(B);
  const { earningSince: _dropped, ...legacy } = current;
  await accounts.compareAndSet(B, current.version, { ...legacy, version: current.version + 1 });
  const read = await readRewardAccount(store, B);
  assert.equal(read.earning, true);
  assert.equal(read.earningSince, null);
  assert.equal(await earliestEarningAt(store, B), T0);

  /* Reading the window dates it without writing. */
  assert.deepEqual(await readReferralBindWindow(store, read, "2026-10-05T00:00:00.000Z"), { open: true, until: "2026-10-08T10:00:00.000Z" });
  assert.equal((await readRewardAccount(store, B)).earningSince, null, "a read writes nothing");

  /* The binding dates it for good. */
  assert.equal((await bindReferrer(store, { wallet: B, code: a.code, now: "2026-10-05T00:00:00.000Z" })).ok, true);
  assert.equal((await readRewardAccount(store, B)).earningSince, T0);
});

test("an earning record with nothing to date it from stays closed", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const b = await ensureRewardAccount(store, B, T0);
  await store.versioned("rewardAccounts").compareAndSet(B, b.version, { ...b, earning: true, earningSince: null, version: b.version + 1 });
  assert.deepEqual(await readReferralBindWindow(store, await readRewardAccount(store, B), T0), { open: false, until: null });
  assert.equal((await bindReferrer(store, { wallet: B, code: a.code, now: T0 })).code, "ALREADY_EARNING");
});

test("the inviter at a moment: the current one since the change, the previous one before it", () => {
  const account = { referrer: D, referredAt: "2026-10-03T00:00:00.000Z", previousReferrer: A, previousReferredAt: "2026-10-01T00:00:00.000Z" };
  assert.equal(referrerAt(account, "2026-09-30T00:00:00.000Z"), null);
  assert.equal(referrerAt(account, "2026-10-02T00:00:00.000Z"), A);
  assert.equal(referrerAt(account, "2026-10-03T00:00:00.000Z"), D);
  const trader = { wallet: B, ...account };
  /* Level 2 comes from the account of the inviter at that moment, at that moment. */
  assert.deepEqual(referralLevelsAt(trader, { wallet: A, referrer: E, referredAt: "2026-09-01T00:00:00.000Z", previousReferrer: null, previousReferredAt: null }, "2026-10-02T00:00:00.000Z"), { l1: A, l2: E });
  assert.deepEqual(referralLevelsAt(trader, { wallet: E, referrer: D, referredAt: "2026-09-01T00:00:00.000Z", previousReferrer: null, previousReferredAt: null }, "2026-10-02T00:00:00.000Z"), { l1: A, l2: null }, "a parent that is not the inviter at that moment pays nothing");
});

test("an inviter can be changed once inside the window; the old one keeps what settled before", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const d = await ensureRewardAccount(store, D, T0);
  await bindReferrer(store, { wallet: B, code: a.code, now: T0 });
  await trade(store, "op-with-a", "2026-10-02T10:00:00.000Z");
  assert.equal((await readRewardAccount(store, A)).directReferrals, 1);

  const changeAt = "2026-10-04T10:00:00.000Z";
  assert.deepEqual(await readReferralChangeWindow(store, await readRewardAccount(store, B), changeAt), { open: true, until: "2026-10-09T10:00:00.000Z" });
  assert.equal((await changeReferrer(store, { wallet: B, code: d.code, now: changeAt })).ok, true);
  const b = await readRewardAccount(store, B);
  assert.equal(b.referrer, D);
  assert.equal(b.previousReferrer, A);
  assert.equal(b.previousReferredAt, T0);
  assert.equal(b.referrerChanges, 1);
  assert.equal((await readRewardAccount(store, A)).directReferrals, 0, "the old inviter's count drops");
  assert.equal((await readRewardAccount(store, D)).directReferrals, 1, "the new inviter's count rises");
  assert.deepEqual(await readReferralChangeWindow(store, b, changeAt), { open: false, until: null });

  /* An operation from before the change, recorded late, still pays A. */
  await trade(store, "op-late-record", "2026-10-03T10:00:00.000Z", "2026-10-05T10:00:00.000Z");
  /* One after it pays D. */
  await trade(store, "op-with-d", "2026-10-05T10:00:00.000Z");
  const l1Of = async (wallet) => (await listRewardEntries(store, wallet)).filter((entry) => entry.type === "REFERRAL_L1").map((entry) => entry.source.operationRef).sort();
  assert.deepEqual(await l1Of(A), ["op-late-record", "op-with-a"]);
  assert.deepEqual(await l1Of(D), ["op-with-d"]);

  /* Once only. */
  const e = await ensureRewardAccount(store, E, T0);
  const again = await changeReferrer(store, { wallet: B, code: e.code, now: "2026-10-05T11:00:00.000Z" });
  assert.equal(again.code, "ALREADY_CHANGED");
  assert.equal((await readRewardAccount(store, B)).referrer, D);
  /* The same inviter again is not a change and is not an error. */
  assert.equal((await changeReferrer(store, { wallet: B, code: d.code, now: "2026-10-05T11:00:00.000Z" })).ok, true);
});

test("no change once the seven days after the first trade are over", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const d = await ensureRewardAccount(store, D, T0);
  await bindReferrer(store, { wallet: B, code: a.code, now: T0 });
  await trade(store, "op-1", T0);
  const late = "2026-10-08T10:00:00.001Z";
  assert.deepEqual(await readReferralChangeWindow(store, await readRewardAccount(store, B), late), { open: false, until: "2026-10-08T10:00:00.000Z" });
  assert.equal((await changeReferrer(store, { wallet: B, code: d.code, now: late })).code, "ALREADY_EARNING");
  assert.equal((await readRewardAccount(store, B)).referrer, A);
});

test("a change moves the wallet's own friends to the new inviter's second level", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const d = await ensureRewardAccount(store, D, T0);
  const b = await ensureRewardAccount(store, B, T0);
  await bindReferrer(store, { wallet: B, code: a.code, now: T0 });
  await bindReferrer(store, { wallet: E, code: b.code, now: T0 });
  assert.equal((await readRewardAccount(store, A)).level2Referrals, 1);
  assert.equal((await changeReferrer(store, { wallet: B, code: d.code, now: "2026-10-02T00:00:00.000Z" })).ok, true);
  assert.deepEqual([(await readRewardAccount(store, A)).directReferrals, (await readRewardAccount(store, A)).level2Referrals], [0, 0]);
  assert.deepEqual([(await readRewardAccount(store, D)).directReferrals, (await readRewardAccount(store, D)).level2Referrals], [1, 1]);
});

test("a change cannot close a cycle or point at yourself", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  const b = await ensureRewardAccount(store, B, T0);
  const d = await ensureRewardAccount(store, D, T0);
  await bindReferrer(store, { wallet: B, code: a.code, now: T0 });
  await bindReferrer(store, { wallet: D, code: b.code, now: T0 });
  assert.equal((await changeReferrer(store, { wallet: B, code: d.code, now: T0 })).code, "CYCLE");
  assert.equal((await changeReferrer(store, { wallet: B, code: b.code, now: T0 })).code, "SELF_REFERRAL");
  assert.equal((await readRewardAccount(store, B)).referrerChanges, 0, "a refused change does not spend the one change");
});

test("binding in the moment of a trade counts that trade, never an earlier one", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, T0);
  /* The core's swap path: the trade settles, the carried code binds as of it, the trade is recorded. */
  const settled = "2026-10-01T10:00:00.000Z";
  assert.equal((await bindReferrer(store, { wallet: B, code: a.code, now: "2026-10-01T10:00:05.000Z", at: settled })).ok, true);
  assert.equal((await readRewardAccount(store, B)).referredAt, settled);
  await trade(store, "op-first", settled, "2026-10-01T10:00:06.000Z");
  assert.deepEqual((await listRewardEntries(store, A)).map((entry) => entry.type), ["REFERRAL_L1"]);

  /* A wallet that earned earlier cannot be bound back to before that. */
  const store2 = createMemoryGuardStore();
  const a2 = await ensureRewardAccount(store2, A, T0);
  await trade(store2, "op-earlier", "2026-10-01T09:00:00.000Z");
  assert.equal((await bindReferrer(store2, { wallet: B, code: a2.code, now: "2026-10-02T00:00:00.000Z", at: "2026-09-30T00:00:00.000Z" })).ok, true);
  assert.equal((await readRewardAccount(store2, B)).referredAt, "2026-10-02T00:00:00.000Z", "an `at` before the first earning falls back to now");
  await trade(store2, "op-earlier", "2026-10-01T09:00:00.000Z", "2026-10-02T01:00:00.000Z");
  assert.equal((await listRewardEntries(store2, A)).length, 0);

  /* An `at` more than ten minutes before the binding reaches nothing. */
  const store4 = createMemoryGuardStore();
  const a4 = await ensureRewardAccount(store4, A, T0);
  await bindReferrer(store4, { wallet: B, code: a4.code, now: "2026-10-01T11:00:00.000Z", at: "2026-10-01T10:49:59.999Z" });
  assert.equal((await readRewardAccount(store4, B)).referredAt, "2026-10-01T11:00:00.000Z");

  /* A future `at` is ignored too. */
  const store3 = createMemoryGuardStore();
  const a3 = await ensureRewardAccount(store3, A, T0);
  await bindReferrer(store3, { wallet: B, code: a3.code, now: T0, at: "2026-12-01T00:00:00.000Z" });
  assert.equal((await readRewardAccount(store3, B)).referredAt, T0);
});

test("first touch holds for the cookie's thirty days (the first valid link wins); a code without its moment is stale", () => {
  const now = Date.parse(T0);
  const day = 24 * 60 * 60 * 1000;
  assert.equal(carriedCodeHolds(String(now - 60_000), now), true);
  /* Until 29.10 a day was enough for a later link to take the binding; now it is the cookie's whole life. */
  assert.equal(carriedCodeHolds(String(now - day - 1), now), true);
  assert.equal(carriedCodeHolds(String(now - 30 * day + 1), now), true);
  assert.equal(carriedCodeHolds(String(now - 30 * day), now), false);
  assert.equal(carriedCodeHolds(undefined, now), false);
  assert.equal(carriedCodeHolds("junk", now), false);
  assert.equal(carriedCodeHolds(String(now + 60_000), now), false, "a moment from the future is not trusted");
});
