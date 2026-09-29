import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { cctpBurnIntentDigest, evmMintRecipient } from "./cctp-burn.ts";
import {
  cctpBurnClaimKey,
  cctpBurnRecovery,
  claimCctpBurn,
  markCctpAttested,
  markCctpBurnConfirmed,
  markCctpBurnNeverBroadcast,
  markCctpBurnReverted,
  markCctpBurnSubmitted,
  markCctpSourceArmed,
  markCctpMintObserved,
  markCctpReceipted,
  readCctpBurnClaim,
  withCctpBurnBoundary,
} from "./cctp-burn-claim.ts";

const OWNER = "JCjADc5byJNFhPKeK3H39NWfsiKnXwYCKpN8fxkTL1vL";
const TOKEN_ACCOUNT = "4bC9xvLWmNjJt2yF8sGqK1RhZ7Pd3TnUeA6WkYcXbQ5m";
const BASE_RECIPIENT = "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401";
const REVIEW = `0x${"a".repeat(64)}`;
const OTHER_REVIEW = `0x${"b".repeat(64)}`;
const SIGNATURE = `4TX1LSCt597YZVzT${"z".repeat(48)}`;
const OTHER_SIGNATURE = `4kTpQwErTyUiOpAs${"y".repeat(48)}`;
const NONCE = `0x${"c".repeat(64)}`;
const MINT_TX = `0x${"d".repeat(64)}`;
const RECEIPT = `0x${"e".repeat(64)}`;
const AT = "2026-09-01T12:00:00.000Z";

/** The intent that decides identity: who, how much, to whom, which domain. */
const intent = (overrides = {}) => ({
  direction: "SOLANA_TO_BASE",
  sourceDomain: 5,
  owner: OWNER,
  burnTokenAccount: TOKEN_ACCOUNT,
  amountRaw: "2000000",
  destinationDomain: 6,
  mintRecipient: evmMintRecipient(BASE_RECIPIENT),
  minFinalityThreshold: 2000,
  ...overrides,
});

const DIGEST = cctpBurnIntentDigest(intent());

const claim = (store, overrides = {}) =>
  claimCctpBurn({ store, network: "mainnet", intentDigest: DIGEST, reviewDigest: REVIEW, at: AT, ...overrides });

test("the key is the intent, not the bytes — the whole reason this module exists", () => {
  /* A rebuilt burn has a new blockhash, a new ephemeral MessageSent account and
     a new fee payer, so it has different bytes and a different signature. The
     Send lane's signature-keyed boundary would let it straight through, and on
     a cross-chain burn that is the same money leaving twice with nothing on
     this side to undo it. */
  assert.equal(cctpBurnIntentDigest(intent()), DIGEST, "the same intent is the same claim");
  assert.notEqual(cctpBurnIntentDigest(intent({ amountRaw: "2000001" })), DIGEST);
  assert.notEqual(cctpBurnIntentDigest(intent({ destinationDomain: 0 })), DIGEST);
  assert.notEqual(cctpBurnIntentDigest(intent({ minFinalityThreshold: 1000 })), DIGEST);
  assert.notEqual(
    cctpBurnIntentDigest(intent({ mintRecipient: evmMintRecipient("0x6fb44943f254356d5905536cea13474a37322b55") })),
    DIGEST,
  );
  assert.equal(cctpBurnClaimKey("mainnet", DIGEST), `mainnet:${DIGEST}`);
});

test("a first claim reserves, and an identical repeat is a duplicate rather than a failure", async () => {
  const store = createMemoryGuardStore();
  const first = await claim(store);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.record.state, "RESERVED");
  assert.equal(first.record.attempt, 1);
  assert.equal(first.duplicate, undefined);

  const again = await claim(store);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.duplicate, true, "a retried request must not fail before the boundary");
  assert.equal(again.record.attempt, 1);
});

test("a different Review over the same intent is a conflict", async () => {
  const store = createMemoryGuardStore();
  await claim(store);
  const conflicting = await claim(store, { reviewDigest: OTHER_REVIEW });
  assert.equal(conflicting.ok, false);
  if (conflicting.ok) return;
  assert.equal(conflicting.code, "CCTP_BURN_CLAIM_CONFLICT");
});

