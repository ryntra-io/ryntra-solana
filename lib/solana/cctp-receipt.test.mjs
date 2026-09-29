import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { ISSUER_PRIVATE_KEY_ENV } from "../agent-control/issuer.ts";
import {
  BRIDGE_RECEIPT_LIMITATIONS,
  bridgeFactsToEffects,
  encodeBridgeFacts,
  mintCctpOutcomeReceipt,
  parseBridgeFactsFromEffects,
  reconcileBridgeFacts,
  SolanaBridgeReceiptFactsSchema,
} from "./cctp-receipt.ts";
import { verifySolanaOutcomeReceipt } from "./receipt.ts";

function issuerEnvironment() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { [ISSUER_PRIVATE_KEY_ENV]: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") };
}

const OWNER = "JCjADc5byJNFhPKeK3H39NWfsiKnXwYCKpN8fxkTL1vL";
const TOKEN_ACCOUNT = "4bC9xvLWmNjJt2yF8sGqK1RhZ7Pd3TnUeA6WkYcXbQ5m";
const BURN_SIGNATURE = `4TX1LSCt597YZVzT${"z".repeat(48)}`;
const RECIPIENT = "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401";
const MINT_TX = `0x${"d".repeat(64)}`;
const NONCE = `0x${"c".repeat(64)}`;
const AT = "2026-09-01T12:00:00.000Z";

/** A complete, observed transfer. Every field here stands for something read. */
const completeFacts = (overrides = {}) =>
  SolanaBridgeReceiptFactsSchema.parse({
    schema: "ryntra.solana.bridge-receipt.facts@2",
    provider: "CIRCLE_CCTP_V2",
    intentDigest: `0x${"a".repeat(64)}`,
    reviewDigest: `0x${"b".repeat(64)}`,
    source: {
      chainRef: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      domain: 5,
      wallet: OWNER,
      tokenAccount: TOKEN_ACCOUNT,
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      burnSignature: BURN_SIGNATURE,
      slot: "443500000",
      finality: "finalized",
      observedBy: "public.rpc.solanavibestation.com",
    },
    destination: {
      chainRef: "eip155:8453",
      domain: 6,
      recipient: RECIPIENT,
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      mintTransactionHash: MINT_TX,
      blockNumber: "50760000",
      finality: "included",
      observedBy: "mainnet.base.org",
      recipientReadiness: "BALANCE_READ_BEFORE_AND_AFTER",
      usdcBeforeRaw: "1000",
      usdcAfterRaw: "2001000",
    },
    message: {
      nonce: NONCE,
      cctpVersion: 2,
      status: "ATTESTED",
      attestationRef: "iris-api.circle.com/v2/messages/5",
      minFinalityThreshold: 2000,
      finalityThresholdExecuted: 2000,
      expirationBlock: "50800000",
      destinationCaller: `0x${"0".repeat(64)}`,
    },
    amounts: {
      burnedRaw: "2000000",
      maxFeeRaw: "0",
      feeExecutedRaw: "0",
      expectedReceivedRaw: "2000000",
      mintedRaw: "2000000",
      destinationFeeCollectedRaw: "0",
    },
    fees: {
      sourceNetworkFeeLamports: "15000",
      sourceRentLamports: "3869760",
      rentReclaimable: true,
      rentReclaimableAfterDays: 5,
      destinationGasUsed: "160000",
      destinationGasPriceWei: "6000000",
      relayerFeeRaw: null,
      relayerFeeReason: "FORWARDING_SERVICE_NOT_USED",
    },
    reconciliation: "MATCHED",
    deviations: [],
    recovery: { attempts: 1, secondBurnCreated: false, action: "NONE_REQUIRED" },
    limitations: BRIDGE_RECEIPT_LIMITATIONS,
    observedAt: AT,
    ...overrides,
  });

test("a fully observed transfer reconciles MATCHED", () => {
  const reconciled = reconcileBridgeFacts(completeFacts());
  assert.equal(reconciled.status, "MATCHED");
  assert.deepEqual(reconciled.deviations, []);
});

test("an unobserved destination cannot produce a receipt that says the money arrived", () => {
  /* The defect the first version of this file had. It hardcoded a COMPLETE
     message status and a COMPLETED lifecycle, so it could assert a Base-side
     mint nobody had read. */
  const facts = completeFacts({
    destination: {
      ...completeFacts().destination,
      mintTransactionHash: null,
      blockNumber: null,
      finality: "unknown",
      observedBy: null,
      recipientReadiness: "BALANCE_READ_BEFORE_ONLY",
      usdcAfterRaw: null,
    },
    amounts: { ...completeFacts().amounts, mintedRaw: null, destinationFeeCollectedRaw: null },
  });
  const reconciled = reconcileBridgeFacts(facts);
  assert.equal(reconciled.status, "DEVIATION_RECORDED");
  assert.match(reconciled.deviations.join(" "), /nothing here states that the funds arrived/);

  const minted = mintCctpOutcomeReceipt({
    id: "outcome_bridge_unobserved",
    actionPassportHash: `0x${"b".repeat(64)}`,
    facts,
    environment: issuerEnvironment(),
  });
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  assert.equal(minted.receipt.outcome.status, "DEVIATION_RECORDED");
  assert.equal(minted.facts.reconciliation, "NOT_OBSERVED");
  assert.match(
    minted.receipt.outcome.observedEffects.map((effect) => effect.description).join(" "),
    /No arrival was observed on Base/,
  );
});

