import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import {
  applyCrossSwapProviderStatus,
  claimCrossSwapOrder,
  crossSwapIntentDigest,
  crossSwapRecovery,
  crossSwapReviewDigest,
  markCrossSwapArmed,
  markCrossSwapNeverBroadcast,
  markCrossSwapSourceFailed,
  markCrossSwapReceipted,
  markCrossSwapSubmitted,
  readCrossSwapOrder,
} from "./cross-swap-order.ts";

const SOL_SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const EVM_TX = "0x" + "ab".repeat(32);
const at = (seconds) => new Date(Date.UTC(2026, 8, 7, 12, 0, seconds)).toISOString();

function facts(overrides = {}) {
  const base = {
    sourceWallet: "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9",
    destinationWallet: "0x000000000000000000000000000000000000dEaD",
    tupleId: "SOLANA_SOL_TO_BASE_USDC",
    route: "SWIFT",
    amountInRaw: "100000000",
    minimumOutRaw: "10331472",
    quoteId: "0xe4b868d4c313e825aa7101f19cf526ba",
    builtAt: at(0),
    ...overrides,
  };
  return base;
}

function claimInput(store, f = facts(), reviewOverrides = {}) {
  const review = { route: f.route, amountInRaw: f.amountInRaw, expectedOutRaw: "10388583", minimumOutRaw: f.minimumOutRaw, deadlineUnix: 1788804505, walletPrompts: 1, ...reviewOverrides };
  return {
    store,
    intentDigest: crossSwapIntentDigest(f),
    reviewDigest: crossSwapReviewDigest(review),
    /* The record names its own provider since 001H: a stored order is read back
       long after the classifier that chose one, and the status poller has to
       ask the provider that actually has it. */
    provider: f.provider ?? "MAYAN",
    tupleId: f.tupleId,
    route: f.route,
    sourceChain: "solana",
    destinationChain: "base",
    sourceWallet: f.sourceWallet,
    destinationWallet: f.destinationWallet,
    amountInRaw: f.amountInRaw,
    expectedOutRaw: review.expectedOutRaw,
    minimumOutRaw: f.minimumOutRaw,
    fromDecimals: 9,
    toDecimals: 6,
    fromSymbol: "SOL",
    toSymbol: "USDC",
    deadlineUnix: review.deadlineUnix,
    quoteId: f.quoteId,
    at: at(0),
  };
}

test("the intent digest is stable over identical facts and changes with any of them", () => {
  assert.equal(crossSwapIntentDigest(facts()), crossSwapIntentDigest(facts()));
  assert.match(crossSwapIntentDigest(facts()), /^0x[0-9a-f]{64}$/);
  assert.notEqual(crossSwapIntentDigest(facts()), crossSwapIntentDigest(facts({ amountInRaw: "100000001" })));
  assert.notEqual(crossSwapIntentDigest(facts()), crossSwapIntentDigest(facts({ builtAt: at(1) })));
});

test("concurrent arming has exactly one winner, including a lost-response retry", async () => {
  const store=createMemoryGuardStore();
  const input=claimInput(store);
  await claimCrossSwapOrder(input);
  const outcomes=await Promise.all(Array.from({length:4},()=>markCrossSwapArmed({store,intentDigest:input.intentDigest,at:at(1)})));
  assert.equal(outcomes.filter(x=>x.ok).length,1);
  assert.equal((await markCrossSwapArmed({store,intentDigest:input.intentDigest,at:at(2)})).ok,false);
});

test("an expired Relay quote cannot be armed, even if the client kept its Review", async () => {
  const store=createMemoryGuardStore();
  const input=claimInput(store,facts({provider:"RELAY",route:"RELAY_DEPOSIT"}),{deadlineUnix:Math.floor(Date.parse(at(2))/1000)});
  await claimCrossSwapOrder(input);
  assert.equal((await markCrossSwapArmed({store,intentDigest:input.intentDigest,at:at(2)})).ok,false);
  assert.equal((await readCrossSwapOrder({store,intentDigest:input.intentDigest})).record.state,"RESERVED");
});

test("a claim is reserved once; the identical repeat is a duplicate, a different review is a conflict", async () => {
  const store = createMemoryGuardStore();
  const first = await claimCrossSwapOrder(claimInput(store));
  assert.equal(first.ok, true);
  assert.equal(first.record.state, "RESERVED");
  assert.equal(first.record.attempt, 1);
  const again = await claimCrossSwapOrder(claimInput(store));
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  const other = await claimCrossSwapOrder(claimInput(store, facts(), { minimumOutRaw: "10000000" }));
  assert.equal(other.ok, false);
  assert.equal(other.code, "CROSS_SWAP_ORDER_CONFLICT");
});

