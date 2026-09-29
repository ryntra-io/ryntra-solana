import { compareCanonicalStrings } from "../guard/canonical-json.ts";
import { compareDecimalStrings } from "../guard/kernel.ts";
import {
  EvidenceItemSchema,
  PolicyResultSchema,
} from "../guard/contracts.ts";
import { AGENT_HASH_DOMAINS, hashAgentPayload } from "./canonical.ts";
import {
  ACTION_PASSPORT_PREVIEW_LIMITATIONS,
  AgentActionIntentSchema,
  AgentControlPolicySchema,
  ActionPassportPreviewSchema,
  type AgentActionIntent,
  type AgentControlPolicy,
  type ActionPassportPreview,
} from "./contracts.ts";

type EvidenceItem = ReturnType<typeof EvidenceItemSchema.parse>;

const POLICY_REASON_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;

/**
 * Evidence adapters may attach domain reason codes to a non-positive item.
 * They remain evidence reasons — never an authorization — and are accepted
 * only in the bounded machine-code shape the policy result contract can carry.
 */
function evidencePolicyReasonCodes(item: EvidenceItem): readonly string[] {
  const value = item.facts.policyReasonCodes;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && POLICY_REASON_CODE.test(entry),
  );
}

type AgentPreflight = Readonly<{
  intent: AgentActionIntent;
  evidence: readonly EvidenceItem[];
  evidenceRoot: string;
  policy: AgentControlPolicy;
  policyResult: ReturnType<typeof PolicyResultSchema.parse>;
}>;

function orderedEvidence(items: readonly EvidenceItem[]): readonly EvidenceItem[] {
  return [...items].sort((left, right) => compareCanonicalStrings(left.id, right.id));
}

export function agentEvidenceRoot(items: readonly EvidenceItem[]): string {
  return hashAgentPayload(AGENT_HASH_DOMAINS.evidence, orderedEvidence(items));
}

