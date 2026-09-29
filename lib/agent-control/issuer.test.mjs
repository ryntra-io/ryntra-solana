import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NO_AUTHORIZATION_PROOF,
  UNSIGNED_ATTESTATION,
  sealArtifact,
} from "./artifacts.ts";
import {
  ISSUER_PRIVATE_KEY_ENV,
  attestArtifact,
  issuerKeyId,
  loadIssuerKey,
  publishedIssuerKey,
  verifyIssuerAttestation,
} from "./issuer.ts";
import { AGENT_CONTROL_REGISTRY, registryPin } from "./registry.ts";
import { verifyAgentArtifact } from "./verify.ts";

const NOW = new Date("2026-08-17T12:00:00.000Z");
const PIN = registryPin(AGENT_CONTROL_REGISTRY, ["adapter:bnb-apex@1"]);

/**
 * A throwaway key, generated in memory for each run and never written down.
 * The production key is the founder's to create and install; this file must
 * never be the place a real one appears, and the tracked-credential scan covers
 * the repository precisely so that stays true.
 */
function testKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const encoded = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  return { encoded, environment: { [ISSUER_PRIVATE_KEY_ENV]: encoded } };
}

function receiptCore(overrides = {}) {
  return {
    schemaVersion: "2.0.0",
    kind: "OUTCOME_RECEIPT",
    id: "outcome_1",
    createdAt: NOW.toISOString(),
    maturity: "OBSERVED",
    registry: PIN,
    actionPassportHash: `0x${"1".repeat(64)}`,
    outcome: {
      status: "MATCHED",
      chainRef: "eip155:97",
      transactionHash: "0xabc",
      observedEffects: [
        { description: "job funded", sourceRef: "https://example.invalid/tx", observedAt: NOW.toISOString() },
      ],
      reconciledAt: NOW.toISOString(),
    },
    limitations: [
      "OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION",
      "Ryntra observed and reconciled this outcome; it did not sign, submit, fund or execute it.",
    ],
    ...overrides,
  };
}

test("with no key configured the artifact is explicitly unsigned, never fabricated", () => {
  assert.equal(loadIssuerKey({}), null);
  assert.equal(loadIssuerKey({ [ISSUER_PRIVATE_KEY_ENV]: "   " }), null);

  const attestation = attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: `0x${"2".repeat(64)}`, key: null });
  assert.deepEqual(attestation, UNSIGNED_ATTESTATION);
  assert.equal(attestation.status, "UNSIGNED");
  assert.equal(attestation.reasonCode, "NO_ISSUER_KEY_CONFIGURED");
  assert.equal(attestation.signature, null, "an unsigned artifact must carry no signature-shaped value");

  const published = publishedIssuerKey(null);
  assert.equal(published.status, "NOT_CONFIGURED");
  assert.equal(published.publicKey, null);
});

test("a key that is present but unusable throws rather than downgrading to unsigned", () => {
  /* Silently treating a broken key as "no key" would hide a real
     misconfiguration behind a perfectly normal-looking artifact. */
  assert.throws(() => loadIssuerKey({ [ISSUER_PRIVATE_KEY_ENV]: "not-base64-der" }), /not a usable PKCS#8 key/);

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsa = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  assert.throws(() => loadIssuerKey({ [ISSUER_PRIVATE_KEY_ENV]: rsa }), /must be an Ed25519 key/);
});

test("a signed artifact verifies, and its key id derives from its own key", () => {
  const key = loadIssuerKey(testKey().environment);
  const sealed = sealArtifact(receiptCore(), UNSIGNED_ATTESTATION);
  const attestation = attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: sealed.contentHash, key, now: NOW });

  assert.equal(attestation.status, "SIGNED");
  assert.equal(attestation.algorithm, "Ed25519");
  assert.equal(attestation.keyId, issuerKeyId(attestation.publicKey));

  const axis = verifyIssuerAttestation({
    kind: "OUTCOME_RECEIPT",
    contentHash: sealed.contentHash,
    attestation,
  });
  assert.equal(axis.verdict, "SIGNATURE_VALID");
  assert.equal(axis.keyId, key.keyId);

  assert.equal(publishedIssuerKey(key).status, "PUBLISHED");
  assert.equal(publishedIssuerKey(key).publicKey, attestation.publicKey);
  assert.match(publishedIssuerKey(key).note, /cannot authorize a transaction/);
});

