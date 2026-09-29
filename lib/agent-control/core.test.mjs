// Run from repo root: node --test lib/agent-control/core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  AgentActionIntentSchema,
  AgentControlPolicySchema,
  ActionPassportPreviewSchema,
  DemoHumanDecisionSchema,
} = await import("./contracts.ts");
const {
  agentEvidenceRoot,
  createActionPassportPreview,
  evaluateAgentIntent,
  verifyActionPassportPreview,
} = await import("./core.ts");

const NOW = new Date("2026-08-14T12:00:00.000Z");
const HASH_A = `0x${"aa".repeat(32)}`;
const HASH_B = `0x${"bb".repeat(32)}`;

const intent = {
  schemaVersion: "1.0.0",
  id: "agent_intent_demo_001",
  source: {
    kind: "DEMO",
    agentId: "agent_demo_001",
    agentName: "Proof fixture",
    requestId: "request_demo_001",
  },
  subjectRef: "subject:reviewer-demo",
  requestText: "Draft a bounded research job without submitting it.",
  action: {
    kind: "CREATE_JOB_DRAFT",
    provider: "DEMO",
    chainRef: "eip155:97",
    jobType: "BOUNDED_RESEARCH",
    deliverable: "A source-labelled comparison with explicit limitations.",
    budget: null,
    providerRef: null,
    evaluatorRef: null,
    deadline: "2026-08-14T12:45:00.000Z",
    expectedEffects: ["Create an unsigned local draft only."],
  },
  policyRef: { id: "agent_control_demo_policy", version: 1 },
  evidenceRequirements: ["providerCapability", "deliverableScope"],
  humanAuthorizationRequired: true,
  createdAt: "2026-08-14T11:55:00.000Z",
  expiresAt: "2026-08-14T13:00:00.000Z",
  revision: 1,
  idempotencyKey: "agent-demo-idempotency-001",
};

const policy = {
  schemaVersion: "1.0.0",
  id: "agent_control_demo_policy",
  version: 1,
  publishedAt: "2026-08-14T11:00:00.000Z",
  immutable: true,
  allowedChains: ["eip155:97"],
  allowedActions: ["CREATE_JOB_DRAFT"],
  maxBudget: null,
  evidenceMaxAgeSeconds: 300,
  requireHumanAuthorization: true,
  executionEnabled: false,
};

function evidenceOf(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    id: "agent_evidence_provider_001",
    provider: "Ryntra demo fixture",
    sourceRef: "demo://agent-control/provider-capability",
    adapter: "agent-control-demo",
    adapterVersion: "1.0.0",
    sourceType: "PROVIDER_CAPABILITY",
    observedAt: "2026-08-14T11:59:00.000Z",
    receivedAt: "2026-08-14T11:59:01.000Z",
    validUntil: "2026-08-14T12:04:00.000Z",
    confidence: "SOURCE_FIXTURE",
    coverage: {
      subjectRefs: ["subject:reviewer-demo"],
      fields: ["providerCapability", "deliverableScope"],
      limitations: ["DEMO_ONLY"],
    },
    availability: "AVAILABLE",
    verificationStatus: "PROVIDER_REPORTED",
    chainRef: "eip155:97",
    blockRef: null,
    transactionRef: null,
    status: "VALID",
    requestHash: HASH_A,
    responseHash: HASH_B,
    responseDigest: HASH_B,
    reason: null,
    transformationVersion: "agent-control-evidence-v1",
    fallbackUsed: false,
    facts: {
      providerCapability: "DEMO_SOURCE_ONLY",
      deliverableScope: "LOCAL_DRAFT",
    },
    ...overrides,
  };
}

function evaluate({ intentValue = intent, policyValue = policy, evidence = [evidenceOf()] } = {}) {
  return evaluateAgentIntent({
    intent: intentValue,
    policy: policyValue,
    evidence,
    now: NOW,
  });
}

test("strict Agent Control contracts reject unknown fields at every public boundary", () => {
  assert.equal(AgentActionIntentSchema.safeParse({ ...intent, unexpected: true }).success, false);
  assert.equal(
    AgentActionIntentSchema.safeParse({
      ...intent,
      action: { ...intent.action, walletSignature: "0xraw" },
    }).success,
    false,
  );
  assert.equal(AgentControlPolicySchema.safeParse({ ...policy, advisoryOverride: true }).success, false);

  const preview = createActionPassportPreview({ preflight: evaluate(), now: NOW });
  assert.equal(
    ActionPassportPreviewSchema.safeParse({ ...preview, finalized: true }).success,
    false,
  );
});

