import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createOutcomeReceipt } from "../agent-control/artifacts.ts";
import { attestArtifact, issuerKeyId, loadIssuerKey, ISSUER_PRIVATE_KEY_ENV } from "../agent-control/issuer.ts";
import { AGENT_CONTROL_REGISTRY, registryPin } from "../agent-control/registry.ts";
import {
  SOLANA_CAIP2,
  SOLANA_TOKEN_2022_ADAPTER_REF,
  SPL_TRANSFER_ACTION_REF,
} from "../agent-control/adapters/solana-token-2022.ts";
import { verifyAgentArtifact } from "../agent-control/verify.ts";
import { verifySolanaOutcomeReceipt } from "./receipt.ts";
import "./m2-receipt-correction.ts";
import { needsDevelopmentRepository } from "../development-repository.mjs";

const NOW = new Date("2026-08-17T09:00:00.000Z");

/** A throwaway key generated in memory per run. No real key ever lives here. */
function testKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const encoded = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  return loadIssuerKey({ [ISSUER_PRIVATE_KEY_ENV]: encoded });
}

const SOLANA_PIN = registryPin(AGENT_CONTROL_REGISTRY, [
  SOLANA_TOKEN_2022_ADAPTER_REF,
  SPL_TRANSFER_ACTION_REF,
]);

const OUTCOME = {
  status: "MATCHED",
  chainRef: SOLANA_CAIP2.devnet,
  transactionHash: "5".repeat(88),
  observedEffects: [
    {
      description: "The recipient's token account balance rose by 1000000 base units.",
      sourceRef: "solana:devnet:rpc:getTransaction",
      observedAt: NOW.toISOString(),
    },
  ],
  reconciledAt: NOW.toISOString(),
};

/** Mint a real receipt through the authoritative builder, optionally signed. */
function mintReceipt({ key = null, registry = SOLANA_PIN, outcome = OUTCOME } = {}) {
  const unsigned = createOutcomeReceipt({
    id: "outcome_solana_1",
    actionPassportHash: `0x${"1".repeat(64)}`,
    outcome,
    registry,
    now: NOW,
  });
  if (!key) return unsigned;
  return createOutcomeReceipt({
    id: "outcome_solana_1",
    actionPassportHash: `0x${"1".repeat(64)}`,
    outcome,
    registry,
    issuer: attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: unsigned.contentHash, key, now: NOW }),
    now: NOW,
  });
}

/**
 * The binding assertion this whole module rests on: the bounded verifier and
 * the authoritative one must read the same receipt identically on every axis
 * they share. Everything else here is a case fed through this comparison.
 */
function assertAgreement(artifact, options = {}) {
  const bounded = verifySolanaOutcomeReceipt(artifact, options);
  const full = verifyAgentArtifact(artifact, options.trustedPublicKeys ? { trustedPublicKeys: options.trustedPublicKeys } : {});
  assert.equal(bounded.integrity.valid, full.integrity.valid, "integrity verdicts disagree");
  assert.deepEqual([...bounded.integrity.issues].sort(), [...full.integrity.issues].sort(), "integrity issues disagree");
  assert.equal(bounded.issuer.verdict, full.issuer.verdict, "issuer verdicts disagree");
  assert.equal(bounded.issuer.keyId, full.issuer.keyId, "issuer key ids disagree");
  assert.equal(bounded.issuer.detail, full.issuer.detail, "issuer details disagree");
  return bounded;
}

test("a clean signed Solana receipt verifies on every axis, and both verifiers agree", function () {
  const key = testKey();
  const receipt = mintReceipt({ key });

  const result = assertAgreement(receipt);
  assert.equal(result.recognised, true);
  assert.equal(result.kind, "OUTCOME_RECEIPT");
  assert.equal(result.schemaVersion, "2.0.0");
  assert.equal(result.schema.valid, true);
  assert.equal(result.integrity.valid, true);
  assert.deepEqual(result.integrity.issues, []);
  assert.equal(result.issuer.verdict, "SIGNATURE_VALID");
  assert.equal(result.issuer.keyId, issuerKeyId(key.publicKey));
  assert.equal(result.binding.verdict, "SOLANA_PINNED");
  assert.equal(result.outcome.status, "MATCHED");
  assert.equal(result.outcome.network, "devnet");
  assert.equal(result.outcome.observedEffects, 1);
});

test("an unsigned receipt is unsigned, not invalid — and its content still verifies", function () {
  const result = assertAgreement(mintReceipt());
  assert.equal(result.integrity.valid, true);
  assert.equal(result.issuer.verdict, "UNSIGNED");
  assert.equal(result.issuer.detail, "NO_ISSUER_KEY_CONFIGURED");
});

