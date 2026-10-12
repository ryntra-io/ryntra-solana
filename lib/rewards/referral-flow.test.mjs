import assert from "node:assert/strict";
import test from "node:test";

import { accrueRewards } from "./accrue.ts";
import {
  bindReferrer,
  reconcileReferralEdges,
  ensureRewardAccount,
  listRewardEntries,
  markEarning,
  readRewardAccount,
  recordRewards,
  referralCounts,
  resolveReferralLevels,
  walletForCode,
} from "./ledger.ts";
import { maskCode, maskWallet, normalizeReferralCode } from "./referral.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const C = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const NOW = "2026-09-11T12:00:00.000Z";

test("an address is shown by its ends, never in full", () => {
  assert.equal(A, "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp");
  assert.equal(maskWallet(A), "6dNV…XbLp");
  assert.equal(maskCode("F8ZJMW8Q9HSB"), "F8ZJ…9HSB");
  /* The whole point: what is shown is not the address, and cannot be turned
     back into one. */
  assert.notEqual(maskWallet(A), A);
  assert.equal(maskWallet(A).length, 9);
  /* Something already short is left alone rather than padded into looking like
     a mask of something longer. */
  assert.equal(maskWallet("short"), "short");
});

test("a code resolves to its owner, and a wrong one to nobody", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  assert.equal(await walletForCode(store, a.code), A);
  assert.equal(await walletForCode(store, "BBBBBBBBBBBB"), null);
  /* What a person types is not what a link carries: case and dashes are noise. */
  assert.equal(normalizeReferralCode(` ${a.code.toLowerCase()} `), a.code);
  assert.equal(normalizeReferralCode("nope"), null);
});

test("the manual-test scenario: A invites B, B corrects the code, then confirms", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  const c = await ensureRewardAccount(store, C, NOW);
  await ensureRewardAccount(store, B, NOW);

  /* B opened C's link by mistake. Previewing it binds nothing: the whole point
     of the pending state is that looking is not choosing. */
  assert.equal(await walletForCode(store, c.code), C);
  assert.equal((await readRewardAccount(store, B)).referrer, null);

  /* B changes the code to A's. Still nothing written. */
  assert.equal(await walletForCode(store, a.code), A);
  assert.equal((await readRewardAccount(store, B)).referrer, null);

  /* B confirms. Only now is anything decided. */
  const bound = await bindReferrer(store, { wallet: B, code: a.code, now: NOW });
  assert.equal(bound.ok, true);
  assert.equal((await readRewardAccount(store, B)).referrer, A);

  /* B trades. A's direct referrals become one, and A sees an amount rather than
     anything about what B traded. */
  const gross = "5000000";
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", {
    basisPoints: 50, asset: USDC, symbol: "USDC", decimals: 6, amountRaw: gross, providerRetainedPercent: 20,
  });
  const fee = settleServiceFee(quoted, {
    collected: true,
    amountRaw: gross,
    settlement: {
      userPaidRaw: gross, providerRaw: "1000000", ryntraRaw: "4000000",
      asset: USDC, symbol: "USDC", decimals: 6,
      basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED", operationRef: "sig-b-1",
    },
  });
  const levels = await resolveReferralLevels(store, B);
  assert.deepEqual(levels, { l1: A, l2: null });
  const accrual = accrueRewards({
    fee, trader: B, referrerL1: levels.l1, referrerL2: levels.l2, settledAt: NOW, now: NOW, price: null,
  });
  const written = await recordRewards(store, accrual.entries, accrual.ref);
  for (const entry of written.created) await markEarning(store, entry.recipient, NOW);

  /* Counted on the confirmation above, not on this trade. */
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 0 });
});

test("after confirmation the inviter does not move, whatever is presented next", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  const c = await ensureRewardAccount(store, C, NOW);
  await ensureRewardAccount(store, B, NOW);

  assert.equal((await bindReferrer(store, { wallet: B, code: a.code, now: NOW })).ok, true);
  /* A second confirmation with a different code is refused, not applied. */
  const again = await bindReferrer(store, { wallet: B, code: c.code, now: NOW });
  assert.equal(again.ok, false);
  assert.equal(again.code, "ALREADY_REFERRED");
  assert.equal((await readRewardAccount(store, B)).referrer, A);

  /* Confirming the same inviter twice is not an error — a double-tap on the
     button must not read as a failure. */
  const idempotent = await bindReferrer(store, { wallet: B, code: a.code, now: NOW });
  assert.equal(idempotent.ok, true);
  assert.equal((await readRewardAccount(store, B)).referrer, A);
});

test("confirming your own link is refused before anything is written", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  const decision = await bindReferrer(store, { wallet: A, code: a.code, now: NOW });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "SELF_REFERRAL");
  assert.equal((await readRewardAccount(store, A)).referrer, null);
});