test("evidence roots and policy references are invariant to adapter result order", () => {
  const first = evidenceOf({ id: "agent_evidence_a" });
  const second = evidenceOf({
    id: "agent_evidence_b",
    sourceRef: "demo://agent-control/deliverable-scope",
    responseHash: HASH_A,
    responseDigest: HASH_A,
  });

  assert.equal(agentEvidenceRoot([first, second]), agentEvidenceRoot([second, first]));
  assert.deepEqual(evaluate({ evidence: [second, first] }).policyResult.evidenceRefs, [
    "agent_evidence_a",
    "agent_evidence_b",
  ]);
});

test("decision precedence is expired, unsupported, blocked, insufficient, then allowed", () => {
  const expired = evaluate({
    intentValue: {
      ...intent,
      action: {
        ...intent.action,
        chainRef: "eip155:1",
        deadline: "2026-08-14T11:59:00.000Z",
      },
      policyRef: { id: "wrong-policy", version: 1 },
      expiresAt: "2026-08-14T11:59:59.000Z",
    },
    evidence: [],
  });
  assert.equal(expired.policyResult.decision, "EXPIRED");

  const unsupported = evaluate({
    intentValue: {
      ...intent,
      action: { ...intent.action, chainRef: "eip155:1" },
      policyRef: { id: "wrong-policy", version: 1 },
    },
    evidence: [],
  });
  assert.equal(unsupported.policyResult.decision, "UNSUPPORTED");

  const blocked = evaluate({
    intentValue: { ...intent, policyRef: { id: "wrong-policy", version: 1 } },
    evidence: [],
  });
  assert.equal(
    blocked.policyResult.decision,
    "BLOCKED_BY_RULE",
    "a deterministic policy mismatch must outrank missing evidence",
  );

  assert.equal(evaluate({ evidence: [] }).policyResult.decision, "INSUFFICIENT_EVIDENCE");
  assert.equal(evaluate().policyResult.decision, "ALLOWED_BY_POLICY");
});

test("stale, conflicting and unavailable evidence are all non-positive", () => {
  const cases = [
    evidenceOf({
      id: "agent_evidence_stale",
      status: "STALE",
      availability: "PARTIAL",
      reason: "OBSERVATION_STALE",
    }),
    evidenceOf({
      id: "agent_evidence_conflicting",
      status: "CONFLICTING",
      availability: "PARTIAL",
      verificationStatus: "CONFLICTING",
      reason: "SOURCES_DISAGREE",
    }),
    evidenceOf({
      id: "agent_evidence_unavailable",
      status: "UNAVAILABLE",
      availability: "UNAVAILABLE",
      verificationStatus: "NOT_VERIFIED",
      reason: "SOURCE_UNAVAILABLE",
    }),
  ];

  for (const evidence of cases) {
    const result = evaluate({ evidence: [evidence] }).policyResult;
    assert.equal(result.decision, "INSUFFICIENT_EVIDENCE", evidence.id);
    assert.ok(result.blockers.includes(`EVIDENCE_${evidence.id}_NOT_VALID`));
  }

  const tooOld = evidenceOf({
    id: "agent_evidence_age_stale",
    observedAt: "2026-08-14T11:54:59.000Z",
    receivedAt: "2026-08-14T11:55:00.000Z",
    validUntil: "2026-08-14T12:04:00.000Z",
  });
  const aged = evaluate({ evidence: [tooOld] }).policyResult;
  assert.equal(aged.decision, "INSUFFICIENT_EVIDENCE");
  assert.ok(aged.blockers.includes("EVIDENCE_agent_evidence_age_stale_STALE"));

  const wrongSubject = evaluate({
    evidence: [evidenceOf({
      id: "agent_evidence_wrong_subject",
      coverage: {
        ...evidenceOf().coverage,
        subjectRefs: ["subject:someone-else"],
      },
    })],
  }).policyResult;
  assert.equal(wrongSubject.decision, "INSUFFICIENT_EVIDENCE");
  assert.ok(wrongSubject.blockers.includes("EVIDENCE_agent_evidence_wrong_subject_SUBJECT_MISMATCH"));

  const futureEvidence = evaluate({
    evidence: [evidenceOf({
      id: "agent_evidence_future",
      observedAt: "2026-08-14T12:00:01.000Z",
      receivedAt: "2026-08-14T12:00:02.000Z",
      validUntil: "2026-08-14T12:05:00.000Z",
    })],
  }).policyResult;
  assert.equal(futureEvidence.decision, "INSUFFICIENT_EVIDENCE");
  assert.ok(futureEvidence.blockers.includes("EVIDENCE_agent_evidence_future_FROM_FUTURE"));
});

