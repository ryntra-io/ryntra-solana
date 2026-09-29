import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AGENT_HASH_DOMAINS_V2, hashAgentPayloadV2 } from "./canonical.ts";
import { evaluateAgentIntent, verifyActionPassportPreview } from "./core.ts";
import {
  AGENT_CONTROL_DEMO_POLICY,
  createAgentControlDemoEvidence,
  createAgentControlDemoIntent,
} from "./demo.ts";
import { AGENT_CONTROL_REGISTRY, registryPin, resolveRegistryRef } from "./registry.ts";
import {
  ACTION_PASSPORT_V2_LIMITATIONS,
  AGENT_ARTIFACT_KINDS,
  ARTIFACT_HASH_DOMAIN_BY_KIND,
  ActionPassportArtifactSchema,
  AgentActionIntentV2Schema,
  AuthorizationProofSchema,
  DemoAcknowledgementSchema,
  NO_AUTHORIZATION_PROOF,
  ObservedOutcomeSchema,
  OutcomeReceiptArtifactSchema,
  UNSIGNED_ATTESTATION,
  createOutcomeReceipt,
  sealArtifact,
} from "./artifacts.ts";

const PIN = registryPin(AGENT_CONTROL_REGISTRY, ["adapter:bnb-apex@1", "action:bnb-apex/fund-job@1"]);
const NOW = new Date("2026-08-17T12:00:00.000Z");

const OBSERVED = {
  status: "MATCHED",
  chainRef: "eip155:97",
  transactionHash: "0xabc",
  observedEffects: [
    { description: "job funded", sourceRef: "https://example.invalid/tx", observedAt: "2026-08-17T11:59:00.000Z" },
  ],
  reconciledAt: "2026-08-17T12:00:00.000Z",
};

/**
 * A real v2 `ActionPassport`, built from the shipped demo through the registry.
 *
 * It doubles as the proof that the v2 model accepts an artifact carrying the
 * actual intent, evidence and policy the product produces — a schema that has
 * only ever been shown invalid inputs has not been shown to work.
 */
function validActionPassport() {
  const preflight = evaluateAgentIntent({
    intent: createAgentControlDemoIntent(NOW),
    policy: AGENT_CONTROL_DEMO_POLICY,
    evidence: createAgentControlDemoEvidence(NOW),
    now: NOW,
  });
  const legacy = preflight.intent;
  const action = resolveRegistryRef(
    AGENT_CONTROL_REGISTRY,
    "action:bnb-apex/create-job-draft@1",
    "ACTION_SCHEMA",
  );
  const intent = AgentActionIntentV2Schema.parse({
    schemaVersion: "2.0.0",
    id: legacy.id,
    source: {
      ref: "source:demo@1",
      agentId: legacy.source.agentId,
      agentName: legacy.source.agentName,
      requestId: legacy.source.requestId,
    },
    subjectRef: legacy.subjectRef,
    requestText: legacy.requestText,
    action: {
      canonicalClass: action.canonicalClass,
      ref: action.ref,
      budgetRule: action.budget,
      chainRef: legacy.action.chainRef,
      jobType: legacy.action.jobType,
      deliverable: legacy.action.deliverable,
      budget: legacy.action.budget,
      providerRef: legacy.action.providerRef,
      evaluatorRef: legacy.action.evaluatorRef,
      deadline: legacy.action.deadline,
      expectedEffects: legacy.action.expectedEffects,
    },
    policyRef: legacy.policyRef,
    evidenceRequirements: legacy.evidenceRequirements,
    humanAuthorizationRequired: true,
    createdAt: legacy.createdAt,
    expiresAt: legacy.expiresAt,
    revision: legacy.revision,
    idempotencyKey: legacy.idempotencyKey,
  });
  const intentHash = hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.intent, intent);

  return ActionPassportArtifactSchema.parse(
    sealArtifact(
      {
        schemaVersion: "2.0.0",
        kind: "ACTION_PASSPORT",
        id: `action-passport_${intentHash.slice(2, 18)}`,
        createdAt: NOW.toISOString(),
        maturity: "SOURCE_PREVIEW",
        registry: registryPin(AGENT_CONTROL_REGISTRY, [
          "source:demo@1",
          "adapter:bnb-apex@1",
          "action:bnb-apex/create-job-draft@1",
        ]),
        intent,
        intentHash,
        evidence: { items: preflight.evidence, root: preflight.evidenceRoot },
        policy: { definition: preflight.policy, result: preflight.policyResult },
        demoAcknowledgement: {
          status: "RECORDED_DEMO_ONLY",
          demoOnly: true,
          subjectRef: "reviewer_demo",
          intentHash,
          recordedAt: NOW.toISOString(),
        },
        execution: { status: "UNAVAILABLE", reasonCode: "NO_PROVIDER_SIGNER" },
        limitations: ACTION_PASSPORT_V2_LIMITATIONS,
      },
      UNSIGNED_ATTESTATION,
      NO_AUTHORIZATION_PROOF,
    ),
  );
}