test("once the boundary is crossed, a second claim is refused with the record attached", async () => {
  const store = createMemoryGuardStore();
  await claim(store);
  await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: DIGEST, signature: SIGNATURE, at: AT });

  const second = await claim(store);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "CCTP_BURN_ALREADY_STARTED");
  assert.match(second.reason, /A second burn is never a recovery action/);
  assert.equal(second.record?.burnSignature, SIGNATURE, "the caller can show what exists instead of asking again");
});

test("no state that may have moved value can be claimed again", async () => {
  for (const advance of [
    async (store) => {
      await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: DIGEST, signature: SIGNATURE, at: AT });
    },
    async (store) => {
      await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: DIGEST, signature: SIGNATURE, at: AT });
      await markCctpBurnConfirmed({ store, network: "mainnet", intentDigest: DIGEST, at: AT });
    },
    async (store) => {
      await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: DIGEST, signature: SIGNATURE, at: AT });
      await markCctpBurnConfirmed({ store, network: "mainnet", intentDigest: DIGEST, at: AT });
      await markCctpAttested({ store, network: "mainnet", intentDigest: DIGEST, messageNonce: NONCE, at: AT });
    },
  ]) {
    const store = createMemoryGuardStore();
    await claim(store);
    await advance(store);
    const second = await claim(store);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CCTP_BURN_ALREADY_STARTED");
  }
});

test("the whole happy lifecycle records what it is bound to", async () => {
  const store = createMemoryGuardStore();
  await claim(store);
  await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: DIGEST, signature: SIGNATURE, at: AT });
  await markCctpBurnConfirmed({ store, network: "mainnet", intentDigest: DIGEST, at: AT });
  await markCctpAttested({ store, network: "mainnet", intentDigest: DIGEST, messageNonce: NONCE, at: AT });
  await markCctpMintObserved({ store, network: "mainnet", intentDigest: DIGEST, mintTransactionHash: MINT_TX, at: AT });
  const receipted = await markCctpReceipted({ store, network: "mainnet", intentDigest: DIGEST, receiptHash: RECEIPT, at: AT });

  assert.equal(receipted.ok, true);
  if (!receipted.ok) return;
  assert.equal(receipted.record.state, "RECEIPTED");
  assert.equal(receipted.record.burnSignature, SIGNATURE);
  assert.equal(receipted.record.messageNonce, NONCE);
  assert.equal(receipted.record.mintTransactionHash, MINT_TX);
  assert.equal(receipted.record.receiptHash, RECEIPT);
  assert.deepEqual(
    receipted.record.trail.map((entry) => entry.state),
    ["RESERVED", "BURN_SUBMITTED_UNKNOWN", "BURN_CONFIRMED", "ATTESTED", "MINT_OBSERVED", "RECEIPTED"],
  );
});

test("states cannot be skipped: a mint cannot be recorded before an attestation", async () => {
  const store = createMemoryGuardStore();
  await claim(store);
  const early = await markCctpMintObserved({
    store,
    network: "mainnet",
    intentDigest: DIGEST,
    mintTransactionHash: MINT_TX,
    at: AT,
  });
  assert.equal(early.ok, false);
  if (early.ok) return;
  assert.equal(early.code, "CCTP_BURN_TRANSITION_REFUSED");
});

test("a reverted burn is the only door back, and it needs the signature that proves it", async () => {
  const store = createMemoryGuardStore();
  await claim(store);
  await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: DIGEST, signature: SIGNATURE, at: AT });

  const reverted = await markCctpBurnReverted({
    store,
    network: "mainnet",
    intentDigest: DIGEST,
    signature: SIGNATURE,
    at: AT,
  });
  assert.equal(reverted.ok, true);
  if (!reverted.ok) return;
  assert.equal(reverted.record.state, "BURN_REVERTED");
  assert.equal(cctpBurnRecovery(reverted.record).burnAgainPermitted, true);

  /* The record is not replaced. The attempt counter moves and the trail keeps
     the reverted attempt where anyone can see it. */
  const again = await claim(store, { reviewDigest: OTHER_REVIEW });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.record.state, "RESERVED");
  assert.equal(again.record.attempt, 2);
  assert.equal(again.record.burnSignature, null, "the new attempt starts with no burn of its own");
  assert.equal(again.record.trail.some((entry) => entry.state === "BURN_REVERTED"), true);
});

