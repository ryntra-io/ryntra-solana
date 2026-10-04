import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CROSS_SWAP_RECEIPT_LIMITATIONS,
  CrossSwapReceiptFactsSchema,
  crossSwapChainRef,
  crossSwapFactsToEffects,
  crossSwapReceiptFacts,
  measuredFeeBps,
  mintCrossSwapOutcomeReceipt,
  parseCrossSwapFactsFromEffects,
  reconcileCrossSwapFacts,
} from "./cross-swap-receipt.ts";
import { SOLANA_CAIP2 } from "../agent-control/adapters/solana-token-2022.ts";
import { parseHumanAmount } from "../swap/catalog.ts";

const DIGEST = `0x${"a".repeat(64)}`;
const REVIEW = `0x${"b".repeat(64)}`;
const EVM_TX = `0x${"c".repeat(64)}`;
const SOLANA_TX = "3".repeat(88);
const OBSERVED = "2026-09-11T20:45:00.000Z";

test("fee units in a receipt come from Relay, not the token the user sent", () => {
  const report={...relayReport,serviceFee:{...relayReport.serviceFee,currency:{address:"0xfee",symbol:"USDC",decimals:6},basisPoints:25}};
  const built=crossSwapReceiptFacts({...baseFill,fromSymbol:"BONK",fromDecimals:5},report,OBSERVED,parseHumanAmount);
  assert.equal(built.fee.symbol,"USDC");
  assert.equal(built.fee.decimals,6);
  assert.equal(built.fee.basisPoints,25);
});

/** The Base → Solana fill of 2026-09-11, as the record and Relay reported it. */
function facts(overrides = {}) {
  return CrossSwapReceiptFactsSchema.parse({
    schema: "ryntra.solana.cross-swap-receipt.facts@1",
    provider: "RELAY",
    intentDigest: DIGEST,
    reviewDigest: REVIEW,
    tupleId: "BASE_USDC_TO_SOLANA_SOL",
    route: "RELAY_DEPOSIT",
    source: {
      network: "base",
      chainRef: "eip155:8453",
      wallet: "0x1234567890123456789012345678901234567890",
      symbol: "USDC",
      decimals: 6,
      txHash: EVM_TX,
    },
    destination: {
      network: "solana",
      chainRef: SOLANA_CAIP2.mainnet,
      wallet: "ATvsQx9F1stmRoHhs1e7ipzvRB3gtUcDuy6mTFzv3guu",
      symbol: "SOL",
      decimals: 9,
      txHash: SOLANA_TX,
    },
    amounts: { sentRaw: "5020909", expectedOutRaw: "49962401", minimumOutRaw: "49000000", receivedRaw: "49962401" },
    fee: {
      mechanism: "RELAY_APP_FEE",
      reported: true,
      basisPoints: 25,
      collected: true,
      quotedUsd: 0.01255,
      paidUsd: 0.01255,
      paidAmountRaw: "12552",
      symbol: "USDC",
      decimals: 6,
    },
    refund: null,
    settlement: {
      orderState: "COMPLETED",
      providerStatus: "success",
      clientStatus: "COMPLETED",
      completedAt: "2026-09-11T20:44:12.000Z",
      observedBy: "api.relay.link",
    },
    reconciliation: "NOT_OBSERVED",
    deviations: [],
    limitations: [...CROSS_SWAP_RECEIPT_LIMITATIONS],
    observedAt: OBSERVED,
    ...overrides,
  });
}

test("Solana's chain reference is the genesis hash every other receipt uses", () => {
  /* The swap catalogue carries `solana:mainnet` for its own purposes. A receipt
     written with that string would resolve against no explorer map in this
     product, so the two are deliberately not the same lookup. */
  assert.equal(crossSwapChainRef("solana"), SOLANA_CAIP2.mainnet);
  assert.equal(crossSwapChainRef("base"), "eip155:8453");
  assert.equal(crossSwapChainRef("robinhood"), "eip155:4663");
});

test("the facts survive the round trip through observed effects", () => {
  const source = facts();
  const effects = crossSwapFactsToEffects({ facts: source, sourceRef: "api.relay.link:x", observedAt: OBSERVED });
  assert.ok(effects.length >= 1);
  assert.deepEqual(parseCrossSwapFactsFromEffects(effects), source);
});

test("a chunk missing from the middle yields nothing rather than a partial truth", () => {
  const effects = crossSwapFactsToEffects({ facts: facts(), sourceRef: "api.relay.link:x", observedAt: OBSERVED });
  if (effects.length < 2) return; /* One chunk cannot lose a middle. */
  assert.equal(parseCrossSwapFactsFromEffects(effects.slice(1)), null);
});