test("the three artifact types are distinct in kind and in hash domain", () => {
  assert.deepEqual(AGENT_ARTIFACT_KINDS, ["AGENT_PASSPORT", "ACTION_PASSPORT", "OUTCOME_RECEIPT"]);
  const domains = AGENT_ARTIFACT_KINDS.map((kind) => ARTIFACT_HASH_DOMAIN_BY_KIND[kind]);
  assert.equal(new Set(domains).size, 3, "two artifact kinds share a hash domain");
  for (const domain of domains) {
    assert.ok(Object.values(AGENT_HASH_DOMAINS_V2).includes(domain));
  }
});

test("an OutcomeReceipt cannot exist without an observation", () => {
  /*
   * The acceptance criterion for this type. v1 had to carry
   * OUTCOME_NOT_OBSERVED forever because the outcome was a field on the
   * proposal; here the absence of an outcome is the absence of the artifact.
   */
  assert.throws(() => ObservedOutcomeSchema.parse({ ...OBSERVED, observedEffects: [] }));
  assert.throws(() =>
    ObservedOutcomeSchema.parse({
      ...OBSERVED,
      observedEffects: [{ description: "something happened", observedAt: OBSERVED.reconciledAt }],
    }), /* an effect with no source is not an observation */
  );
  assert.throws(() =>
    createOutcomeReceipt({
      id: "outcome_1",
      actionPassportHash: `0x${"1".repeat(64)}`,
      outcome: undefined,
      registry: PIN,
      now: NOW,
    }));

  const receipt = createOutcomeReceipt({
    id: "outcome_1",
    actionPassportHash: `0x${"1".repeat(64)}`,
    outcome: OBSERVED,
    registry: PIN,
    now: NOW,
  });
  assert.equal(receipt.kind, "OUTCOME_RECEIPT");
  assert.equal(receipt.schemaVersion, "2.0.0");
  assert.equal(receipt.maturity, "OBSERVED");
  assert.equal(receipt.issuer.status, "UNSIGNED", "no key is configured in this packet");
  assert.equal(receipt.issuer.reasonCode, "NO_ISSUER_KEY_CONFIGURED");
  assert.deepEqual(OutcomeReceiptArtifactSchema.parse(receipt), receipt);
});

test("an OutcomeReceipt never makes a universal claim about who submitted the observed bytes", () => {
  const receipt = createOutcomeReceipt({
    id: "outcome_submission_roles",
    actionPassportHash: `0x${"1".repeat(64)}`,
    outcome: OBSERVED,
    registry: PIN,
    now: NOW,
  });

  const limitation = receipt.limitations.join(" ");
  assert.doesNotMatch(limitation, /did not[^.]*\bsubmit\b/i);
  assert.doesNotMatch(limitation, /did not[^.]*\bexecute\b/i);
  assert.match(limitation, /wallet supplied any required signature/i);
});

test("this repository produces no OutcomeReceipt, because nothing here observes an outcome", () => {
  /* The claim is checkable, so it is checked: no shipped module builds one.
     `RYN-AGENT-CONTROL-007` is where the first real receipt comes from. */
  const callers = ["lib/agent-control/demo.ts", "lib/agent-control/core.ts"];
  for (const path of callers) {
    assert.ok(!readFileSync(path, "utf8").includes("createOutcomeReceipt"), `${path} builds an outcome receipt`);
  }
});

test("the content hash covers the content and neither proof axis", () => {
  const core = {
    schemaVersion: "2.0.0",
    kind: "OUTCOME_RECEIPT",
    id: "outcome_1",
    createdAt: NOW.toISOString(),
    maturity: "OBSERVED",
    registry: PIN,
    actionPassportHash: `0x${"1".repeat(64)}`,
    outcome: OBSERVED,
    limitations: [
      "OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION",
      "Ryntra observed and reconciled this outcome; it did not sign, submit, fund or execute it.",
    ],
  };

  const unsigned = sealArtifact(core, UNSIGNED_ATTESTATION);
  const signed = sealArtifact(core, {
    status: "SIGNED",
    algorithm: "Ed25519",
    keyId: "ryntra-issuer-test",
    publicKey: "A".repeat(43) + "=",
    signature: "B".repeat(86) + "==",
    signedAt: NOW.toISOString(),
  });

  assert.equal(
    unsigned.contentHash,
    signed.contentHash,
    "signing moved the hash the signature is supposed to be over",
  );
  assert.notEqual(
    unsigned.integrity.hash,
    signed.integrity.hash,
    "the outer seal must notice a swapped signature",
  );
});