test("a burn Circle has already attested can never be called reverted", async () => {
  /* The chain refutes it. Once a message is signed the burn provably
     succeeded, and the only reason to want this transition is to unlock a
     second burn. */
  const store = createMemoryGuardStore();
  await claim(store);
  await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: DIGEST, signature: SIGNATURE, at: AT });
  await markCctpBurnConfirmed({ store, network: "mainnet", intentDigest: DIGEST, at: AT });
  await markCctpAttested({ store, network: "mainnet", intentDigest: DIGEST, messageNonce: NONCE, at: AT });

  const lie = await markCctpBurnReverted({
    store,
    network: "mainnet",
    intentDigest: DIGEST,
    signature: SIGNATURE,
    at: AT,
  });
  assert.equal(lie.ok, false);
  if (lie.ok) return;
  assert.equal(lie.code, "CCTP_BURN_TRANSITION_REFUSED");
});

test("a record that will not parse is never read as an empty slot", async () => {
  const store = createMemoryGuardStore();
  await store.collection("solanaCctpBurns").set(cctpBurnClaimKey("mainnet", DIGEST), { shape: "from a later version" });

  const read = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: DIGEST });
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.code, "CCTP_BURN_CLAIM_UNAVAILABLE");
  assert.match(read.reason, /Nothing may be burned while that is unknown/);

  const blocked = await claim(store);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, "CCTP_BURN_CLAIM_UNAVAILABLE");
});

test("the boundary crosses once and refuses a second crossing in the same burn", async () => {
  const store = createMemoryGuardStore();
  let crossings = 0;
  const outcome = await withCctpBurnBoundary({
    store,
    network: "mainnet",
    intentDigest: DIGEST,
    reviewDigest: REVIEW,
    burn: async ({ beforeBurn }) => {
      await beforeBurn(SIGNATURE);
      crossings += 1;
      await assert.rejects(() => beforeBurn(OTHER_SIGNATURE), /may be crossed only once/);
      return { ok: true, signature: SIGNATURE };
    },
    onAlreadyStarted: () => ({ ok: false, code: "UNEXPECTED", reason: "", signature: null }),
    onFailure: (failure) => ({ ok: false, ...failure }),
  });
  assert.deepEqual(outcome, { ok: true, signature: SIGNATURE });
  assert.equal(crossings, 1);
});

test("a failure before the boundary expires the claim and says so", async () => {
  const store = createMemoryGuardStore();
  const outcome = await withCctpBurnBoundary({
    store,
    network: "mainnet",
    intentDigest: DIGEST,
    reviewDigest: REVIEW,
    burn: async () => {
      throw new Error("the wallet was closed");
    },
    onAlreadyStarted: () => ({ ok: false, code: "UNEXPECTED", reason: "", signature: null }),
    onFailure: (failure) => ({ ok: false, ...failure }),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "CCTP_BURN_FAILED_BEFORE_BOUNDARY");
  assert.equal(outcome.signature, null);

  const read = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: DIGEST });
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.record.state, "EXPIRED_BEFORE_BURN");
  assert.equal(cctpBurnRecovery(read.record).burnAgainPermitted, true, "these bytes provably never left");
});

test("a failure after the boundary holds the claim and hands back the signature to read", async () => {
  const store = createMemoryGuardStore();
  const outcome = await withCctpBurnBoundary({
    store,
    network: "mainnet",
    intentDigest: DIGEST,
    reviewDigest: REVIEW,
    burn: async ({ beforeBurn }) => {
      await beforeBurn(SIGNATURE);
      throw new Error("the connection dropped mid-broadcast");
    },
    onAlreadyStarted: () => ({ ok: false, code: "UNEXPECTED", reason: "", signature: null }),
    onFailure: (failure) => ({ ok: false, ...failure }),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "CCTP_BURN_UNKNOWN");
  assert.equal(outcome.signature, SIGNATURE);
  assert.match(outcome.reason, /A second burn is never a recovery action/);

  const read = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: DIGEST });
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.record.state, "RECOVERY_REQUIRED");
  assert.equal(cctpBurnRecovery(read.record).burnAgainPermitted, false);
});