test("a fill at or above the reviewed minimum, with both transactions, matches", () => {
  assert.deepEqual(reconcileCrossSwapFacts(facts()), { status: "MATCHED", deviations: [] });
});

test("a fill under the reviewed minimum is a recorded deviation, never a match", () => {
  const short = facts({ amounts: { sentRaw: "5020909", expectedOutRaw: "49962401", minimumOutRaw: "49000000", receivedRaw: "10" } });
  const result = reconcileCrossSwapFacts(short);
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.ok(result.deviations.some((line) => line.includes("49000000")), result.deviations.join(" | "));
});

test("no destination transaction cannot produce a receipt that says the money arrived", () => {
  const unseen = facts({
    destination: { ...facts().destination, txHash: null },
    amounts: { sentRaw: "5020909", expectedOutRaw: "49962401", minimumOutRaw: "49000000", receivedRaw: null },
  });
  const result = reconcileCrossSwapFacts(unseen);
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.ok(result.deviations.some((line) => line.includes("Solana")), result.deviations.join(" | "));
});

test("a fee the provider did not confirm collecting is stated as a deviation", () => {
  /* Relay documents an operation shape that collects nothing and reports no
     error. A receipt that stayed silent would be claiming income nobody got. */
  const uncollected = facts({ fee: { ...facts().fee, collected: false } });
  const result = reconcileCrossSwapFacts(uncollected);
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.ok(result.deviations.some((line) => line.includes("not confirm collecting")));
});

test("an operation that never left the wallet is FAILED, not a deviation", () => {
  for (const state of ["SOURCE_FAILED", "EXPIRED_BEFORE_SUBMIT"]) {
    const result = reconcileCrossSwapFacts(facts({ settlement: { ...facts().settlement, orderState: state } }));
    assert.equal(result.status, "FAILED", state);
    assert.ok(result.deviations[0].includes("left the wallet"), result.deviations[0]);
  }
});

test("a refund is a recorded deviation that names the refunding transaction", () => {
  const refunded = facts({
    settlement: { ...facts().settlement, orderState: "REFUNDED", clientStatus: "REFUNDED" },
    refund: { txHash: EVM_TX, amount: "5.02", symbol: "USDC" },
  });
  const result = reconcileCrossSwapFacts(refunded);
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.ok(result.deviations[0].includes(EVM_TX));
});

test("the receipt is anchored to the chain the money left, not to Solana", () => {
  /* Anchoring both directions to Solana would produce a document whose chain
     reference and whose transaction were about different ledgers. */
  const minted = mintCrossSwapOutcomeReceipt({ id: "outcome_solana_cross_swap_test", actionPassportHash: REVIEW, facts: facts() });
  assert.equal(minted.ok, true);
  assert.equal(minted.receipt.outcome.chainRef, "eip155:8453");
  assert.equal(minted.receipt.outcome.transactionHash, EVM_TX);
  assert.equal(minted.receipt.outcome.status, "MATCHED");
  assert.equal(minted.receipt.kind, "OUTCOME_RECEIPT");
  assert.equal(minted.receipt.actionPassportHash, REVIEW);
});

test("the minter, not the caller, decides what happened", () => {
  /* The caller supplies `reconciliation` because the schema requires a value.
     A caller that claimed MATCHED on a fill under the minimum must not be
     believed. */
  const lying = facts({
    reconciliation: "MATCHED",
    amounts: { sentRaw: "5020909", expectedOutRaw: "49962401", minimumOutRaw: "49000000", receivedRaw: "1" },
  });
  const minted = mintCrossSwapOutcomeReceipt({ id: "outcome_solana_cross_swap_test", actionPassportHash: REVIEW, facts: lying });
  assert.equal(minted.ok, true);
  assert.equal(minted.receipt.outcome.status, "DEVIATION_RECORDED");
  assert.equal(minted.facts.reconciliation, "DEVIATION_RECORDED");
});

test("the signed facts inside the receipt are the reconciled ones", () => {
  const minted = mintCrossSwapOutcomeReceipt({ id: "outcome_solana_cross_swap_test", actionPassportHash: REVIEW, facts: facts() });
  assert.equal(minted.ok, true);
  const read = parseCrossSwapFactsFromEffects(minted.receipt.outcome.observedEffects);
  assert.equal(read?.reconciliation, "MATCHED");
  assert.equal(read?.fee.paidAmountRaw, "12552");
  assert.equal(read?.amounts.receivedRaw, "49962401");
});

