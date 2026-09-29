import { hashCanonical } from "../guard/canonical.ts";
import { EvidenceItemSchema } from "../guard/contracts.ts";
import { createActionPassportPreview, evaluateAgentIntent } from "./core.ts";
import {
  AgentActionIntentSchema,
  AgentControlPolicySchema,
  type AgentActionIntent,
} from "./contracts.ts";

const MINUTE_MS = 60_000;

export const AGENT_CONTROL_DEMO_MODE = "SAMPLE_NOT_ONCHAIN" as const;

export const AGENT_CONTROL_OFFICIAL_SOURCE_REFS = [
  {
    id: "erc-8183",
    label: "ERC-8183",
    url: "https://eips.ethereum.org/EIPS/eip-8183",
    status: "DRAFT_STANDARD_REFERENCE",
    limitation: "A draft standard is not proof of a Ryntra job or transaction.",
  },
  {
    id: "bnb-apex",
    label: "BNB APEX contracts",
    url: "https://github.com/bnb-chain/apex-contracts",
    status: "PROVIDER_SOURCE_REFERENCE",
    limitation: "No Ryntra-created APEX job, provider submission or settlement is claimed.",
  },
  {
    id: "agent-launch",
    label: "Agent Launch docs",
    url: "https://agent-launch.ai/docs",
    status: "PROVIDER_SOURCE_REFERENCE",
    limitation: "Public documentation is not a verified Ryntra integration.",
  },
  {
    id: "agentverse",
    label: "Agentverse docs",
    url: "https://docs.agentverse.ai/",
    status: "PROVIDER_SOURCE_REFERENCE",
    limitation: "Ryntra has no verified Agentverse registration or ASI:One routing evidence.",
  },
] as const;

export const AGENT_CONTROL_DEMO_POLICY = AgentControlPolicySchema.parse({
  schemaVersion: "1.0.0",
  id: "agent-control-source-preview",
  version: 1,
  publishedAt: "2026-08-14T00:00:00.000Z",
  immutable: true,
  allowedChains: ["eip155:97"],
  allowedActions: ["CREATE_JOB_DRAFT"],
  maxBudget: null,
  evidenceMaxAgeSeconds: 3_600,
  requireHumanAuthorization: true,
  executionEnabled: false,
});

function instant(now: Date, offsetMs = 0): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

export function createAgentControlDemoIntent(now = new Date()): AgentActionIntent {
  return AgentActionIntentSchema.parse({
    schemaVersion: "1.0.0",
    id: "agent-intent_source-preview-001",
    source: {
      kind: "DEMO",
      agentId: "sample-agent",
      agentName: "Evidence review sample",
      requestId: "demo-request-001",
    },
    subjectRef: "sample-reviewer",
    requestText: "Prepare a bounded BNB testnet job draft and show every decision boundary before any wallet action.",
    action: {
      kind: "CREATE_JOB_DRAFT",
      provider: "BNB_APEX",
      chainRef: "eip155:97",
      jobType: "EVIDENCE_REVIEW",
      deliverable: "A deterministic evidence and policy assessment for a sample agent job draft.",
      budget: null,
      providerRef: null,
      evaluatorRef: null,
      deadline: instant(now, 15 * MINUTE_MS),
      expectedEffects: [
        "Create an integrity-checkable Action Passport Preview.",
        "Submit no provider action, wallet signature or blockchain transaction.",
      ],
    },
    policyRef: { id: AGENT_CONTROL_DEMO_POLICY.id, version: AGENT_CONTROL_DEMO_POLICY.version },
    evidenceRequirements: [
      "strict_intent_schema",
      "execution_boundary",
      "source_preview_limitations",
    ],
    humanAuthorizationRequired: true,
    createdAt: instant(now),
    expiresAt: instant(now, 20 * MINUTE_MS),
    revision: 1,
    idempotencyKey: "agent-control-demo-create-job-draft-v1",
  });
}

function demoEvidenceItem({
  id,
  sourceRef,
  fields,
  facts,
  now,
}: {
  id: string;
  sourceRef: string;
  fields: string[];
  facts: Record<string, string | number | boolean | null>;
  now: Date;
}) {
  const request = { sourceRef, subjectRef: "sample-reviewer", fields };
  const responseHash = hashCanonical(facts);
  return EvidenceItemSchema.parse({
    schemaVersion: "1.0.0",
    id,
    provider: "Ryntra source contract",
    sourceRef,
    adapter: "agent-control-demo-evidence",
    adapterVersion: "1.0.0",
    sourceType: "DETERMINISTIC_SOURCE_CONTRACT",
    observedAt: instant(now),
    receivedAt: instant(now),
    validUntil: instant(now, 60 * MINUTE_MS),
    confidence: "DETERMINISTIC_INTERNAL_BOUNDARY",
    coverage: {
      subjectRefs: ["sample-reviewer"],
      fields,
      limitations: [
        "This evidence proves only the bundled source contract, not external provider state.",
      ],
    },
    availability: "AVAILABLE",
    verificationStatus: "DETERMINISTICALLY_DERIVED",
    chainRef: null,
    blockRef: null,
    transactionRef: null,
    status: "VALID",
    requestHash: hashCanonical(request),
    responseHash,
    responseDigest: responseHash,
    reason: null,
    transformationVersion: "agent-control-demo-evidence/1.0.0",
    fallbackUsed: false,
    facts,
  });
}

export function createAgentControlDemoEvidence(now = new Date()) {
  return [
    demoEvidenceItem({
      id: "ev_agent-intent-contract_v1",
      sourceRef: "repo:lib/agent-control/contracts.ts",
      fields: ["strict_intent_schema", "execution_boundary"],
      facts: {
        schemaVersion: "1.0.0",
        strictParsing: true,
        executionEnabled: false,
        humanAuthorizationRequired: true,
      },
      now,
    }),
    demoEvidenceItem({
      id: "ev_agent-passport-boundary_v1",
      sourceRef: "repo:lib/agent-control/core.ts",
      fields: ["source_preview_limitations"],
      facts: {
        previewKind: "ACTION_PASSPORT_PREVIEW",
        finalizedReceipt: false,
        externalOutcomeObserved: false,
        walletSignaturePresent: false,
      },
      now,
    }),
  ] as const;
}

export function createAgentControlDemo({
  now = new Date(),
  intent = createAgentControlDemoIntent(now),
  recordDemoDecision = false,
}: {
  now?: Date;
  intent?: unknown;
  recordDemoDecision?: boolean;
} = {}) {
  const evidence = createAgentControlDemoEvidence(now);
  const preflight = evaluateAgentIntent({
    intent,
    policy: AGENT_CONTROL_DEMO_POLICY,
    evidence,
    now,
  });
  const passport = createActionPassportPreview({
    preflight,
    recordDemoDecision,
    subjectRef: "sample-reviewer",
    now,
  });

  return {
    mode: AGENT_CONTROL_DEMO_MODE,
    externalState: {
      agentverseRegistration: "NOT_VERIFIED",
      agentLaunchTokenRead: "NOT_INCLUDED",
      bnbApexJob: "NOT_OBSERVED",
    },
    sources: AGENT_CONTROL_OFFICIAL_SOURCE_REFS,
    preflight,
    passport,
  } as const;
}
