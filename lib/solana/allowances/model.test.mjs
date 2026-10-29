// Run from repo root: node --test lib/solana/allowances/model.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { allowanceNetworkFrom, allowanceNow, delegatorActions, limitIssues, periodNow, rentOf, PERIODS } from "./model.ts";

const W = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const D = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const SA = "69DhMffdnXh6qqRJ9GgyoCRotump5hw6jo72BP4YTrnk";
const header = { delegator: W, delegatee: D, payer: W, initId: 77n };
const authority = { state: "present", address: SA, initId: 77n, payer: W };
const tokenAccount = { state: "present", address: "ata", balanceRaw: 5_000_000n, delegate: SA, delegatedRaw: 18_446_744_073_709_551_615n, frozen: false };
const fixed = { kind: "fixed", address: "f", header, mint: "m", remainingRaw: 1_000_000n, expiryTs: 2_000n };

test("the network comes from the deployment's one variable; without it nothing is served", () => {
  assert.equal(allowanceNetworkFrom(undefined), null);
  assert.equal(allowanceNetworkFrom(""), null);
  assert.equal(allowanceNetworkFrom(" Devnet "), "devnet");
  assert.equal(allowanceNetworkFrom("mainnet-beta"), "mainnet");
  assert.equal(allowanceNetworkFrom("testnet"), null);
});

test("a period rolls forward the way the program rolls it (its own Rust cases)", () => {
  /* catch_up_at_exact_expiry_boundary: start 0, pulled 100, expiry 90, now 90 → start 60, pulled reset. */
  assert.deepEqual(periodNow(0n, 30n, 100n, 90n, 90n), { startTs: 60n, endTs: 90n, pulledRaw: 0n, started: true });
  /* boundary_before_expiry_advances_normally: now 35 → start 30. */
  assert.equal(periodNow(0n, 30n, 100n, 90n, 35n).startTs, 30n);
  /* fully_used_final_period_does_not_open_a_period_past_expiry: start 60 pulled 100, now 90 → stays. */
  assert.deepEqual(periodNow(60n, 30n, 100n, 90n, 90n), { startTs: 60n, endTs: 90n, pulledRaw: 100n, started: true });
  /* no_expiry_advances_to_floored_boundary: now 90 → start 90. */
  assert.equal(periodNow(0n, 30n, 100n, 0n, 90n).startTs, 90n);
  /* Not started yet. */
  assert.equal(periodNow(100n, 30n, 0n, 0n, 50n).started, false);
});

test("a fixed limit: active with the smallest of its room, the balance and the approval", () => {
  const now = allowanceNow(fixed, { authority, tokenAccount, now: 1_000n });
  assert.equal(now.status, "active");
  assert.equal(now.availableRaw, 1_000_000n);
  const poor = allowanceNow(fixed, { authority, tokenAccount: { ...tokenAccount, balanceRaw: 300n }, now: 1_000n });
  assert.equal(poor.availableRaw, 300n);
  assert.equal(poor.roomRaw, 1_000_000n);
});

test("past its end date a limit is expired the second after — not at — its last moment, as the program counts", () => {
  assert.equal(allowanceNow(fixed, { authority, tokenAccount, now: 2_000n }).status, "active");
  assert.equal(allowanceNow(fixed, { authority, tokenAccount, now: 2_001n }).status, "expired");
  assert.equal(allowanceNow({ ...fixed, remainingRaw: 0n }, { authority, tokenAccount, now: 1_000n }).status, "spent");
});

test("unknown is never active: a failed read of the authority or the token account says so", () => {
  assert.equal(allowanceNow(fixed, { authority: { state: "unread" }, tokenAccount, now: 1_000n }).status, "unknown");
  assert.equal(allowanceNow(fixed, { authority, tokenAccount: { state: "unread" }, now: 1_000n }).status, "unknown");
  assert.equal(allowanceNow(fixed, { authority, tokenAccount: { state: "unread" }, now: 1_000n }).availableRaw, null);
});

test("stopped and blocked: the authority closed or replaced, the approval taken by another app, a frozen account", () => {
  assert.equal(allowanceNow(fixed, { authority: { state: "absent" }, tokenAccount, now: 1_000n }).status, "stopped");
  assert.equal(allowanceNow(fixed, { authority: { ...authority, initId: 78n }, tokenAccount, now: 1_000n }).status, "stopped");
  assert.equal(allowanceNow(fixed, { authority, tokenAccount: { ...tokenAccount, delegate: D }, now: 1_000n }).status, "blocked");
  assert.equal(allowanceNow(fixed, { authority, tokenAccount: { ...tokenAccount, delegate: null, delegatedRaw: 0n }, now: 1_000n }).status, "blocked");
  assert.equal(allowanceNow(fixed, { authority, tokenAccount: { ...tokenAccount, frozen: true }, now: 1_000n }).status, "blocked");
  assert.equal(allowanceNow(fixed, { authority, tokenAccount: { state: "absent" }, now: 1_000n }).status, "blocked");
  /* Each blocked limit says why, so the page names the cause rather than one word for all. */
  const why = (account) => allowanceNow(fixed, { authority, tokenAccount: account, now: 1_000n }).blockedBy;
  assert.equal(why({ ...tokenAccount, delegate: D }), "approvalOther");
  assert.equal(why({ ...tokenAccount, delegate: null, delegatedRaw: 0n }), "approvalRevoked");
  assert.equal(why({ ...tokenAccount, delegatedRaw: 0n }), "approvalUsed");
  assert.equal(why({ ...tokenAccount, frozen: true }), "frozen");
  assert.equal(why({ state: "absent" }), "noAccount");
  assert.equal(why(tokenAccount), null);
});