test("an order with no source transaction anchors to its intent and says so", () => {
  const anchorless = facts({ source: { ...facts().source, txHash: null } });
  const minted = mintCrossSwapOutcomeReceipt({ id: "outcome_solana_cross_swap_test", actionPassportHash: REVIEW, facts: anchorless });
  assert.equal(minted.ok, true);
  assert.equal(minted.receipt.outcome.transactionHash, DIGEST);
  assert.equal(minted.receipt.outcome.status, "DEVIATION_RECORDED");
});

test("the same facts minted at the same instant produce the same content hash", () => {
  /* A second `createdAt` moves the hash the signature was taken over, and the
     public verifier answers SIGNATURE_INVALID for a receipt that is otherwise
     correct. */
  const now = new Date("2026-09-11T21:00:00.000Z");
  const one = mintCrossSwapOutcomeReceipt({ id: "outcome_solana_cross_swap_test", actionPassportHash: REVIEW, facts: facts(), now });
  const two = mintCrossSwapOutcomeReceipt({ id: "outcome_solana_cross_swap_test", actionPassportHash: REVIEW, facts: facts(), now });
  assert.equal(one.ok && two.ok, true);
  assert.equal(one.receipt.contentHash, two.receipt.contentHash);
});

test("facts that do not parse are refused rather than minted around", () => {
  const minted = mintCrossSwapOutcomeReceipt({
    id: "outcome_solana_cross_swap_test",
    actionPassportHash: REVIEW,
    facts: { ...facts(), amounts: { sentRaw: "not-a-number", expectedOutRaw: "1", minimumOutRaw: "1", receivedRaw: null } },
  });
  assert.equal(minted.ok, false);
  assert.equal(minted.code, "FACTS_INVALID");
});

/* ── The two real fills of 2026-09-11, mapped from order + provider report ── */

/**
 * The order as it is stored, with only the fields the receipt reads.
 *
 * Both fills below are the real ones: the amounts, the fee and the 25 bps are
 * Relay's own figures for those operations, not invented ones — `5020909 × 25 /
 * 10000 = 12552` and `2537760 × 25 / 10000 = 6344` check out against what Relay
 * reported as **paid**.
 */
const baseFill = {
  provider: "RELAY",
  intentDigest: DIGEST,
  reviewDigest: REVIEW,
  tupleId: "BASE_USDC_TO_SOLANA_SOL",
  route: "RELAY_DEPOSIT",
  state: "COMPLETED",
  sourceChain: "base",
  destinationChain: "solana",
  sourceWallet: "0x1234567890123456789012345678901234567890",
  destinationWallet: "ATvsQx9F1stmRoHhs1e7ipzvRB3gtUcDuy6mTFzv3guu",
  fromSymbol: "USDC",
  toSymbol: "SOL",
  fromDecimals: 6,
  toDecimals: 9,
  amountInRaw: "5020909",
  expectedOutRaw: "49962401",
  minimumOutRaw: "49000000",
  sourceTxHash: EVM_TX,
  destinationTxHash: SOLANA_TX,
  refundTxHash: null,
  receivedAmount: null,
  refund: null,
  providerStatus: "success",
};

const relayReport = {
  clientStatus: "COMPLETED",
  sourceTxHash: EVM_TX,
  destinationTxHash: SOLANA_TX,
  refundTxHash: null,
  toAmount: "0.049962401",
  completedAt: "2026-09-11T20:44:12.000Z",
  serviceFee: {
    collected: true,
    quotedUsd: 0.01255,
    paidUsd: 0.01255,
    paidAmountRaw: "12552",
    settlement: { userPaidRaw: "12552" },
  },
};

test("the Base fill maps to facts that state what arrived and what it cost", () => {
  const built = crossSwapReceiptFacts(baseFill, relayReport, OBSERVED, parseHumanAmount);
  assert.equal(built.amounts.sentRaw, "5020909");
  /* The human decimal the provider reported, placed at the destination's own
     scale — not the quote's expected amount. */
  assert.equal(built.amounts.receivedRaw, "49962401");
  assert.equal(built.fee.mechanism, "RELAY_APP_FEE");
  assert.equal(built.fee.basisPoints, 25);
  assert.equal(built.fee.collected, true);
  assert.equal(built.fee.paidAmountRaw, "12552");
  assert.equal(built.fee.symbol, "USDC");
  assert.equal(built.fee.decimals, 6);
  assert.equal(built.source.chainRef, "eip155:8453");
  assert.equal(built.destination.chainRef, SOLANA_CAIP2.mainnet);
  assert.equal(reconcileCrossSwapFacts(built).status, "MATCHED");
});

