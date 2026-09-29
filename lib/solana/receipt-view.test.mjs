import assert from "node:assert/strict";
import test from "node:test";

import { SOLANA_CAIP2 } from "../agent-control/adapters/solana-token-2022.ts";
import { BRIDGE_RECEIPT_LIMITATIONS, bridgeFactsToEffects, SolanaBridgeReceiptFactsSchema } from "./cctp-receipt.ts";
import {
  crossSwapReceiptSummary,
  projectVerifiedReceiptOutcome,
  receiptExplorerLinks,
  receiptKind,
  receiptMatchesAction,
} from "./receipt-view.ts";
import {
  CROSS_SWAP_RECEIPT_LIMITATIONS,
  CrossSwapReceiptFactsSchema,
  crossSwapFactsToEffects,
} from "./cross-swap-receipt.ts";

const WALLET = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const OTHER = "4bC9xvLWmNjJt2yF8sGqK1RhZ7Pd3TnUeA6WkYcXbQ5m";
const SIGNATURE = "4G7TN124BA93vKwCdxX2QH7JjXZrHXqRtaNcTdX4hQoKSELMSnigUCKaRCLoJco9uFfdSsvUfwicrcZQPYKadk6o";
const BASE_HASH = `0x${"d".repeat(64)}`;
const INTENT = `0x${"a".repeat(64)}`;
const AT = "2026-09-03T10:00:00.000Z";

const action = (overrides = {}) => ({
  schema: "ryntra.solana.wallet-action",
  schemaVersion: "1.0.0",
  version: 1,
  network: "mainnet",
  wallet: WALLET,
  actionId: SIGNATURE,
  lane: "SEND",
  outcome: "IN_FLIGHT",
  out: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "500000", decimals: 6, symbol: "USDC" },
  in: null,
  destination: null,
  signature: SIGNATURE,
  receiptHash: null,
  startedAt: AT,
  updatedAt: AT,
  ...overrides,
});

function sendRow(overrides = {}) {
  const facts = {
    schema: "ryntra.solana.send-receipt",
    schemaVersion: "1.0.0",
    actionKind: "SPL_TRANSFER_CHECKED",
    network: "mainnet",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    sender: WALLET,
    recipient: OTHER,
    expectedDebitRaw: "-500000",
    expectedCreditRaw: "500000",
    actualDebitRaw: "-500000",
    actualCreditRaw: "500000",
    transferFeeRaw: "0",
    baseFeeLamports: "5000",
    priorityFeeLamports: "0",
    ataRentLamports: null,
    programs: ["11111111111111111111111111111111"],
    signature: SIGNATURE,
    slot: "442000000",
    finality: "finalized",
    reconciliation: "MATCHED",
  };
  return {
    wallet: WALLET,
    storedAt: AT,
    receipt: {
      id: "receipt",
      contentHash: `0x${"f".repeat(64)}`,
      registry: { refs: [] },
      outcome: {
        status: "MATCHED",
        chainRef: SOLANA_CAIP2.mainnet,
        transactionHash: SIGNATURE,
        observedEffects: [{
          description: JSON.stringify(facts),
          sourceRef: "ryntra.solana.send-receipt.facts@1:test#1/1",
          observedAt: AT,
        }],
      },
    },
    ...overrides,
  };
}

test("a verified, wallet/network/signature-bound Send receipt settles a stale row", () => {
  const row = sendRow();
  assert.equal(receiptMatchesAction(row, action()), true);
  assert.equal(projectVerifiedReceiptOutcome(action(), row, true).outcome, "DONE");
  assert.equal(projectVerifiedReceiptOutcome(action(), row, false).outcome, "IN_FLIGHT");
});

test("cross-wallet and cross-network receipts cannot promote an action", () => {
  assert.equal(receiptMatchesAction(sendRow({ wallet: OTHER }), action()), false);
  assert.equal(receiptMatchesAction(sendRow(), action({ network: "devnet" })), false);
  assert.equal(projectVerifiedReceiptOutcome(action(), sendRow({ wallet: OTHER }), true).outcome, "IN_FLIGHT");
});