export function evaluateAgentIntent({
  intent: unsafeIntent,
  policy: unsafePolicy,
  evidence: unsafeEvidence,
  now = new Date(),
}: {
  intent: unknown;
  policy: unknown;
  evidence: readonly unknown[];
  now?: Date;
}): AgentPreflight {
  const intent = AgentActionIntentSchema.parse(unsafeIntent);
  const policy = AgentControlPolicySchema.parse(unsafePolicy);
  const evidence = orderedEvidence(
    unsafeEvidence.map((item) => EvidenceItemSchema.parse(item)),
  );
  const evidenceRoot = agentEvidenceRoot(evidence);
  const policyDigest = hashAgentPayload(AGENT_HASH_DOMAINS.policy, policy);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (intent.policyRef.id !== policy.id || intent.policyRef.version !== policy.version) {
    blockers.push("POLICY_REFERENCE_MISMATCH");
  }
  if (Date.parse(intent.createdAt) > now.getTime()) blockers.push("INTENT_NOT_YET_ACTIVE");
  if (Date.parse(intent.expiresAt) <= now.getTime()) blockers.push("INTENT_EXPIRED");
  if (Date.parse(policy.publishedAt) > now.getTime()) blockers.push("POLICY_NOT_YET_PUBLISHED");
  if (!policy.allowedChains.includes(intent.action.chainRef)) blockers.push("CHAIN_NOT_ALLOWED");
  if (!policy.allowedActions.includes(intent.action.kind)) blockers.push("ACTION_NOT_ALLOWED");

  const maxEvidenceAgeMs = policy.evidenceMaxAgeSeconds * 1_000;
  for (const item of evidence) {
    if (item.status !== "VALID" || item.availability !== "AVAILABLE") {
      blockers.push(`EVIDENCE_${item.id}_NOT_VALID`);
      for (const code of evidencePolicyReasonCodes(item)) {
        blockers.push(`EVIDENCE_REASON:${code}`);
      }
      continue;
    }
    if (Date.parse(item.observedAt) > now.getTime() || Date.parse(item.receivedAt) > now.getTime()) {
      blockers.push(`EVIDENCE_${item.id}_FROM_FUTURE`);
    }
    if (["NOT_VERIFIED", "CONFLICTING"].includes(item.verificationStatus)) {
      blockers.push(`EVIDENCE_${item.id}_NOT_VERIFIED`);
    }
    if (!item.coverage.subjectRefs.includes(intent.subjectRef)) {
      blockers.push(`EVIDENCE_${item.id}_SUBJECT_MISMATCH`);
    }
    if (Date.parse(item.validUntil) <= now.getTime()) {
      blockers.push(`EVIDENCE_${item.id}_EXPIRED`);
    }
    if (now.getTime() - Date.parse(item.observedAt) > maxEvidenceAgeMs) {
      blockers.push(`EVIDENCE_${item.id}_STALE`);
    }
  }
  for (const requirement of intent.evidenceRequirements) {
    const covered = evidence.some(
      (item) =>
        item.coverage.subjectRefs.includes(intent.subjectRef) &&
        item.coverage.fields.includes(requirement),
    );
    if (!covered) blockers.push(`EVIDENCE_REQUIREMENT_MISSING:${requirement}`);
  }

  const budget = intent.action.budget;
  if (budget) {
    if (!policy.maxBudget) {
      blockers.push("FUNDED_ACTION_DISABLED");
    } else {
      if (budget.assetRef !== policy.maxBudget.assetRef) blockers.push("BUDGET_ASSET_NOT_ALLOWED");
      if (compareDecimalStrings(budget.amount, policy.maxBudget.amount) > 0) {
        blockers.push("BUDGET_LIMIT_EXCEEDED");
      }
    }
  }
  if (!policy.executionEnabled) warnings.push("EXECUTION_DISABLED_FOR_SOURCE_PREVIEW");

  const uniqueBlockers = [...new Set(blockers)];
  const expired = uniqueBlockers.includes("INTENT_EXPIRED");
  const unsupported = uniqueBlockers.some((code) =>
    code === "CHAIN_NOT_ALLOWED" || code === "ACTION_NOT_ALLOWED"
  );
  const insufficientEvidence = uniqueBlockers.some((code) => code.startsWith("EVIDENCE_"));
  const blockedByRule = uniqueBlockers.some((code) => !code.startsWith("EVIDENCE_"));
  const decision = expired
    ? "EXPIRED"
    : unsupported
      ? "UNSUPPORTED"
      : blockedByRule
        ? "BLOCKED_BY_RULE"
        : insufficientEvidence
          ? "INSUFFICIENT_EVIDENCE"
          : "ALLOWED_BY_POLICY";
  const status = uniqueBlockers.length === 0 ? "PASS" : "BLOCK";
  const evaluatedAt = now.toISOString();
  const evidenceRefs = orderedEvidence(evidence).map((item) => item.id);
  const policyResult = PolicyResultSchema.parse({
    schemaVersion: "1.0.0",
    id: `policy-result_${hashAgentPayload(AGENT_HASH_DOMAINS.policyResult, {
      intentId: intent.id,
      intentRevision: intent.revision,
      evidenceRoot,
      policyDigest,
    }).slice(2, 18)}`,
    intentId: intent.id,
    intentRevision: intent.revision,
    policyRef: { id: policy.id, version: policy.version },
    policyVersion: policy.version,
    policyDigest,
    evidenceRoot,
    evidenceRefs,
    decision,
    status,
    blockers: uniqueBlockers,
    warnings,
    evaluatedAt,
  });

  return { intent, evidence, evidenceRoot, policy, policyResult };
}

export function createActionPassportPreview({
  preflight,
  recordDemoDecision = false,
  subjectRef = "reviewer_demo",
  now = new Date(),
}: {
  preflight: AgentPreflight;
  recordDemoDecision?: boolean;
  subjectRef?: string;
  now?: Date;
}): ActionPassportPreview {
  if (
    recordDemoDecision &&
    (preflight.policyResult.status !== "PASS" ||
      preflight.policyResult.decision !== "ALLOWED_BY_POLICY")
  ) {
    throw new Error("A demo acknowledgement can be recorded only for an allowed preflight.");
  }
  const intentHash = hashAgentPayload(AGENT_HASH_DOMAINS.intent, preflight.intent);
  const policyDigest = hashAgentPayload(AGENT_HASH_DOMAINS.policy, preflight.policy);
  const authorization = recordDemoDecision
    ? {
        status: "RECORDED_DEMO_ONLY" as const,
        demoOnly: true as const,
        subjectRef,
        method: "LOCAL_DEMO_ACK" as const,
        intentHash,
        evidenceRoot: preflight.evidenceRoot,
        policyDigest,
        recordedAt: now.toISOString(),
      }
    : {
        status: "NOT_RECORDED" as const,
        demoOnly: true as const,
        subjectRef: null,
        method: null,
        intentHash: null,
        evidenceRoot: null,
        policyDigest: null,
        recordedAt: null,
      };
  const core = {
    schemaVersion: "1.0.0" as const,
    kind: "ACTION_PASSPORT_PREVIEW" as const,
    id: `action-passport_${intentHash.slice(2, 18)}`,
    createdAt: now.toISOString(),
    maturity: "SOURCE_PREVIEW" as const,
    intent: preflight.intent,
    intentHash,
    evidence: { items: preflight.evidence, root: preflight.evidenceRoot },
    policy: { definition: preflight.policy, result: preflight.policyResult },
    authorization,
    execution: {
      status: "UNAVAILABLE" as const,
      reasonCode: "NO_PROVIDER_SIGNER" as const,
      jobId: null,
      transactionHash: null,
    },
    outcome: {
      status: "OUTCOME_NOT_OBSERVED" as const,
      observedEffects: [],
      sourceRefs: [],
    },
    limitations: ACTION_PASSPORT_PREVIEW_LIMITATIONS,
  };
  const passportHash = hashAgentPayload(AGENT_HASH_DOMAINS.passport, core);
  const withoutIntegrity = { ...core, passportHash };
  return ActionPassportPreviewSchema.parse({
    ...withoutIntegrity,
    integrity: {
      algorithm: "SHA-256",
      hash: hashAgentPayload(AGENT_HASH_DOMAINS.integrity, withoutIntegrity),
    },
  });
}