test("the signature is over the content hash, so signing does not move what it covers", () => {
  const key = loadIssuerKey(testKey().environment);
  const core = receiptCore();
  const unsigned = sealArtifact(core, UNSIGNED_ATTESTATION);
  const attestation = attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: unsigned.contentHash, key, now: NOW });
  const signed = sealArtifact(core, attestation);

  assert.equal(signed.contentHash, unsigned.contentHash);
  assert.equal(
    verifyIssuerAttestation({ kind: "OUTCOME_RECEIPT", contentHash: signed.contentHash, attestation }).verdict,
    "SIGNATURE_VALID",
  );
});

test("a signature made over one artifact kind does not verify against another", () => {
  /* Domain separation carried into the signature: without the kind in the
     signed bytes, a receipt's signature would transfer onto a passport. */
  const key = loadIssuerKey(testKey().environment);
  const contentHash = `0x${"3".repeat(64)}`;
  const attestation = attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash, key, now: NOW });

  assert.equal(verifyIssuerAttestation({ kind: "OUTCOME_RECEIPT", contentHash, attestation }).verdict, "SIGNATURE_VALID");
  assert.equal(verifyIssuerAttestation({ kind: "ACTION_PASSPORT", contentHash, attestation }).verdict, "SIGNATURE_INVALID");
});

test("a valid signature by an unpublished key is a separate finding from an invalid one", () => {
  const mine = loadIssuerKey(testKey().environment);
  const theirs = loadIssuerKey(testKey().environment);
  const contentHash = `0x${"4".repeat(64)}`;
  const attestation = attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash, key: theirs, now: NOW });

  const axis = verifyIssuerAttestation({
    kind: "OUTCOME_RECEIPT",
    contentHash,
    attestation,
    trustedPublicKeys: [mine.publicKey],
  });
  assert.equal(axis.verdict, "UNTRUSTED_KEY", "signed by someone must never read as signed by Ryntra");
  assert.match(axis.detail, /valid but the key is not one this verifier publishes/);

  const trusted = verifyIssuerAttestation({
    kind: "OUTCOME_RECEIPT",
    contentHash,
    attestation,
    trustedPublicKeys: [theirs.publicKey],
  });
  assert.equal(trusted.verdict, "SIGNATURE_VALID");
});

test("a key id that does not derive from its own key is refused", () => {
  const key = loadIssuerKey(testKey().environment);
  const contentHash = `0x${"5".repeat(64)}`;
  const attestation = attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash, key, now: NOW });

  const relabelled = { ...attestation, keyId: "ryntra-issuer-0000000000000000" };
  assert.equal(
    verifyIssuerAttestation({ kind: "OUTCOME_RECEIPT", contentHash, attestation: relabelled }).verdict,
    "SIGNATURE_INVALID",
  );
});

test("a tampered artifact fails the signature axis while the other two still report", () => {
  /* The acceptance criterion for keeping the axes separate: one broken axis
     must not blank the others, or a reader cannot tell what actually went
     wrong. */
  const key = loadIssuerKey(testKey().environment);
  const core = receiptCore();
  const unsigned = sealArtifact(core, UNSIGNED_ATTESTATION);
  const attestation = attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: unsigned.contentHash, key, now: NOW });
  const signed = sealArtifact(core, attestation);

  const good = verifyAgentArtifact(signed, { trustedPublicKeys: [key.publicKey] });
  assert.equal(good.integrity.valid, true);
  assert.equal(good.issuer.verdict, "SIGNATURE_VALID");
  assert.equal(good.observation.verdict, "OBSERVED");

  const tampered = sealArtifact(
    { ...core, outcome: { ...core.outcome, transactionHash: "0xdifferent" } },
    attestation,
  );
  const result = verifyAgentArtifact(tampered, { trustedPublicKeys: [key.publicKey] });
  assert.equal(result.issuer.verdict, "SIGNATURE_INVALID", "the signature no longer covers this content");
  assert.equal(result.observation.verdict, "OBSERVED", "the observation axis still reports");
  assert.equal(result.authorization.verdict, "NOT_APPLICABLE", "the authorization axis still reports");
  assert.equal(result.recognised, true);
});

