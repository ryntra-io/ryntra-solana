import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryGuardStore } from "../guard/store.ts";

const OWNER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SIGNATURE = "N3zXBD2bcRWyRh5bVxs2Tr1z6aWKoobLpTkkxRvoSCJCBZv9z5joMjayx4pPSCz5sGt1UyfLkTQthDLEtS8aVwJ";
const NOW = "2026-08-30T12:00:00.000Z";

async function subject() {
  try {
    return await import("./swap-owner-lock.ts");
  } catch {
    return {};
  }
}

function review(overrides = {}) {
  return {
    owner: OWNER,
    requestId: "req-1",
    messageDigest: "0x" + "a".repeat(64),
    reviewDigest: "0x" + "b".repeat(64),
    reviewExpiresAt: "2026-08-30T12:00:15.000Z",
    bundle: { exact: "bundle-1" },
    proof: { status: "SIGNED", digest: "0x" + "b".repeat(64) },
    at: NOW,
    ...overrides,
  };
}

test("one owner holds one live Review across tabs and requestIds: the next order replaces an unsigned one (SOL-S1)", async () => {
  const subjectModule = await subject();
  assert.equal(typeof subjectModule.reserveSwapOwnerReview, "function");
  const store = createMemoryGuardStore();
  const first = await subjectModule.reserveSwapOwnerReview({ store, ...review() });
  assert.equal(first.ok, true);
  const second = await subjectModule.reserveSwapOwnerReview({
    store,
    ...review({ requestId: "req-2", messageDigest: "0x" + "c".repeat(64) }),
  });
  assert.equal(second.ok, true);
  assert.equal(second.record.requestId, "req-2");
  assert.equal(second.record.state, "REVIEW_ISSUED");
  assert.equal(second.record.version, first.record.version + 1);
  /* one slot, one Review: the first is gone and nothing of it was archived — it had no signature */
  const read = await subjectModule.readSwapOwnerLock({ store, owner: OWNER });
  assert.equal(read.record.requestId, "req-2");
});