test("a trusted-key list separates a sound signature from Ryntra's signature", function () {
  const key = testKey();
  const receipt = mintReceipt({ key });

  const trusted = assertAgreement(receipt, { trustedPublicKeys: [key.publicKey] });
  assert.equal(trusted.issuer.verdict, "SIGNATURE_VALID");

  const stranger = assertAgreement(receipt, { trustedPublicKeys: [testKey().publicKey] });
  assert.equal(stranger.issuer.verdict, "UNTRUSTED_KEY");
  /* The distinction the axis exists for: valid bytes, unpublished key. */
  assert.equal(stranger.integrity.valid, true);
});

test("one edited character in the observation breaks both hashes and the signature", function () {
  const key = testKey();
  const receipt = mintReceipt({ key });
  const tampered = {
    ...receipt,
    outcome: { ...receipt.outcome, status: "FAILED" },
  };

  const result = assertAgreement(tampered);
  assert.equal(result.integrity.valid, false);
  assert.deepEqual([...result.integrity.issues].sort(), ["CONTENT_HASH_MISMATCH", "INTEGRITY_HASH_MISMATCH"]);
  /* The signature covers the content hash, and the content hash was not
     recomputed by the editor — so the signature still matches the stale hash
     it was made over. The integrity axis is what catches this, which is
     exactly why the axes are reported separately. */
  assert.equal(result.issuer.verdict, "SIGNATURE_VALID");
});

test("a swapped signature is caught while the content stays intact", function () {
  const mine = testKey();
  const theirs = testKey();
  const receipt = mintReceipt({ key: mine });
  const swapped = {
    ...receipt,
    issuer: attestArtifact({
      kind: "OUTCOME_RECEIPT",
      contentHash: `0x${"9".repeat(64)}`,
      key: theirs,
      now: NOW,
    }),
  };

  const result = assertAgreement(swapped);
  assert.equal(result.issuer.verdict, "SIGNATURE_INVALID");
  assert.equal(result.issuer.detail, "the signature does not cover this artifact's content hash");
  /* The outer seal covers the issuer block, so swapping it is visible too. */
  assert.deepEqual(result.integrity.issues, ["INTEGRITY_HASH_MISMATCH"]);
});

test("a key id that does not derive from its own key is refused", function () {
  const key = testKey();
  const receipt = mintReceipt({ key });
  const relabelled = {
    ...receipt,
    issuer: { ...receipt.issuer, keyId: "ryntra-issuer-0000000000000000" },
  };

  const result = assertAgreement(relabelled);
  assert.equal(result.issuer.verdict, "SIGNATURE_INVALID");
  assert.equal(result.issuer.detail, "the key id does not derive from the key it names");
});

test("a valid receipt for another chain is a valid receipt and is not a Solana one", function () {
  const receipt = mintReceipt({
    registry: registryPin(AGENT_CONTROL_REGISTRY, ["adapter:bnb-apex@1", "action:bnb-apex/fund-job@1"]),
    outcome: { ...OUTCOME, chainRef: "eip155:97" },
  });

  const result = assertAgreement(receipt);
  assert.equal(result.integrity.valid, true);
  assert.equal(result.binding.verdict, "NOT_SOLANA");
  assert.match(result.binding.detail, /adapter:solana-token-2022@1/);
  assert.equal(result.outcome.network, null);
});

test("the signed M2 Jupiter receipt is Solana-pinned and reports its historical lane mismatch", { skip: needsDevelopmentRepository("the evidence archive under docs/tasks/evidence/") }, function () {
  const receipt = JSON.parse(
    readFileSync("docs/tasks/evidence/RYN-SOL-M2-outcome-receipt.json", "utf8"),
  );
  const chain = JSON.parse(
    readFileSync("docs/tasks/evidence/RYN-SOL-M2-chain-evidence.json", "utf8"),
  );
  const result = assertAgreement(receipt, {
    trustedPublicKeys: [chain.receipt.publishedIssuer.publicKey],
  });

  assert.equal(result.schema.valid, true);
  assert.equal(result.integrity.valid, true);
  assert.equal(result.issuer.verdict, "SIGNATURE_VALID");
  assert.equal(receipt.issuer.publicKey, chain.receipt.publishedIssuer.publicKey);
  assert.equal(result.binding.verdict, "SOLANA_PINNED_WITH_PROVENANCE_MISMATCH");
  assert.match(result.binding.detail, /LEGACY_ACTION_PATH_REF_INACCURATE/);
  assert.deepEqual(result.correction?.codes, [
    "LEGACY_SUBMISSION_LIMITATION_INACCURATE",
    "LEGACY_ACTION_PATH_REF_INACCURATE",
  ]);
  assert.match(result.correction?.correctionHash ?? "", /^0x[0-9a-f]{64}$/);
  assert.equal(result.outcome.network, "mainnet");
});