test("non-positive evidence carries bounded semantic reason codes into the policy result", () => {
  const result = evaluate({
    evidence: [
      evidenceOf({
        id: "agent_evidence_rwa_reference",
        status: "STALE",
        availability: "PARTIAL",
        reason: "Synthetic RWA market evidence is outside its declared validity window.",
        facts: {
          referenceFresh: false,
          underlyingMarketOpen: false,
          policyReasonCodes: ["REFERENCE_STALE", "MARKET_HOURS_MISMATCH", "not accepted"],
        },
      }),
    ],
  }).policyResult;

  assert.equal(result.decision, "INSUFFICIENT_EVIDENCE");
  assert.ok(result.blockers.includes("EVIDENCE_REASON:REFERENCE_STALE"));
  assert.ok(result.blockers.includes("EVIDENCE_REASON:MARKET_HOURS_MISMATCH"));
  assert.ok(!result.blockers.some((code) => code.includes("not accepted")));
});

test("a material intent mutation invalidates an otherwise valid preview", () => {
  const preview = createActionPassportPreview({
    preflight: evaluate(),
    recordDemoDecision: true,
    now: NOW,
  });
  assert.equal(verifyActionPassportPreview(preview).valid, true);

  const changed = structuredClone(preview);
  changed.intent.action.deliverable = "A materially different deliverable.";
  const verification = verifyActionPassportPreview(changed);
  assert.equal(verification.valid, false);
  assert.ok(verification.issues.includes("INTENT_HASH_MISMATCH"));
});

test("integrity verification recomputes the deterministic policy result", () => {
  const preview = createActionPassportPreview({ preflight: evaluate(), now: NOW });
  const forged = structuredClone(preview);
  forged.policy.result.status = "BLOCK";
  forged.policy.result.decision = "BLOCKED_BY_RULE";
  forged.policy.result.blockers = ["FORGED_BLOCKER"];

  const verification = verifyActionPassportPreview(forged);
  assert.equal(verification.valid, false);
  assert.ok(verification.issues.includes("POLICY_RESULT_MISMATCH"));
});

test("a blocked preflight cannot record even a demo-only acknowledgement", () => {
  const blocked = evaluate({ evidence: [] });
  assert.throws(
    () => createActionPassportPreview({
      preflight: blocked,
      recordDemoDecision: true,
      now: NOW,
    }),
    /allowed preflight/,
  );
});

test("demo acknowledgement stays separate from wallet authorization and execution", () => {
  const preview = createActionPassportPreview({
    preflight: evaluate(),
    recordDemoDecision: true,
    subjectRef: "reviewer_demo",
    now: NOW,
  });

  assert.equal(preview.authorization.status, "RECORDED_DEMO_ONLY");
  assert.equal(preview.authorization.demoOnly, true);
  assert.equal(preview.authorization.method, "LOCAL_DEMO_ACK");
  assert.equal("walletSignature" in preview.authorization, false);
  assert.deepEqual(preview.execution, {
    status: "UNAVAILABLE",
    reasonCode: "NO_PROVIDER_SIGNER",
    jobId: null,
    transactionHash: null,
  });
  assert.equal(
    DemoHumanDecisionSchema.safeParse({
      ...preview.authorization,
      walletSignature: `0x${"11".repeat(65)}`,
    }).success,
    false,
    "a demo acknowledgement cannot be widened into a wallet signature",
  );
});

test("missing actual outcome can verify only as a non-finalized preview", () => {
  const preview = createActionPassportPreview({ preflight: evaluate(), now: NOW });
  const verification = verifyActionPassportPreview(preview);
  assert.deepEqual(
    {
      valid: verification.valid,
      verdict: verification.verdict,
      finalized: verification.finalized,
      outcomeStatus: verification.outcomeStatus,
    },
    {
      valid: true,
      verdict: "PREVIEW_INTEGRITY_VALID",
      finalized: false,
      outcomeStatus: "OUTCOME_NOT_OBSERVED",
    },
  );

  const missingOutcome = structuredClone(preview);
  delete missingOutcome.outcome;
  const missingVerification = verifyActionPassportPreview(missingOutcome);
  assert.equal(missingVerification.valid, false);
  assert.equal(missingVerification.finalized, false);

  assert.equal(
    ActionPassportPreviewSchema.safeParse({
      ...preview,
      outcome: {
        status: "SETTLED",
        observedEffects: [{ transactionHash: HASH_A }],
        sourceRefs: ["chain:demo"],
      },
    }).success,
    false,
    "the preview schema cannot be forged into a finalized execution receipt",
  );
});