test("a replaced Review's signature is refused before any send; the fresh one's is claimed", async () => {
  const subjectModule = await subject();
  const store = createMemoryGuardStore();
  await subjectModule.reserveSwapOwnerReview({ store, ...review() });
  await subjectModule.reserveSwapOwnerReview({ store, ...review({ requestId: "req-2", messageDigest: "0x" + "c".repeat(64) }) });
  const late = await subjectModule.claimSwapOwnerSignature({
    store,
    owner: OWNER,
    requestId: "req-1",
    messageDigest: "0x" + "a".repeat(64),
    reviewDigest: "0x" + "b".repeat(64),
    signature: SIGNATURE,
    at: "2026-08-30T12:00:05.000Z",
  });
  assert.equal(late.ok, false);
  assert.equal(late.code, "OWNER_SWAP_LOCK_MISMATCH");
  assert.match(late.reason, /replaced/);
  const fresh = await subjectModule.claimSwapOwnerSignature({
    store,
    owner: OWNER,
    requestId: "req-2",
    messageDigest: "0x" + "c".repeat(64),
    reviewDigest: "0x" + "b".repeat(64),
    signature: SIGNATURE,
    at: "2026-08-30T12:00:06.000Z",
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.record.state, "SIGNED");
});

test("a claim and a replacement racing on one version: exactly one wins, and a won claim is never replaced", async () => {
  const subjectModule = await subject();
  for (const claimFirst of [true, false]) {
    const store = createMemoryGuardStore();
    await subjectModule.reserveSwapOwnerReview({ store, ...review() });
    const claim = () => subjectModule.claimSwapOwnerSignature({
      store,
      owner: OWNER,
      requestId: "req-1",
      messageDigest: "0x" + "a".repeat(64),
      reviewDigest: "0x" + "b".repeat(64),
      signature: SIGNATURE,
      at: "2026-08-30T12:00:05.000Z",
    });
    const replace = () => subjectModule.reserveSwapOwnerReview({ store, ...review({ requestId: "req-2", messageDigest: "0x" + "c".repeat(64) }) });
    const [claimed, replaced] = claimFirst ? [await claim(), await replace()] : await Promise.all([claim(), replace()]).then(([a, b]) => [a, b]);
    assert.notEqual(claimed.ok, replaced.ok, `claimFirst=${claimFirst}: one and only one wins`);
    const read = await subjectModule.readSwapOwnerLock({ store, owner: OWNER });
    if (claimed.ok) {
      assert.equal(read.record.state, "SIGNED");
      assert.equal(read.record.signature, SIGNATURE);
      assert.equal(replaced.code, "OWNER_SWAP_LOCKED");
    } else {
      assert.equal(read.record.requestId, "req-2");
      assert.equal(read.record.signature, null);
    }
  }
});

test("an unsigned Review is replaceable; a signature the server holds is not", async () => {
  const subjectModule = await subject();
  assert.equal(subjectModule.isSwapOwnerReviewReplaceable({ state: "REVIEW_ISSUED", signature: null }), true);
  assert.equal(subjectModule.isSwapOwnerReviewReplaceable({ state: "REVIEW_ISSUED", signature: SIGNATURE }), false);
  for (const state of ["SIGNED", "SUBMITTED_UNKNOWN", "EXPIRED_BEFORE_SUBMIT", "RECEIPTED"]) {
    assert.equal(subjectModule.isSwapOwnerReviewReplaceable({ state, signature: SIGNATURE }), false, state);
  }
});

test("a server-known signature needs explicit exact-blockhash expiry; an owner-cancelled Review frees the slot", async () => {
  const subjectModule = await subject();
  const unsignedStore = createMemoryGuardStore();
  assert.equal((await subjectModule.reserveSwapOwnerReview({ store: unsignedStore, ...review() })).ok, true);
  const ownerCancelledAfterExpiry = await subjectModule.expireUnclaimedSwapOwnerReview({
    store: unsignedStore,
    owner: OWNER,
    requestId: "req-1",
    at: "2026-08-30T12:02:00.000Z",
  });
  assert.equal(ownerCancelledAfterExpiry.ok, true);
  assert.equal(ownerCancelledAfterExpiry.record.state, "EXPIRED_BEFORE_SUBMIT");
  assert.equal((await subjectModule.reserveSwapOwnerReview({
    store: unsignedStore,
    ...review({ requestId: "req-owner-cancelled", at: "2026-08-30T12:02:01.000Z" }),
  })).ok, true);
  const store = createMemoryGuardStore();
  const afterExpiry = await subjectModule.reserveSwapOwnerReview({
    store,
    ...review({
      requestId: "req-2",
      messageDigest: "0x" + "c".repeat(64),
      at: "2026-08-30T12:00:17.000Z",
      reviewExpiresAt: "2026-08-30T12:00:32.000Z",
    }),
  });
  assert.equal(afterExpiry.ok, true);
  assert.equal(afterExpiry.record.requestId, "req-2");
  assert.equal((await subjectModule.claimSwapOwnerSignature({
    store,
    owner: OWNER,
    requestId: "req-2",
    messageDigest: "0x" + "c".repeat(64),
    reviewDigest: "0x" + "b".repeat(64),
    signature: SIGNATURE,
    at: "2026-08-30T12:00:18.000Z",
  })).ok, true);
  const afterSignature = await subjectModule.reserveSwapOwnerReview({
    store,
    ...review({
      requestId: "req-3",
      at: "2026-08-30T12:01:00.000Z",
      reviewExpiresAt: "2026-08-30T12:01:15.000Z",
    }),
  });
  assert.equal(afterSignature.ok, false);
  assert.equal(afterSignature.record.state, "SIGNED");
  assert.equal(afterSignature.record.signature, SIGNATURE);
  const expired = await subjectModule.expireSwapOwnerSignature({
    store,
    owner: OWNER,
    signature: SIGNATURE,
    at: "2026-08-30T12:02:00.000Z",
  });
  assert.equal(expired.ok, true);
  assert.equal(expired.record.state, "EXPIRED_BEFORE_SUBMIT");
  const afterExpiryProof = await subjectModule.reserveSwapOwnerReview({
    store,
    ...review({ requestId: "req-3", at: "2026-08-30T12:02:01.000Z", reviewExpiresAt: "2026-08-30T12:02:16.000Z" }),
  });
  assert.equal(afterExpiryProof.ok, true);
});

test("durable recovery returns the issuer-bound server bundle and completes without releasing the lock", async () => {
  const subjectModule = await subject();
  const store = createMemoryGuardStore();
  await subjectModule.reserveSwapOwnerReview({ store, ...review() });
  await subjectModule.claimSwapOwnerSignature({
    store,
    owner: OWNER,
    requestId: "req-1",
    messageDigest: "0x" + "a".repeat(64),
    reviewDigest: "0x" + "b".repeat(64),
    signature: SIGNATURE,
    at: "2026-08-30T12:00:01.000Z",
  });
  await subjectModule.markSwapOwnerSubmitted({
    store,
    owner: OWNER,
    signature: SIGNATURE,
    submissionLane: "ADOPTED_RPC",
    at: "2026-08-30T12:00:02.000Z",
  });
  const recovery = await subjectModule.readSwapOwnerRecovery({ store, owner: OWNER, signature: SIGNATURE });
  assert.equal(recovery.ok, true);
  assert.deepEqual(recovery.record.bundle, { exact: "bundle-1" });
  assert.equal(recovery.record.state, "SUBMITTED_UNKNOWN");
  assert.equal(recovery.record.submissionLane, "ADOPTED_RPC");
  const done = await subjectModule.completeSwapOwnerLock({
    store,
    owner: OWNER,
    signature: SIGNATURE,
    state: "RECEIPTED",
    receiptHash: "0x" + "d".repeat(64),
    receipt: { schema: "signed-receipt", contentHash: "0x" + "d".repeat(64) },
    at: "2026-08-30T12:00:03.000Z",
  });
  assert.equal(done.ok, true);
  assert.deepEqual(done.record.receipt, { schema: "signed-receipt", contentHash: "0x" + "d".repeat(64) });

  /* A receipted swap is history, not a lock. Holding it shut turned "one swap
     at a time" into one swap per wallet ever; the next Review replaces it, and
     the settled record's own Receipt stays in the durable ledger. */
  const next = await subjectModule.reserveSwapOwnerReview({
    store,
    ...review({ requestId: "req-4", at: "2026-08-30T13:00:00.000Z" }),
  });
  assert.equal(next.ok, true);
  assert.equal(next.record.state, "REVIEW_ISSUED");
  assert.equal(next.record.requestId, "req-4");
  assert.equal(next.record.signature, null);
});

test("an unresolved signature still holds the wallet; only settled states are replaced", async () => {
  const subjectModule = await subject();
  const store = createMemoryGuardStore();
  await subjectModule.reserveSwapOwnerReview({ store, ...review() });
  await subjectModule.claimSwapOwnerSignature({
    store,
    owner: OWNER,
    requestId: "req-1",
    messageDigest: "0x" + "a".repeat(64),
    reviewDigest: "0x" + "b".repeat(64),
    signature: SIGNATURE,
    at: "2026-08-30T12:00:01.000Z",
  });

  const whileSigned = await subjectModule.reserveSwapOwnerReview({
    store,
    ...review({ requestId: "req-5", at: "2026-08-30T13:00:00.000Z" }),
  });
  assert.equal(whileSigned.ok, false);
  assert.equal(whileSigned.record.state, "SIGNED");

  await subjectModule.markSwapOwnerSubmitted({ store, owner: OWNER, signature: SIGNATURE, at: "2026-08-30T12:00:02.000Z" });
  const whileUnknown = await subjectModule.reserveSwapOwnerReview({
    store,
    ...review({ requestId: "req-6", at: "2026-08-30T13:00:00.000Z" }),
  });
  assert.equal(whileUnknown.ok, false);
  assert.equal(whileUnknown.record.state, "SUBMITTED_UNKNOWN");

  await subjectModule.completeSwapOwnerLock({
    store,
    owner: OWNER,
    signature: SIGNATURE,
    state: "FAILED",
    at: "2026-08-30T12:00:04.000Z",
  });
  const afterFailure = await subjectModule.reserveSwapOwnerReview({
    store,
    ...review({ requestId: "req-7", at: "2026-08-30T13:00:00.000Z" }),
  });
  assert.equal(afterFailure.ok, true);
  assert.equal(afterFailure.record.requestId, "req-7");
});

test("order admission recognises every terminal owner-lock state", async () => {
  const subjectModule = await subject();
  assert.equal(typeof subjectModule.isSwapOwnerLockSettled, "function");

  for (const state of ["EXPIRED_BEFORE_SUBMIT", "EXPIRED_AFTER_SUBMIT", "FAILED", "RECEIPTED"]) {
    assert.equal(subjectModule.isSwapOwnerLockSettled(state), true, `${state} must not block the next order`);
  }
  for (const state of ["REVIEW_ISSUED", "SIGNED", "SUBMITTED_UNKNOWN"]) {
    assert.equal(subjectModule.isSwapOwnerLockSettled(state), false, `${state} must keep the owner lock`);
  }
});

test("reusing the owner slot archives the settled swap instead of destroying it", async () => {
  /*
   * The slot is keyed by owner, so the next Review overwrites the last one —
   * and the last one held the only durable copy of that swap's Receipt, bundle
   * and proof. Making settled locks replaceable without moving them first
   * traded a completed swap's evidence for the next one's.
   */
  const subjectModule = await subject();
  const store = createMemoryGuardStore();
  await subjectModule.reserveSwapOwnerReview({ store, ...review() });
  await subjectModule.claimSwapOwnerSignature({
    store,
    owner: OWNER,
    requestId: "req-1",
    messageDigest: "0x" + "a".repeat(64),
    reviewDigest: "0x" + "b".repeat(64),
    signature: SIGNATURE,
    at: "2026-08-30T12:00:01.000Z",
  });
  await subjectModule.markSwapOwnerSubmitted({ store, owner: OWNER, signature: SIGNATURE, at: "2026-08-30T12:00:02.000Z" });
  await subjectModule.completeSwapOwnerLock({
    store,
    owner: OWNER,
    signature: SIGNATURE,
    state: "RECEIPTED",
    receiptHash: "0x" + "d".repeat(64),
    receipt: { schema: "signed-receipt", contentHash: "0x" + "d".repeat(64) },
    at: "2026-08-30T12:00:03.000Z",
  });

  const next = await subjectModule.reserveSwapOwnerReview({
    store,
    ...review({ requestId: "req-9", at: "2026-08-30T13:00:00.000Z" }),
  });
  assert.equal(next.ok, true, "a settled swap must not block the next one");

  /* The owner slot now holds the new Review, and the finished swap is still
     recoverable by the signature that identifies it. */
  const recovered = await subjectModule.readSwapOwnerRecovery({ store, owner: OWNER, signature: SIGNATURE });
  assert.equal(recovered.ok, true, "the completed swap's record was destroyed by the next Review");
  assert.equal(recovered.record.state, "RECEIPTED");
  assert.deepEqual(recovered.record.receipt, { schema: "signed-receipt", contentHash: "0x" + "d".repeat(64) });
  assert.deepEqual(recovered.record.bundle, { exact: "bundle-1" });
});