test("a mint of the wrong amount is a recorded deviation, not a match", () => {
  const facts = completeFacts({ amounts: { ...completeFacts().amounts, mintedRaw: "1999000" } });
  const reconciled = reconcileBridgeFacts(facts);
  assert.equal(reconciled.status, "DEVIATION_RECORDED");
  assert.match(reconciled.deviations.join(" "), /minted 1999000 base units where 2000000 was expected/);
});

test("an unattested message is a deviation even when a mint was somehow seen", () => {
  const facts = completeFacts({
    message: { ...completeFacts().message, status: "PENDING", nonce: null },
  });
  assert.equal(reconcileBridgeFacts(facts).status, "DEVIATION_RECORDED");
});

test("the receipt is an OUTCOME_RECEIPT the public verifier accepts", () => {
  const environment = issuerEnvironment();
  const minted = mintCctpOutcomeReceipt({
    id: "outcome_bridge_matched",
    actionPassportHash: `0x${"b".repeat(64)}`,
    facts: completeFacts(),
    environment,
  });
  assert.equal(minted.ok, true);
  if (!minted.ok) return;

  assert.equal(minted.receipt.kind, "OUTCOME_RECEIPT");
  assert.equal(minted.receipt.schemaVersion, "2.0.0");
  assert.equal(minted.receipt.outcome.status, "MATCHED");
  assert.equal(minted.receipt.outcome.transactionHash, BURN_SIGNATURE);

  const verified = verifySolanaOutcomeReceipt(minted.receipt, {
    trustedPublicKeys: [minted.receipt.issuer.publicKey],
  });
  assert.equal(verified.recognised, true, JSON.stringify(verified.schema));
  assert.equal(verified.schema.valid, true, JSON.stringify(verified.schema));
  assert.equal(verified.integrity.valid, true, JSON.stringify(verified.integrity));
  assert.equal(verified.issuer.verdict, "SIGNATURE_VALID", JSON.stringify(verified.issuer));
  assert.equal(verified.binding.verdict, "SOLANA_PINNED", JSON.stringify(verified.binding));
  assert.equal(verified.outcome?.network, "mainnet");
});

test("the binding says plainly that no SPL transfer action is pinned, because this was a burn", () => {
  const minted = mintCctpOutcomeReceipt({
    id: "outcome_bridge_binding",
    actionPassportHash: `0x${"b".repeat(64)}`,
    facts: completeFacts(),
    environment: issuerEnvironment(),
  });
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const verified = verifySolanaOutcomeReceipt(minted.receipt, {
    trustedPublicKeys: [minted.receipt.issuer.publicKey],
  });
  assert.match(verified.binding.detail, /no SPL transfer action is pinned/);
});

test("the facts survive the round trip through the signed effects", () => {
  const facts = completeFacts();
  const effects = bridgeFactsToEffects({ facts, sourceRef: "host:sig", observedAt: AT });
  assert.ok(effects.length >= 1);
  const parsed = parseBridgeFactsFromEffects(effects);
  assert.deepEqual(parsed, facts);
  assert.equal(encodeBridgeFacts(parsed).length, encodeBridgeFacts(facts).length);
});

test("a missing chunk makes the facts unreadable rather than partially true", () => {
  const effects = bridgeFactsToEffects({ facts: completeFacts(), sourceRef: "host:sig", observedAt: AT });
  if (effects.length < 2) return;
  assert.equal(parseBridgeFactsFromEffects(effects.slice(1)), null);
});

test("the receipt carries the limitations it must state about itself", () => {
  const minted = mintCctpOutcomeReceipt({
    id: "outcome_bridge_limitations",
    actionPassportHash: `0x${"b".repeat(64)}`,
    facts: completeFacts(),
    environment: issuerEnvironment(),
  });
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const parsed = parseBridgeFactsFromEffects(minted.receipt.outcome.observedEffects);
  assert.ok(parsed);
  assert.match(parsed.limitations.join(" "), /anyone holding the message and its attestation may submit it/i);
  assert.match(
    parsed.limitations.join(" "),
    /not a promise that anyone will/i,
    "permissionless is never described as a guarantee that funds cannot be stuck",
  );
  assert.equal(parsed.recovery.secondBurnCreated, false);
});

test("an unsigned deployment still mints, and the verifier says the signature is absent", () => {
  const minted = mintCctpOutcomeReceipt({
    id: "outcome_bridge_unsigned",
    actionPassportHash: `0x${"b".repeat(64)}`,
    facts: completeFacts(),
    environment: {},
  });
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const verified = verifySolanaOutcomeReceipt(minted.receipt, { trustedPublicKeys: [] });
  assert.equal(verified.issuer.verdict, "UNSIGNED");
  assert.equal(verified.integrity.valid, true, "an unsigned receipt is still internally consistent");
});

test("facts that do not parse refuse to mint at all", () => {
  const minted = mintCctpOutcomeReceipt({
    id: "outcome_bridge_invalid",
    actionPassportHash: `0x${"b".repeat(64)}`,
    facts: { schema: "ryntra.solana.bridge-receipt.facts@2" },
    environment: issuerEnvironment(),
  });
  assert.equal(minted.ok, false);
  if (minted.ok) return;
  assert.equal(minted.code, "FACTS_INVALID");
});