function bridgeReceipt(direction) {
  const reverse = direction === "BASE_TO_SOLANA";
  const facts = SolanaBridgeReceiptFactsSchema.parse({
    schema: "ryntra.solana.bridge-receipt.facts@2",
    provider: "CIRCLE_CCTP_V2",
    direction,
    intentDigest: INTENT,
    reviewDigest: `0x${"b".repeat(64)}`,
    source: {
      chainRef: reverse ? "eip155:8453" : SOLANA_CAIP2.mainnet,
      domain: reverse ? 6 : 5,
      wallet: reverse ? "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401" : WALLET,
      tokenAccount: reverse ? null : OTHER,
      asset: reverse ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      burnSignature: reverse ? BASE_HASH : SIGNATURE,
      slot: reverse ? null : "442000000",
      finality: "finalized",
      observedBy: reverse ? "mainnet.base.org" : "rpc.example",
    },
    destination: {
      chainRef: reverse ? SOLANA_CAIP2.mainnet : "eip155:8453",
      domain: reverse ? 5 : 6,
      recipient: reverse ? WALLET : "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401",
      recipientAccount: reverse ? OTHER : "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401",
      asset: reverse ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      mintTransactionHash: reverse ? SIGNATURE : BASE_HASH,
      blockNumber: reverse ? null : "50760000",
      finality: "included",
      observedBy: reverse ? "rpc.example" : "mainnet.base.org",
      recipientReadiness: "BALANCE_READ_BEFORE_AND_AFTER",
      usdcBeforeRaw: "0",
      usdcAfterRaw: "2000000",
    },
    message: {
      nonce: `0x${"c".repeat(64)}`,
      cctpVersion: 2,
      status: "ATTESTED",
      attestationRef: "iris-api.circle.com/v2/messages",
      minFinalityThreshold: 2000,
      finalityThresholdExecuted: 2000,
      expirationBlock: "50800000",
      destinationCaller: `0x${"0".repeat(64)}`,
    },
    amounts: { burnedRaw: "2000000", maxFeeRaw: "0", feeExecutedRaw: "0", expectedReceivedRaw: "2000000", mintedRaw: "2000000", destinationFeeCollectedRaw: "0" },
    fees: { sourceNetworkFeeLamports: reverse ? null : "5000", sourceRentLamports: null, rentReclaimable: false, rentReclaimableAfterDays: 0, sourceGasUsed: reverse ? "100000" : null, sourceGasPriceWei: reverse ? "6000000" : null, destinationNetworkFeeLamports: reverse ? "5000" : null, destinationRentLamports: null, destinationGasUsed: reverse ? null : "100000", destinationGasPriceWei: reverse ? null : "6000000", relayerFeeRaw: null, relayerFeeReason: "FORWARDING_SERVICE_NOT_USED" },
    reconciliation: "MATCHED",
    deviations: [],
    recovery: { attempts: 1, secondBurnCreated: false, action: "NONE_REQUIRED" },
    limitations: BRIDGE_RECEIPT_LIMITATIONS,
    observedAt: AT,
  });
  return {
    id: `bridge-${direction}`,
    contentHash: `0x${"e".repeat(64)}`,
    outcome: {
      status: "MATCHED",
      chainRef: facts.source.chainRef,
      transactionHash: facts.source.burnSignature,
      observedEffects: bridgeFactsToEffects({ facts, sourceRef: "test", observedAt: AT }),
    },
  };
}