test("a receipt-shaped object that is not a receipt fails on schema before anything else", function () {
  const result = verifySolanaOutcomeReceipt({ kind: "OUTCOME_RECEIPT", schemaVersion: "2.0.0" });
  assert.equal(result.recognised, true);
  assert.equal(result.schema.valid, false);
  assert.ok(result.schema.issues.length > 0);
  assert.deepEqual(result.integrity.issues, ["SCHEMA_INVALID"]);
  assert.equal(result.binding.verdict, "UNREADABLE");
  assert.equal(result.outcome, null);
});

test("anything that is not an outcome receipt is unrecognised rather than guessed at", function () {
  for (const value of [null, undefined, 42, "receipt", {}, { kind: "ACTION_PASSPORT" }]) {
    const result = verifySolanaOutcomeReceipt(value);
    assert.equal(result.recognised, false, `${JSON.stringify(value)} was recognised`);
    assert.equal(result.kind, null);
  }
});

test("an unknown extra field is refused rather than ignored", function () {
  const receipt = mintReceipt();
  const result = verifySolanaOutcomeReceipt({ ...receipt, note: "added later" });
  assert.equal(result.schema.valid, false);
  assert.ok(result.schema.issues.some((issue) => issue.includes("note") || issue.includes("Unrecognized")));
});

test("the verifier writes no hashing of its own — it imports the frozen ones", function () {
  const source = readFileSync(new URL("./receipt.ts", import.meta.url), "utf8");
  const withoutComments = source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");
  /* A second canonicalizer is the failure this module is designed against:
     the signature covers exact bytes, and bytes reconstructed differently
     verify nothing. Only the shared hasher and preimage may appear. */
  assert.match(withoutComments, /hashAgentPayloadV2[\s\S]*from "\.\.\/agent-control\/canonical\.ts"/);
  assert.ok(!withoutComments.includes("JSON.stringify"), "receipt.ts serializes for hashing on its own");
  assert.ok(!withoutComments.includes("canonicalJson("), "receipt.ts calls the canonicalizer directly");
  /* One `createHash` is allowed and only one: the issuer key id, which is a
     digest of a base64 string and not of any signed payload. */
  assert.equal(withoutComments.match(/createHash\(/g).length, 1, "receipt.ts hashes more than the key id");
  assert.match(withoutComments, /createHash\("sha256"\)\.update\(publicKeyBase64/);
});

test("every shipped receipt fixture reads identically to the authoritative verifier", function () {
  /* The fixtures are what the public kit tests against, so they are the one
     place a stale artifact could quietly make a green public CI meaningless.
     They are minted by the real builder and re-checked here against the
     authoritative verifier every run. */
  const expected = {
    "receipt-solana-matched-signed": { integrity: true, issuer: "SIGNATURE_VALID", binding: "SOLANA_PINNED" },
    "receipt-solana-deviation-unsigned": { integrity: true, issuer: "UNSIGNED", binding: "SOLANA_PINNED" },
    "receipt-other-chain-signed": { integrity: true, issuer: "SIGNATURE_VALID", binding: "NOT_SOLANA" },
    "receipt-solana-tampered": { integrity: false, issuer: "SIGNATURE_VALID", binding: "SOLANA_PINNED" },
  };
  for (const [name, want] of Object.entries(expected)) {
    const artifact = JSON.parse(
      readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
    );
    const bounded = assertAgreement(artifact);
    assert.equal(bounded.integrity.valid, want.integrity, `${name} integrity`);
    assert.equal(bounded.issuer.verdict, want.issuer, `${name} issuer`);
    assert.equal(bounded.binding.verdict, want.binding, `${name} binding`);
  }
});

test("no receipt fixture carries private key material", function () {
  for (const name of [
    "receipt-solana-matched-signed",
    "receipt-solana-deviation-unsigned",
    "receipt-other-chain-signed",
    "receipt-solana-tampered",
  ]) {
    const text = readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /PRIVATE KEY/);
    assert.doesNotMatch(text, /privateKey/);
    const artifact = JSON.parse(text);
    /* A public key is the whole point of a verifiable receipt; a secret is
       never a field the schema has, and this asserts the shape stayed that
       way for the artifacts we publish. */
    assert.deepEqual(
      Object.keys(artifact.issuer).sort(),
      artifact.issuer.status === "SIGNED"
        ? ["algorithm", "keyId", "publicKey", "signature", "signedAt", "status"]
        : ["keyId", "publicKey", "reasonCode", "signature", "signedAt", "status"],
    );
  }
});