test("no key material is committed anywhere in the repository", () => {
  /* Stated on the card as a founder gate, so it is checked rather than
     promised. The env var may be named in source; a value may never be. */
  const sources = [
    "lib/agent-control/issuer.ts",
    "lib/agent-control/issuer.test.mjs",
    "lib/agent-control/verify.ts",
  ];
  for (const path of sources) {
    const source = readFileSync(path, "utf8");
    assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(source), `${path} carries key material`);
    assert.ok(
      !new RegExp(`${ISSUER_PRIVATE_KEY_ENV}\\s*[:=]\\s*["'][A-Za-z0-9+/]{40,}`).test(source),
      `${path} assigns a literal issuer key`,
    );
  }
});

test("an artifact with no authorization is a valid artifact, and the slot exists only where it belongs", () => {
  const key = loadIssuerKey(testKey().environment);
  const core = receiptCore();
  const unsigned = sealArtifact(core, UNSIGNED_ATTESTATION);
  const attestation = attestArtifact({
    kind: "OUTCOME_RECEIPT",
    contentHash: unsigned.contentHash,
    key,
    now: NOW,
  });

  const result = verifyAgentArtifact(sealArtifact(core, attestation), {
    trustedPublicKeys: [key.publicKey],
  });
  assert.equal(result.integrity.valid, true, "an unauthorized artifact is still a valid artifact");
  assert.equal(result.issuer.verdict, "SIGNATURE_VALID");
  assert.equal(
    result.authorization.verdict,
    "NOT_APPLICABLE",
    "an observation is not something a human authorizes after the fact",
  );

  /* And the slot cannot be bolted on where the model does not have one. A
     receipt records what a chain was seen to do; there is nothing for a human
     to have authorized about it, so the strict schema refuses the field
     outright rather than carrying a permanently empty one. */
  const withProof = verifyAgentArtifact(sealArtifact(core, attestation, NO_AUTHORIZATION_PROOF));
  assert.equal(withProof.integrity.valid, false);
  assert.equal(withProof.kind, "OUTCOME_RECEIPT", "the kind is still recognised, only the shape is refused");
});

test("a field that moves between minting and signing breaks the signature", () => {
  /*
   * Found on the live site, not here, which is why it is now here. The receipt
   * route minted once to get a content hash, signed it, then minted again to
   * attach the attestation - and the second mint stamped its own createdAt, so
   * the artifact carried a hash the signature had never covered. The verifier
   * said SIGNATURE_INVALID, correctly.
   *
   * A signature is a claim about exact bytes. Any field that moves between the
   * two mints breaks it, and the fix is one timestamp shared by both.
   */
  const key = loadIssuerKey(testKey().environment);
  const core = receiptCore();

  const sealed = sealArtifact(core, UNSIGNED_ATTESTATION);
  const attestation = attestArtifact({
    kind: "OUTCOME_RECEIPT",
    contentHash: sealed.contentHash,
    key,
    now: NOW,
  });

  const sameBytes = verifyAgentArtifact(sealArtifact(core, attestation), {
    trustedPublicKeys: [key.publicKey],
  });
  assert.equal(sameBytes.issuer.verdict, "SIGNATURE_VALID");

  const movedField = verifyAgentArtifact(
    sealArtifact({ ...core, createdAt: "2026-08-17T12:00:01.000Z" }, attestation),
    { trustedPublicKeys: [key.publicKey] },
  );
  assert.equal(movedField.issuer.verdict, "SIGNATURE_INVALID");
  assert.equal(movedField.integrity.valid, true, "the artifact is intact; only the signature no longer fits");
});