test("Solana to Base links each observed leg to its own chain", () => {
  const links = receiptExplorerLinks(bridgeReceipt("SOLANA_TO_BASE"));
  assert.deepEqual(links.map((link) => [link.leg, link.chain]), [["source", "Solana"], ["destination", "Base"]]);
  assert.match(links[0].href, /explorer\.solana\.com\/tx\//);
  assert.match(links[1].href, /^https:\/\/basescan\.org\/tx\/0x/);
});

test("Base to Solana reverses explorer ownership without reversing labels", () => {
  const links = receiptExplorerLinks(bridgeReceipt("BASE_TO_SOLANA"));
  assert.deepEqual(links.map((link) => [link.leg, link.chain]), [["source", "Base"], ["destination", "Solana"]]);
  assert.match(links[0].href, /^https:\/\/basescan\.org\/tx\/0x/);
  assert.match(links[1].href, /explorer\.solana\.com\/tx\//);
});

test("an exact bridge intent and wallet bind an older row whose projection fields were missing", () => {
  const row = { wallet: WALLET, storedAt: AT, receipt: bridgeReceipt("BASE_TO_SOLANA") };
  const historical = action({
    actionId: INTENT,
    lane: "BRIDGE",
    signature: null,
    destination: null,
    out: null,
  });
  assert.equal(receiptMatchesAction(row, historical), true);
  assert.equal(receiptMatchesAction(row, { ...historical, signature: SIGNATURE, destination: "SOLANA" }), true);
  assert.equal(receiptMatchesAction(row, { ...historical, signature: "3".repeat(88) }), false);
  assert.equal(receiptMatchesAction(row, { ...historical, destination: "BASE" }), false);
});

test("an older receipt without structured facts keeps its chain-bound transaction link", () => {
  const links = receiptExplorerLinks({
    id: "legacy",
    contentHash: `0x${"1".repeat(64)}`,
    outcome: { status: "MATCHED", chainRef: "eip155:8453", transactionHash: BASE_HASH, observedEffects: [] },
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].chain, "Base");
});

/* ── The cross-chain lane, `RYN-MONEY-RECEIPT-PARITY-001` ─────────────────── */

function crossSwapReceipt(overrides = {}) {
  const facts = CrossSwapReceiptFactsSchema.parse({
    schema: "ryntra.solana.cross-swap-receipt.facts@1",
    provider: "RELAY",
    intentDigest: INTENT,
    reviewDigest: `0x${"b".repeat(64)}`,
    tupleId: "BASE_USDC_TO_SOLANA_SOL",
    route: "RELAY_DEPOSIT",
    source: {
      network: "base",
      chainRef: "eip155:8453",
      wallet: "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401",
      symbol: "USDC",
      decimals: 6,
      txHash: BASE_HASH,
    },
    destination: {
      network: "solana",
      chainRef: SOLANA_CAIP2.mainnet,
      wallet: WALLET,
      symbol: "SOL",
      decimals: 9,
      txHash: SIGNATURE,
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
      completedAt: AT,
      observedBy: "api.relay.link",
    },
    reconciliation: "MATCHED",
    deviations: [],
    limitations: CROSS_SWAP_RECEIPT_LIMITATIONS,
    observedAt: AT,
    ...overrides,
  });
  return {
    id: "outcome_solana_cross_swap_test",
    contentHash: `0x${"f".repeat(64)}`,
    outcome: {
      status: "MATCHED",
      chainRef: facts.source.chainRef,
      transactionHash: facts.source.txHash ?? facts.intentDigest,
      observedEffects: crossSwapFactsToEffects({ facts, sourceRef: "test", observedAt: AT }),
    },
  };
}

test("a cross-chain receipt links both legs to their own chains", () => {
  const links = receiptExplorerLinks(crossSwapReceipt());
  assert.deepEqual(links.map((link) => [link.leg, link.chain]), [["source", "Base"], ["destination", "Solana"]]);
  assert.match(links[0].href, /^https:\/\/basescan\.org\/tx\/0x/);
  assert.match(links[1].href, /explorer\.solana\.com\/tx\//);
});

test("a chain added since this file was written still resolves to its own explorer", () => {
  /* The four networks `RYN-SWAP-BRIDGE-SPLIT-001` added were a real risk here:
     a hand-written ladder of three chain refs offered no link for any of them. */
  const links = receiptExplorerLinks(
    crossSwapReceipt({
      source: {
        network: "robinhood",
        chainRef: "eip155:4663",
        wallet: "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401",
        symbol: "USDG",
        decimals: 6,
        txHash: BASE_HASH,
      },
    }),
  );
  assert.equal(links[0].chain, "Robinhood Chain");
  assert.match(links[0].href, /robinhoodchain\.blockscout\.com\/tx\/0x/);
});

test("a cross-chain receipt binds the row the Bridge page wrote", () => {
  /* The row's own `signature` is null, because an EVM hash cannot go in a
     base58 field. That must not stop the receipt from finding its row. */
  const row = { wallet: WALLET, storedAt: AT, receipt: crossSwapReceipt() };
  const crossRow = action({ lane: "CROSS_SWAP", actionId: INTENT, signature: null, destination: "SOLANA", outcome: "DONE" });
  assert.equal(receiptMatchesAction(row, crossRow), true);
});

test("a cross-chain receipt does not bind a different operation", () => {
  const row = { wallet: WALLET, storedAt: AT, receipt: crossSwapReceipt() };
  assert.equal(receiptMatchesAction(row, action({ lane: "CROSS_SWAP", actionId: `0x${"9".repeat(64)}`, signature: null })), false);
  assert.equal(receiptMatchesAction(row, action({ lane: "SWAP", actionId: INTENT, signature: null })), false);
  assert.equal(receiptMatchesAction({ ...row, wallet: OTHER }, action({ lane: "CROSS_SWAP", actionId: INTENT, signature: null })), false);
});

test("a receipt whose anchor disagrees with its own facts binds to nothing", () => {
  const forged = crossSwapReceipt();
  const row = {
    wallet: WALLET,
    storedAt: AT,
    receipt: { ...forged, outcome: { ...forged.outcome, transactionHash: `0x${"1".repeat(64)}` } },
  };
  assert.equal(receiptMatchesAction(row, action({ lane: "CROSS_SWAP", actionId: INTENT, signature: null })), false);
});

test("a cross-chain receipt is named a bridge, not a send", () => {
  assert.equal(receiptKind(crossSwapReceipt()), "CROSS_SWAP");
});

test("the summary reads the signed facts rather than the row beside them", () => {
  const summary = crossSwapReceiptSummary(crossSwapReceipt());
  assert.equal(summary.from, "Base");
  assert.equal(summary.to, "Solana");
  assert.equal(summary.sent.amountRaw, "5020909");
  assert.equal(summary.sent.symbol, "USDC");
  assert.equal(summary.received.amountRaw, "49962401");
  assert.equal(summary.fee.collected, true);
  assert.equal(summary.fee.paidAmountRaw, "12552");
});

test("a receipt of another lane has no cross-chain summary", () => {
  assert.equal(crossSwapReceiptSummary(bridgeReceipt("BASE_TO_SOLANA")), null);
});