test("a second run of the boundary after a crossed burn never reaches the burn callback", async () => {
  const store = createMemoryGuardStore();
  await claim(store);
  await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: DIGEST, signature: SIGNATURE, at: AT });

  let burnCalled = false;
  const outcome = await withCctpBurnBoundary({
    store,
    network: "mainnet",
    intentDigest: DIGEST,
    reviewDigest: REVIEW,
    burn: async () => {
      burnCalled = true;
      return { ok: true };
    },
    onAlreadyStarted: (record) => ({ ok: false, code: "ALREADY", reason: record.state, signature: record.burnSignature }),
    onFailure: (failure) => ({ ok: false, ...failure }),
  });
  assert.equal(burnCalled, false, "the burn callback is the one place a transaction is built");
  assert.equal(outcome.code, "ALREADY");
  assert.equal(outcome.reason, "BURN_SUBMITTED_UNKNOWN");
});

test("every recovery answer states where the value is, and only two permit burning again", () => {
  const seen = new Set();
  const base = {
    version: 0,
    network: "mainnet",
    intentDigest: DIGEST,
    reviewDigest: REVIEW,
    attempt: 1,
    burnSignature: null,
    messageNonce: null,
    mintTransactionHash: null,
    receiptHash: null,
    reservedAt: AT,
    updatedAt: AT,
    trail: [],
  };
  const permitted = [];
  for (const state of [
    "RESERVED",
    "BURN_SUBMITTED_UNKNOWN",
    "BURN_CONFIRMED",
    "ATTESTED",
    "MINT_OBSERVED",
    "RECEIPTED",
    "EXPIRED_BEFORE_BURN",
    "RECOVERY_REQUIRED",
    "BURN_REVERTED",
  ]) {
    const recovery = cctpBurnRecovery({ ...base, state });
    assert.ok(recovery.action.length > 0, state);
    assert.ok(recovery.whereValueIs.length > 0, state);
    seen.add(state);
    if (recovery.burnAgainPermitted) permitted.push(state);
  }
  assert.equal(seen.size, 9, "every state answers");
  assert.deepEqual(
    permitted.sort(),
    ["BURN_REVERTED", "EXPIRED_BEFORE_BURN"],
    "both mean the money never left; nothing else may burn again",
  );
});

/**
 * The reverse lane's two additions, and why each of them is narrow.
 *
 * An EVM wallet signs and broadcasts in one call, so the boundary has to be
 * crossed before the wallet opens. That trades an inconvenience — a claim held
 * for a burn that never happened — against a second real burn, and only one of
 * those is recoverable. `markCctpBurnNeverBroadcast` is the way back and it
 * turns on evidence read from the chain rather than on anyone's account of what
 * happened.
 */
test("a legacy record with no direction reads as the lane that was the only one", async function () {
  const store = createMemoryGuardStore();
  const digest = cctpBurnIntentDigest(intent());
  /* Written the way a record was written before the lane had two directions:
     no direction, no source account, no destination wallet. */
  await store.versioned("solanaCctpBurns").compareAndSet(cctpBurnClaimKey("mainnet", digest), null, {
    version: 0,
    network: "mainnet",
    intentDigest: digest,
    reviewDigest: REVIEW,
    state: "RECEIPTED",
    attempt: 1,
    burnSignature: SIGNATURE,
    messageNonce: NONCE,
    mintTransactionHash: MINT_TX,
    receiptHash: RECEIPT,
    reservedAt: AT,
    updatedAt: AT,
    trail: [{ state: "RESERVED", at: AT, attempt: 1 }],
  });

  const read = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: digest });
  assert.equal(read.ok, true, "a record written before the schema moved must still parse");
  if (!read.ok) return;
  assert.equal(read.record.direction, "SOLANA_TO_BASE");
  assert.equal(read.record.sourceAccount, null);
  assert.equal(read.record.canaryIdempotencyKey, null);
  /* And it is still terminal. A schema change must not reopen a settled burn. */
  assert.equal(cctpBurnRecovery(read.record).burnAgainPermitted, false);
});