test("once the boundary is crossed the intent can never be reserved again, in any later state", async () => {
  const store = createMemoryGuardStore();
  const input = claimInput(store);
  await claimCrossSwapOrder(input);
  const armed = await markCrossSwapArmed({ store, intentDigest: input.intentDigest, at: at(1) });
  assert.equal(armed.ok && armed.record.state, "SUBMITTED_UNKNOWN");
  const refused = await claimCrossSwapOrder(input);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "CROSS_SWAP_ALREADY_STARTED");
  assert.equal(refused.record.state, "SUBMITTED_UNKNOWN");

  const submitted = await markCrossSwapSubmitted({ store, intentDigest: input.intentDigest, sourceTxHash: SOL_SIG, at: at(2) });
  assert.equal(submitted.ok && submitted.record.state, "SUBMITTED");
  assert.equal(submitted.record.sourceTxHash, SOL_SIG);
  const sameHash = await markCrossSwapSubmitted({ store, intentDigest: input.intentDigest, sourceTxHash: SOL_SIG, at: at(3) });
  assert.equal(sameHash.ok, true, "recording the same hash twice is idempotent");
  const otherHash = await markCrossSwapSubmitted({ store, intentDigest: input.intentDigest, sourceTxHash: EVM_TX, at: at(3) });
  assert.equal(otherHash.ok, false, "a second, different source transaction is refused");
  assert.equal(otherHash.code, "CROSS_SWAP_ORDER_STATE");

  const inProgress = await applyCrossSwapProviderStatus({
    store,
    intentDigest: input.intentDigest,
    at: at(4),
    status: { found: true, clientStatus: "INPROGRESS", status: "ORDER_CREATED", service: "SWIFT_V2", orderId: "SWIFT_V2_0x1", sourceTxHash: SOL_SIG, destinationTxHash: null, refundTxHash: null, toAmount: null, refund: null, completedAt: null, statusUpdatedAt: at(4), observedAt: at(4) },
  });
  assert.equal(inProgress.ok && inProgress.record.state, "IN_PROGRESS");
  assert.equal(inProgress.record.providerOrderId, "SWIFT_V2_0x1");

  const completed = await applyCrossSwapProviderStatus({
    store,
    intentDigest: input.intentDigest,
    at: at(5),
    status: { found: true, clientStatus: "COMPLETED", status: "ORDER_SETTLED", service: "SWIFT_V2", orderId: "SWIFT_V2_0x1", sourceTxHash: SOL_SIG, destinationTxHash: EVM_TX, refundTxHash: null, toAmount: "10.39", refund: null, completedAt: at(5), statusUpdatedAt: at(5), observedAt: at(5) },
  });
  assert.equal(completed.ok && completed.record.state, "COMPLETED");
  assert.equal(completed.record.destinationTxHash, EVM_TX);
  assert.equal(completed.record.receivedAmount, "10.39");

  /* Terminal is final: a stale in-progress read does not move it back. */
  const stale = await applyCrossSwapProviderStatus({
    store,
    intentDigest: input.intentDigest,
    at: at(6),
    status: { found: true, clientStatus: "INPROGRESS", status: "x", service: null, orderId: null, sourceTxHash: SOL_SIG, destinationTxHash: null, refundTxHash: null, toAmount: null, refund: null, completedAt: null, statusUpdatedAt: null, observedAt: at(6) },
  });
  assert.equal(stale.ok && stale.record.state, "COMPLETED");
  assert.equal(stale.record.lastCheckedAt, at(6));
  assert.deepEqual(crossSwapRecovery(stale.record), { mayPlanAgain: false, inMotion: false, terminal: true, needsReading: false });
  assert.equal(stale.record.trail.map((entry) => entry.state).join(">"), "RESERVED>SUBMITTED_UNKNOWN>SUBMITTED>IN_PROGRESS>COMPLETED");
});

test("a provably unsent or chain-failed attempt lets the same intent be reserved again with the trail kept", async () => {
  const store = createMemoryGuardStore();
  const input = claimInput(store);
  await claimCrossSwapOrder(input);
  const dropped = await markCrossSwapNeverBroadcast({ store, intentDigest: input.intentDigest, at: at(1) });
  assert.equal(dropped.ok && dropped.record.state, "EXPIRED_BEFORE_SUBMIT");
  assert.equal(crossSwapRecovery(dropped.record).mayPlanAgain, true);
  const second = await claimCrossSwapOrder({ ...input, at: at(2) });
  assert.equal(second.ok, true);
  assert.equal(second.record.state, "RESERVED");
  assert.equal(second.record.attempt, 2);
  assert.equal(second.record.trail.length, 3);

  await markCrossSwapArmed({ store, intentDigest: input.intentDigest, at: at(3) });
  await markCrossSwapSubmitted({ store, intentDigest: input.intentDigest, sourceTxHash: SOL_SIG, at: at(4) });
  const failed = await markCrossSwapSourceFailed({ store, intentDigest: input.intentDigest, at: at(5) });
  assert.equal(failed.ok && failed.record.state, "SOURCE_FAILED");
  const third = await claimCrossSwapOrder({ ...input, at: at(6) });
  assert.equal(third.ok && third.record.attempt, 3);
  assert.equal(third.record.sourceTxHash, null, "a new attempt starts without the failed hash");
});