test("a wallet that started earning over seven days ago keeps the inviter it had, or none", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  await ensureRewardAccount(store, B, NOW);
  await markEarning(store, B, NOW);
  const decision = await bindReferrer(store, { wallet: B, code: a.code, now: "2026-09-19T12:00:00.000Z" });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "ALREADY_EARNING");
  assert.equal((await readRewardAccount(store, B)).referrer, null);
});

test("what a referrer is shown about their network is counts and their own money", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  await ensureRewardAccount(store, B, NOW);
  await bindReferrer(store, { wallet: B, code: a.code, now: NOW });

  const gross = "5000000";
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", {
    basisPoints: 50, asset: USDC, symbol: "USDC", decimals: 6, amountRaw: gross, providerRetainedPercent: 20,
  });
  const fee = settleServiceFee(quoted, {
    collected: true, amountRaw: gross,
    settlement: {
      userPaidRaw: gross, providerRaw: "1000000", ryntraRaw: "4000000",
      asset: USDC, symbol: "USDC", decimals: 6,
      basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED", operationRef: "sig-1",
    },
  });
  const accrual = accrueRewards({ fee, trader: B, referrerL1: A, referrerL2: null, settledAt: NOW, now: NOW, price: null });
  await recordRewards(store, accrual.entries, accrual.ref);

  const rows = await listRewardEntries(store, A);
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 0 });
  /* A's own rows carry the trader's address in their *source*, which is server
     side only — nothing that reaches a browser names another person's wallet,
     and nothing anywhere records what they traded or how much. */
  for (const row of rows) {
    assert.equal(row.recipient, A);
    assert.equal("volume" in row, false);
    assert.equal("counterparty" in row, false);
  }
});

test("a binding older than the counter repairs itself on the next read", async () => {
  const store = createMemoryGuardStore();
  /*
   * Production, exactly as it was found there. The old read path bound an
   * inviter silently while a page loaded, before counters existed: B's record
   * names A, A's figure says zero, and nothing indexes the graph by referrer —
   * so the attribution is real and uncountable.
   */
  await store.versioned("rewardAccounts").compareAndSet(A, null, {
    wallet: A, code: "F8ZJMW8Q9HSB", referrer: null, referredAt: null,
    createdAt: NOW, earning: false, version: 0,
  });
  await store.versioned("rewardAccounts").compareAndSet(B, null, {
    wallet: B, code: "BCDFGHJKLMNP", referrer: A, referredAt: NOW,
    createdAt: NOW, earning: false, version: 0,
  });
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 0, level2: 0 });

  /* B opens Rewards. Nothing is bound, nothing is confirmed; the edge is simply
     asserted, found missing, and counted. */
  await reconcileReferralEdges(store, B, NOW);
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 0 });

  /* And it cannot run away: the same read, twice more, adds nothing. */
  await reconcileReferralEdges(store, B, NOW);
  await reconcileReferralEdges(store, B, NOW);
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 0 });
  /* Neither does A's own read, which has no inviter of its own to assert. */
  await reconcileReferralEdges(store, A, NOW);
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 0 });
});

test("a confirmation counts once, whatever repairs run around it", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  await ensureRewardAccount(store, B, NOW);

  await bindReferrer(store, { wallet: B, code: a.code, now: NOW });
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 0 });

  /* The repair path runs on every read of B's page and must find nothing to do. */
  await reconcileReferralEdges(store, B, NOW);
  await bindReferrer(store, { wallet: B, code: a.code, now: NOW });
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 0 });
});

test("the second level repairs too, and never counts the wallet itself", async () => {
  const store = createMemoryGuardStore();
  const top = await ensureRewardAccount(store, A, NOW);
  const middle = await ensureRewardAccount(store, B, NOW);
  await ensureRewardAccount(store, C, NOW);
  await bindReferrer(store, { wallet: B, code: top.code, now: NOW });

  /* C was bound to B by the old silent path: real, uncounted. */
  const cRecord = await readRewardAccount(store, C);
  await store.versioned("rewardAccounts").compareAndSet(C, cRecord.version, {
    ...cRecord, referrer: B, referredAt: NOW, version: cRecord.version + 1,
  });
  assert.deepEqual(referralCounts(await readRewardAccount(store, B)), { level1: 0, level2: 0 });

  await reconcileReferralEdges(store, C, NOW);
  assert.deepEqual(referralCounts(await readRewardAccount(store, B)), { level1: 1, level2: 0 });
  /* A gains C at level two, on top of B at level one. */
  assert.deepEqual(referralCounts(await readRewardAccount(store, A)), { level1: 1, level2: 1 });
  assert.equal(middle.wallet, B);
});