test("a recurring limit counts this period only: a new period gives its whole amount again", () => {
  const recurring = { kind: "recurring", address: "r", header, mint: "m", periodStartTs: 1_000n, periodSeconds: 100n, expiryTs: 10_000n, perPeriodRaw: 500n, pulledInPeriodRaw: 400n };
  const inPeriod = allowanceNow(recurring, { authority, tokenAccount, now: 1_050n });
  assert.equal(inPeriod.availableRaw, 100n);
  assert.equal(inPeriod.spentInPeriodRaw, 400n);
  assert.equal(inPeriod.periodEndsAt, 1_100n);
  const next = allowanceNow(recurring, { authority, tokenAccount, now: 1_150n });
  assert.equal(next.availableRaw, 500n);
  assert.equal(next.spentInPeriodRaw, 0n);
  assert.equal(allowanceNow({ ...recurring, periodStartTs: 5_000n }, { authority, tokenAccount, now: 1_050n }).status, "scheduled");
});

test("a subscription: the plan decides; a cancelled one still lets the merchant take the rest of the paid period", () => {
  const sub = { kind: "subscription", address: "s", header: { ...header, delegatee: "plan" }, amountRaw: 10n, periodHours: 1n, createdAt: 5n, pulledInPeriodRaw: 4n, periodStartTs: 1_000n, expiresAtTs: 0n };
  const plan = { state: "present", address: "plan", owner: D, planId: 1n, mint: "m", active: true, endTs: 0n, amountRaw: 10n, periodHours: 1n, createdAt: 5n, destinations: [], pullers: [] };
  assert.equal(allowanceNow(sub, { authority, tokenAccount, plan, now: 1_100n }).availableRaw, 6n);
  const cancelled = allowanceNow({ ...sub, expiresAtTs: 4_600n }, { authority, tokenAccount, plan, now: 1_100n });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.availableRaw, 6n);
  assert.equal(allowanceNow({ ...sub, expiresAtTs: 1_100n }, { authority, tokenAccount, plan, now: 1_100n }).status, "ended");
  assert.equal(allowanceNow(sub, { authority, tokenAccount, plan: { state: "absent" }, now: 1_100n }).status, "ended");
  assert.equal(allowanceNow(sub, { authority, tokenAccount, plan: { ...plan, amountRaw: 11n }, now: 1_100n }).status, "ended");
  assert.equal(allowanceNow(sub, { authority, tokenAccount, plan: { state: "unread" }, now: 1_100n }).status, "unknown");
  /* Cancelled, but the plan not read: not known what the merchant may still take — unknown, with no amount. */
  const blind = allowanceNow({ ...sub, expiresAtTs: 4_600n }, { authority, tokenAccount, plan: { state: "unread" }, now: 1_100n });
  assert.equal(blind.status, "unknown");
  assert.equal(blind.availableRaw, null);
  assert.equal(allowanceNow(sub, { authority, tokenAccount, plan: { ...plan, endTs: 1_050n }, now: 1_100n }).status, "ended");
});

test("what the person may do: revoke a live limit, close a dead one; cancel a subscription, close it once over", () => {
  const live = allowanceNow(fixed, { authority, tokenAccount, now: 1_000n });
  assert.deepEqual(delegatorActions(fixed, live, 1_000n), ["revoke"]);
  const dead = allowanceNow(fixed, { authority, tokenAccount, now: 3_000n });
  assert.deepEqual(delegatorActions(fixed, dead, 3_000n), ["close"]);
  const sub = { kind: "subscription", address: "s", header, amountRaw: 1n, periodHours: 1n, createdAt: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, expiresAtTs: 0n };
  assert.deepEqual(delegatorActions(sub, live, 10n), ["cancel"]);
  assert.deepEqual(delegatorActions({ ...sub, expiresAtTs: 20n }, live, 10n), []);
  assert.deepEqual(delegatorActions({ ...sub, expiresAtTs: 20n }, live, 20n), ["close"]);
});

test("a draft: an address, an amount, a term between an hour and a year, a period no longer than the term", () => {
  const good = { kind: "fixed", wallet: W, delegatee: D, amountRaw: 1n, termSeconds: 86_400 };
  assert.deepEqual(limitIssues(good), []);
  assert.deepEqual(limitIssues({ ...good, delegatee: W }).map((i) => i.code), ["DELEGATEE_IS_SELF"]);
  assert.deepEqual(limitIssues({ ...good, delegatee: "nope" }).map((i) => i.code), ["DELEGATEE_ADDRESS"]);
  assert.deepEqual(limitIssues({ ...good, amountRaw: 0n }).map((i) => i.code), ["AMOUNT"]);
  assert.deepEqual(limitIssues({ ...good, termSeconds: 400 * 86_400 }).map((i) => i.code), ["TERM_RANGE"]);
  assert.deepEqual(limitIssues({ ...good, kind: "recurring", period: null }).map((i) => i.code), ["PERIOD"]);
  assert.deepEqual(limitIssues({ ...good, kind: "recurring", period: "month" }).map((i) => i.code), ["PERIOD_LONGER_THAN_TERM"]);
  assert.equal(PERIODS.month, 30 * 86_400);
});

test("rent by the program's account sizes, as its README lists it", () => {
  assert.equal(rentOf("fixed"), 2_192_400n);
  assert.equal(rentOf("recurring"), 2_359_440n);
  assert.equal(rentOf("subscription"), 1_969_680n);
});