export type ActionPassportVerification = Readonly<{
  valid: boolean;
  verdict: "PREVIEW_INTEGRITY_VALID" | "INVALID";
  finalized: false;
  outcomeStatus: "OUTCOME_NOT_OBSERVED" | null;
  issues: readonly string[];
}>;

export function verifyActionPassportPreview(value: unknown): ActionPassportVerification {
  const parsed = ActionPassportPreviewSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      verdict: "INVALID",
      finalized: false,
      outcomeStatus: null,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    };
  }

  const passport = parsed.data;
  const issues: string[] = [];
  if (passport.intentHash !== hashAgentPayload(AGENT_HASH_DOMAINS.intent, passport.intent)) {
    issues.push("INTENT_HASH_MISMATCH");
  }
  if (passport.evidence.root !== agentEvidenceRoot(passport.evidence.items)) {
    issues.push("EVIDENCE_ROOT_MISMATCH");
  }
  const expectedPolicyDigest = hashAgentPayload(AGENT_HASH_DOMAINS.policy, passport.policy.definition);
  if (passport.policy.result.policyDigest !== expectedPolicyDigest) issues.push("POLICY_DIGEST_MISMATCH");
  if (passport.policy.result.evidenceRoot !== passport.evidence.root) issues.push("POLICY_EVIDENCE_ROOT_MISMATCH");
  if (passport.policy.result.intentId !== passport.intent.id) issues.push("POLICY_INTENT_MISMATCH");

  const canonicalEvidence = orderedEvidence(passport.evidence.items);
  if (canonicalEvidence.some((item, index) => item.id !== passport.evidence.items[index]?.id)) {
    issues.push("EVIDENCE_ORDER_NONCANONICAL");
  }
  const recomputedPolicy = evaluateAgentIntent({
    intent: passport.intent,
    policy: passport.policy.definition,
    evidence: passport.evidence.items,
    now: new Date(passport.policy.result.evaluatedAt),
  }).policyResult;
  if (
    hashAgentPayload(AGENT_HASH_DOMAINS.policyResult, passport.policy.result) !==
    hashAgentPayload(AGENT_HASH_DOMAINS.policyResult, recomputedPolicy)
  ) {
    issues.push("POLICY_RESULT_MISMATCH");
  }

  if (passport.authorization.status === "RECORDED_DEMO_ONLY") {
    if (passport.authorization.intentHash !== passport.intentHash) issues.push("AUTH_INTENT_MISMATCH");
    if (passport.authorization.evidenceRoot !== passport.evidence.root) issues.push("AUTH_EVIDENCE_MISMATCH");
    if (passport.authorization.policyDigest !== expectedPolicyDigest) issues.push("AUTH_POLICY_MISMATCH");
  }

  const { passportHash: _passportHash, integrity: _integrity, ...core } = passport;
  if (passport.passportHash !== hashAgentPayload(AGENT_HASH_DOMAINS.passport, core)) {
    issues.push("PASSPORT_HASH_MISMATCH");
  }
  const { integrity: _discarded, ...withoutIntegrity } = passport;
  if (
    passport.integrity.hash !== hashAgentPayload(AGENT_HASH_DOMAINS.integrity, withoutIntegrity)
  ) {
    issues.push("INTEGRITY_HASH_MISMATCH");
  }

  return {
    valid: issues.length === 0,
    verdict: issues.length === 0 ? "PREVIEW_INTEGRITY_VALID" : "INVALID",
    finalized: false,
    outcomeStatus: passport.outcome.status,
    issues,
  };
}
