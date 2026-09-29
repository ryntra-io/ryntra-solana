import { hashCanonical } from "../guard/canonical.ts";
import { EvidenceItemSchema } from "../guard/contracts.ts";
import { createActionPassportPreview, evaluateAgentIntent } from "./core.ts";
import {
  AgentActionIntentSchema,
  AgentControlPolicySchema,
  type AgentActionIntent,
} from "./contracts.ts";

/** Required on every surface that renders these synthetic facts. */
export const GOLDEN_RWA_DEMO_BANNER =
  "INTERACTIVE DEMO · SAMPLE DATA · NO FUNDS MOVE" as const;

const MINUTE_MS = 60_000;
const SUBJECT = "tenant:golden-rwa-demo";
const ASSET = "Sample tokenized equity";
const CHAIN = "eip155:84532";

const GOLDEN_RWA_POLICY = AgentControlPolicySchema.parse({
  schemaVersion: "1.0.0",
  id: "golden-rwa-mandate-sample",
  version: 1,
  publishedAt: "2026-08-20T00:00:00.000Z",
  immutable: true,
  allowedChains: [CHAIN],
  allowedActions: ["TRANSFER"],
  maxBudget: { amount: "1000", assetRef: ASSET },
  evidenceMaxAgeSeconds: 600,
  requireHumanAuthorization: true,
  executionEnabled: false,
});

function instant(now: Date, offsetMs = 0): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

function intentFor(now: Date, revision: 1 | 2): AgentActionIntent {
  return AgentActionIntentSchema.parse({
    schemaVersion: "1.0.0",
    id: "agent-intent_golden-rwa-001",
    source: {
      kind: "DEMO",
      agentId: "sample-treasury-agent",
      agentName: "Treasury Agent · sample",
      requestId: `golden-rwa-request-${revision}`,
    },
    subjectRef: SUBJECT,
    requestText:
      "Move 500 units of a sample tokenized equity through the sample issuer transfer agent, but only while the reference and underlying market evidence are inside the mandate window.",
    action: {
      kind: "TRANSFER",
      provider: "DEMO",
      chainRef: CHAIN,
      jobType: "RWA_MANDATE_FIDELITY_SAMPLE",
      deliverable: "A sample tokenized-equity transfer proposal bound to current market and issuer evidence.",
      budget: { amount: "500", assetRef: ASSET },
      providerRef: "Sample issuer transfer agent",
      evaluatorRef: "Sample RWA venue",
      deadline: instant(now, 15 * MINUTE_MS),
      expectedEffects: [
        "If an external wallet later submits the action, observe the exact asset, amount and recipient.",
        "If external settlement later completes, compare fill, fee, settlement and post-state with this intent.",
      ],
    },
    policyRef: { id: GOLDEN_RWA_POLICY.id, version: GOLDEN_RWA_POLICY.version },
    evidenceRequirements: [
      "issuer_allowlist",
      "venue_allowlist",
      "transfer_eligibility",
      "reference_price",
      "market_session",
    ],
    humanAuthorizationRequired: true,
    createdAt: instant(now, -2 * MINUTE_MS),
    expiresAt: instant(now, 20 * MINUTE_MS),
    revision,
    idempotencyKey: `golden-rwa-sample-revision-${revision}`,
  });
}

function evidenceItem({
  id,
  sourceRef,
  fields,
  facts,
  now,
  stale = false,
}: {
  id: string;
  sourceRef: string;
  fields: readonly string[];
  facts: Record<string, string | number | boolean | null | readonly string[]>;
  now: Date;
  stale?: boolean;
}) {
  const observedAt = instant(now, stale ? -20 * MINUTE_MS : -MINUTE_MS);
  const responseHash = hashCanonical(facts);
  return EvidenceItemSchema.parse({
    schemaVersion: "1.0.0",
    id,
    provider: "Ryntra synthetic sample",
    sourceRef,
    adapter: "golden-rwa-demo",
    adapterVersion: "1.0.0",
    sourceType: "SYNTHETIC_DEMO_EVIDENCE",
    observedAt,
    receivedAt: observedAt,
    validUntil: instant(now, stale ? -10 * MINUTE_MS : 10 * MINUTE_MS),
    confidence: "SAMPLE_DATA",
    coverage: {
      subjectRefs: [SUBJECT],
      fields,
      limitations: ["Synthetic sample facts only; no issuer, venue, market or chain was queried."],
    },
    availability: stale ? "PARTIAL" : "AVAILABLE",
    verificationStatus: "DETERMINISTICALLY_DERIVED",
    chainRef: CHAIN,
    blockRef: null,
    transactionRef: null,
    status: stale ? "STALE" : "VALID",
    requestHash: hashCanonical({ sourceRef, subjectRef: SUBJECT, fields }),
    responseHash,
    responseDigest: responseHash,
    reason: stale
      ? "REFERENCE_STALE · MARKET_HOURS_MISMATCH — sample reference is outside its validity window and the sample underlying market is closed."
      : null,
    transformationVersion: "golden-rwa-demo/1.0.0",
    fallbackUsed: false,
    facts,
  });
}

function evidenceFor(now: Date, fresh: boolean) {
  return [
    evidenceItem({
      id: "ev_golden-rwa-mandate",
      sourceRef: "sample://golden-rwa/mandate",
      fields: ["issuer_allowlist", "venue_allowlist", "transfer_eligibility"],
      facts: {
        issuerRef: "Sample issuer transfer agent",
        issuerAllowed: true,
        venueRef: "Sample RWA venue",
        venueAllowed: true,
        transferEligibility: "SAMPLE_ELIGIBLE",
      },
      now,
    }),
    evidenceItem({
      id: fresh ? "ev_golden-rwa-market-fresh" : "ev_golden-rwa-market-stale",
      sourceRef: "sample://golden-rwa/market-reference",
      fields: ["reference_price", "market_session"],
      facts: fresh
        ? {
            referenceFresh: true,
            underlyingMarketOpen: true,
            referencePrice: "100.00",
          }
        : {
            referenceFresh: false,
            underlyingMarketOpen: false,
            referencePrice: "100.00",
            policyReasonCodes: ["REFERENCE_STALE", "MARKET_HOURS_MISMATCH"],
          },
      now,
      stale: !fresh,
    }),
  ] as const;
}

/**
 * One synthetic Golden RWA action at three honest checkpoints.
 *
 * `fresh` and `reviewed` are the same corrected action: the latter adds only a
 * local demo acknowledgement bound to the exact hashes.
 * No wallet signature, transaction or outcome is ever constructed.
 */
export function createGoldenRwaDemo(now = new Date()) {
  const stalePreflight = evaluateAgentIntent({
    intent: intentFor(now, 1),
    policy: GOLDEN_RWA_POLICY,
    evidence: evidenceFor(now, false),
    now,
  });
  const freshPreflight = evaluateAgentIntent({
    intent: intentFor(now, 2),
    policy: GOLDEN_RWA_POLICY,
    evidence: evidenceFor(now, true),
    now,
  });

  return {
    banner: GOLDEN_RWA_DEMO_BANNER,
    stale: createActionPassportPreview({ preflight: stalePreflight, now }),
    fresh: createActionPassportPreview({ preflight: freshPreflight, now }),
    reviewed: createActionPassportPreview({
      preflight: freshPreflight,
      recordDemoDecision: true,
      subjectRef: SUBJECT,
      now,
    }),
  } as const;
}