test("an armed EVM burn is released only when the chain says nothing left the account", async function () {
  const store = createMemoryGuardStore();
  const digest = cctpBurnIntentDigest(intent({ direction: "BASE_TO_SOLANA", sourceDomain: 6 }));
  const account = "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401";

  const claimed = await claimCctpBurn({
    store,
    network: "mainnet",
    direction: "BASE_TO_SOLANA",
    intentDigest: digest,
    reviewDigest: REVIEW,
    sourceAccount: account,
    sourceAccountNonce: "41",
    at: AT,
  });
  assert.equal(claimed.ok, true);

  const armed = await markCctpSourceArmed({
    store,
    network: "mainnet",
    intentDigest: digest,
    sourceAccount: account,
    sourceAccountNonce: "41",
    destinationWallet: OWNER,
    canaryIdempotencyKey: null,
  });
  assert.equal(armed.ok, true);
  if (!armed.ok) return;
  assert.equal(armed.record.state, "BURN_SUBMITTED_UNKNOWN");
  assert.equal(armed.record.burnSignature, null);

  /* The account has moved on. Something was sent, and the claim stays held. */
  const refused = await markCctpBurnNeverBroadcast({ store, network: "mainnet", intentDigest: digest, observedNonce: "42" });
  assert.equal(refused.ok, false);
  const stillHeld = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: digest });
  assert.equal(stillHeld.ok && stillHeld.record.state, "BURN_SUBMITTED_UNKNOWN");

  /* Unchanged. Nothing left the account, so the claim may be given back. */
  const released = await markCctpBurnNeverBroadcast({ store, network: "mainnet", intentDigest: digest, observedNonce: "41" });
  assert.equal(released.ok, true);
  if (!released.ok) return;
  assert.equal(released.record.state, "EXPIRED_BEFORE_BURN");
  assert.equal(cctpBurnRecovery(released.record).burnAgainPermitted, true);
});

test("a transfer that already has a transaction can never be released, whatever the count says", async function () {
  const store = createMemoryGuardStore();
  const digest = cctpBurnIntentDigest(intent({ direction: "BASE_TO_SOLANA", sourceDomain: 6 }));
  await claimCctpBurn({
    store,
    network: "mainnet",
    direction: "BASE_TO_SOLANA",
    intentDigest: digest,
    reviewDigest: REVIEW,
    sourceAccount: "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401",
    sourceAccountNonce: "41",
    at: AT,
  });
  await markCctpSourceArmed({
    store,
    network: "mainnet",
    intentDigest: digest,
    sourceAccount: "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401",
    sourceAccountNonce: "41",
  });
  await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: digest, signature: MINT_TX });

  const refused = await markCctpBurnNeverBroadcast({ store, network: "mainnet", intentDigest: digest, observedNonce: "41" });
  assert.equal(refused.ok, false, "a recorded transaction outranks any nonce comparison");
});

test("the recovery sentence names the chain the money actually left", async function () {
  const store = createMemoryGuardStore();
  const forward = cctpBurnIntentDigest(intent());
  const reverse = cctpBurnIntentDigest(intent({ direction: "BASE_TO_SOLANA", sourceDomain: 6 }));
  assert.notEqual(forward, reverse, "two directions are never the same claim");

  for (const [direction, expected] of [
    ["SOLANA_TO_BASE", /ON_SOLANA$/],
    ["BASE_TO_SOLANA", /ON_BASE$/],
  ]) {
    const digest = direction === "SOLANA_TO_BASE" ? forward : reverse;
    await claimCctpBurn({ store, network: "mainnet", direction, intentDigest: digest, reviewDigest: REVIEW, at: AT });
    await markCctpBurnSubmitted({ store, network: "mainnet", intentDigest: digest, signature: SIGNATURE });
    const read = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: digest });
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.match(cctpBurnRecovery(read.record).action, expected);
  }
});