test("the Robinhood fill maps the same way, on its own chain", () => {
  const built = crossSwapReceiptFacts(
    {
      ...baseFill,
      tupleId: "ROBINHOOD_USDG_TO_SOLANA_SOL",
      sourceChain: "robinhood",
      fromSymbol: "USDG",
      amountInRaw: "2537760",
      expectedOutRaw: "24741584",
      minimumOutRaw: "24000000",
    },
    { ...relayReport, toAmount: "0.024741584", serviceFee: { ...relayReport.serviceFee, paidAmountRaw: "6344", paidUsd: 0.00634, settlement: { userPaidRaw: "6344" } } },
    OBSERVED,
    parseHumanAmount,
  );
  assert.equal(built.source.chainRef, "eip155:4663");
  assert.equal(built.fee.paidAmountRaw, "6344");
  assert.equal(built.fee.symbol, "USDG");
  assert.equal(built.amounts.receivedRaw, "24741584");
  assert.equal(reconcileCrossSwapFacts(built).status, "MATCHED");
});

test("no provider report is a fee of unknown size, never a fee of zero", () => {
  /* Relay may be unreachable, rate-limiting, or simply not have indexed the
     request. The first version of this schema answered `mechanism: "NONE"` —
     which the receipt then rendered as "no Ryntra service fee was charged on
     this operation", on a Relay order carrying 25 bps. Found by walking the
     route on a stand, not by reading the code. */
  const built = crossSwapReceiptFacts(baseFill, null, OBSERVED, parseHumanAmount);
  assert.equal(built.fee.mechanism, "RELAY_APP_FEE", "the mechanism is a fact about the order, not about the read");
  assert.equal(built.fee.reported, false);
  assert.equal(built.fee.collected, false);
  assert.equal(built.fee.basisPoints, null, "a rate nobody measured is not the current rate");
  assert.equal(built.fee.paidAmountRaw, null);
  const result = reconcileCrossSwapFacts(built);
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.ok(result.deviations.some((line) => line.includes("could not be read back")), result.deviations.join(" | "));
});

test("the rate is measured from the fill, not taken from the current price list", () => {
  /* Both real fills land on exactly 25 bps — `12552 / 5020909` and
     `6344 / 2537760` — and an order quoted before the rate changed paid what
     it paid. A receipt is a document about one operation. */
  assert.equal(measuredFeeBps("12552", "5020909"), 25);
  assert.equal(measuredFeeBps("6344", "2537760"), 25);
  assert.equal(measuredFeeBps(null, "5020909"), null);
  assert.equal(measuredFeeBps("12552", "0"), null);
  /* The rate this product charged before the split, on the same amount. */
  assert.equal(measuredFeeBps("25105", "5020909"), 50);
});

test("a quoted fee the provider did not collect never reads as paid", () => {
  const built = crossSwapReceiptFacts(
    baseFill,
    { ...relayReport, serviceFee: { collected: false, quotedUsd: 0.01255, paidUsd: null, paidAmountRaw: null } },
    OBSERVED,
    parseHumanAmount,
  );
  assert.equal(built.fee.collected, false);
  assert.equal(built.fee.quotedUsd, 0.01255);
  assert.equal(built.fee.paidUsd, null);
  assert.equal(built.fee.paidAmountRaw, null);
});

test("the record's own hashes win over a later provider report", () => {
  /* The record is what the person's wallet actually broadcast. A provider that
     reports a different source transaction is reporting about something else. */
  const built = crossSwapReceiptFacts(
    baseFill,
    { ...relayReport, sourceTxHash: `0x${"9".repeat(64)}` },
    OBSERVED,
    parseHumanAmount,
  );
  assert.equal(built.source.txHash, EVM_TX);
});

test("a refunded order carries its refund and no received amount", () => {
  const built = crossSwapReceiptFacts(
    { ...baseFill, state: "REFUNDED", destinationTxHash: null, refundTxHash: EVM_TX, refund: { amount: "5.02", tokenSymbol: "USDC" } },
    { ...relayReport, clientStatus: "REFUNDED", destinationTxHash: null, toAmount: null },
    OBSERVED,
    parseHumanAmount,
  );
  assert.equal(built.amounts.receivedRaw, null);
  assert.equal(built.refund.txHash, EVM_TX);
  assert.equal(built.refund.symbol, "USDC");
  assert.equal(reconcileCrossSwapFacts(built).status, "DEVIATION_RECORDED");
});