test("a demo acknowledgement is never promoted to an authorization", () => {
  /* Three independent refusals, because this is the canon's own red line. */

  // 1. The type cannot express a real authorization: demoOnly is a literal.
  assert.throws(() =>
    DemoAcknowledgementSchema.parse({
      status: "RECORDED_DEMO_ONLY",
      demoOnly: false,
      subjectRef: "reviewer",
      intentHash: `0x${"2".repeat(64)}`,
      recordedAt: NOW.toISOString(),
    }));

  // 2. An acknowledgement with no bindings cannot claim to be recorded.
  assert.throws(() =>
    DemoAcknowledgementSchema.parse({
      status: "RECORDED_DEMO_ONLY",
      demoOnly: true,
      subjectRef: null,
      intentHash: null,
      recordedAt: null,
    }));

  // 3. An artifact cannot carry both, so neither can corroborate the other.
  //
  //    Built from a genuinely valid artifact rather than from a stub, because
  //    zod does not run `superRefine` when the base shape already failed — a
  //    stub would have "passed" this test while proving only that a stub is
  //    invalid, which is the class of test that catches nothing.
  const valid = validActionPassport();
  assert.equal(ActionPassportArtifactSchema.safeParse(valid).success, true, "the fixture must be valid first");

  const parsed = ActionPassportArtifactSchema.safeParse({
    ...valid,
    authorizationProof: {
      status: "PRESENT",
      method: "EIP712",
      subjectRef: "0xowner",
      contentHash: valid.contentHash,
      nonce: "nonce-12345678",
      expiresAt: "2026-08-18T12:00:00.000Z",
      signature: "0x" + "f".repeat(130),
    },
  });
  assert.equal(parsed.success, false);
  assert.ok(
    parsed.error.issues.some((issue) => issue.message.includes("never an authorization")),
    "the demo/authorization collision must be refused by name",
  );

  // 4. An acknowledgement bound to a different intent is refused.
  const rebound = ActionPassportArtifactSchema.safeParse({
    ...valid,
    demoAcknowledgement: { ...valid.demoAcknowledgement, intentHash: `0x${"9".repeat(64)}` },
  });
  assert.equal(rebound.success, false);
});

test("the authorization proof is defined and required nowhere", () => {
  assert.deepEqual(NO_AUTHORIZATION_PROOF, {
    status: "NOT_PRESENT",
    reasonCode: "NOT_SUPPORTED_IN_THIS_RELEASE",
  });
  assert.deepEqual(AuthorizationProofSchema.parse(NO_AUTHORIZATION_PROOF), NO_AUTHORIZATION_PROOF);

  const present = AuthorizationProofSchema.parse({
    status: "PRESENT",
    method: "EIP712",
    subjectRef: "0xowner",
    contentHash: `0x${"3".repeat(64)}`,
    nonce: "nonce-12345678",
    expiresAt: "2026-08-18T12:00:00.000Z",
    signature: "0x" + "f".repeat(130),
  });
  assert.equal(present.method, "EIP712", "the shape RYN-AGENT-CONTROL-007 will fill exists already");
});

test("an artifact written before this packet still verifies", () => {
  /*
   * The stored fixture is a real v1 ActionPassportPreview captured from the
   * code as it stood before the v2 model existed. If a refactor ever moves the
   * legacy path, this fails — which matters because nothing else reads v1
   * bytes any more, so the breakage would otherwise be silent.
   */
  const legacy = JSON.parse(
    readFileSync("lib/agent-control/fixtures/legacy-action-passport-1.0.0.json", "utf8"),
  );
  assert.equal(legacy.schemaVersion, "1.0.0");
  assert.equal(legacy.kind, "ACTION_PASSPORT_PREVIEW");

  const result = verifyActionPassportPreview(legacy);
  assert.deepEqual(result.issues, []);
  assert.equal(result.valid, true);
  assert.equal(result.verdict, "PREVIEW_INTEGRITY_VALID");
  assert.equal(result.finalized, false);

  const tampered = { ...legacy, intent: { ...legacy.intent, requestText: "edited" } };
  assert.equal(verifyActionPassportPreview(tampered).valid, false, "the legacy path still detects tampering");
});