test("a refund is recorded with whatever token Mayan returned, and reads as needing the person", async () => {
  const store = createMemoryGuardStore();
  const input = claimInput(store);
  await claimCrossSwapOrder(input);
  await markCrossSwapArmed({ store, intentDigest: input.intentDigest, at: at(1) });
  await markCrossSwapSubmitted({ store, intentDigest: input.intentDigest, sourceTxHash: SOL_SIG, at: at(2) });
  const refunded = await applyCrossSwapProviderStatus({
    store,
    intentDigest: input.intentDigest,
    at: at(3),
    status: {
      found: true, clientStatus: "REFUNDED", status: "ORDER_REFUNDED", service: "SWIFT_V2", orderId: "o", sourceTxHash: SOL_SIG, destinationTxHash: null, refundTxHash: SOL_SIG, toAmount: null,
      refund: { chain: "solana", tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokenSymbol: "USDC", amount: "10.36" }, completedAt: null, statusUpdatedAt: at(3), observedAt: at(3),
    },
  });
  assert.equal(refunded.ok && refunded.record.state, "REFUNDED");
  assert.equal(refunded.record.refund.tokenSymbol, "USDC", "the person sent SOL and got USDC back — History must say so");
  const read = await readCrossSwapOrder({ store, intentDigest: input.intentDigest });
  assert.equal(read.ok && read.record.state, "REFUNDED");
  const absent = await readCrossSwapOrder({ store, intentDigest: "0x" + "00".repeat(32) });
  assert.equal(absent.ok, false);
  assert.equal(absent.code, "CROSS_SWAP_ORDER_ABSENT");
});


/* -- The receipt on the order, `RYN-MONEY-RECEIPT-PARITY-001` ------------- */

test("an order stored before receipts existed still reads back", async () => {
  /* Both real fills of 2026-09-11 are stored without these fields, and both
     are exactly the orders a receipt has to be issued for after the fact. A
     record that would not parse is a record nobody -- including recovery --
     can read. */
  const store = createMemoryGuardStore();
  const input = claimInput(store);
  await claimCrossSwapOrder(input);
  const key = `mainnet:${input.intentDigest}`;
  const stored = await store.collection("solanaCrossSwapOrders").get(key);
  const { receiptHash: _hash, receipt: _receipt, ...legacy } = stored;
  await store.collection("solanaCrossSwapOrders").set(key, legacy);

  const read = await readCrossSwapOrder({ store, intentDigest: input.intentDigest });
  assert.equal(read.ok, true);
  assert.equal(read.record.receiptHash, null);
  assert.equal(read.record.receipt, null);
});

test("a receipt is attached once, and the same one twice is not a conflict", async () => {
  const store = createMemoryGuardStore();
  const input = claimInput(store);
  await claimCrossSwapOrder(input);
  const hash = `0x${"1".repeat(64)}`;

  const first = await markCrossSwapReceipted({ store, intentDigest: input.intentDigest, receiptHash: hash, receipt: { id: "r", contentHash: hash }, at: at(3) });
  assert.equal(first.ok, true);
  assert.equal(first.record.receiptHash, hash);
  /* A statement about an order is not a step in it. */
  assert.equal(first.record.state, "RESERVED");

  const again = await markCrossSwapReceipted({ store, intentDigest: input.intentDigest, receiptHash: hash, receipt: { id: "r", contentHash: hash }, at: at(4) });
  assert.equal(again.ok, true, "a retried write of the identical receipt must be safe");

  const different = await markCrossSwapReceipted({ store, intentDigest: input.intentDigest, receiptHash: `0x${"2".repeat(64)}`, receipt: { id: "r2" }, at: at(5) });
  assert.equal(different.ok, false, "a second document must never replace the one the Activity row names by hash");
  const read = await readCrossSwapOrder({ store, intentDigest: input.intentDigest });
  assert.equal(read.record.receiptHash, hash);
});

test("attaching a receipt leaves every other field of the order alone", async () => {
  const store = createMemoryGuardStore();
  const input = claimInput(store);
  await claimCrossSwapOrder(input);
  await markCrossSwapArmed({ store, intentDigest: input.intentDigest, at: at(1) });
  await markCrossSwapSubmitted({ store, intentDigest: input.intentDigest, sourceTxHash: SOL_SIG, at: at(2) });
  const before = (await readCrossSwapOrder({ store, intentDigest: input.intentDigest })).record;

  await markCrossSwapReceipted({ store, intentDigest: input.intentDigest, receiptHash: `0x${"3".repeat(64)}`, receipt: { id: "r" }, at: at(3) });
  const after = (await readCrossSwapOrder({ store, intentDigest: input.intentDigest })).record;

  assert.equal(after.state, before.state);
  assert.equal(after.sourceTxHash, before.sourceTxHash);
  assert.equal(after.attempt, before.attempt);
  assert.deepEqual(after.trail, before.trail, "a statement about an order must not add a step to its trail");
});
