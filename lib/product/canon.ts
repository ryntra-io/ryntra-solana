/**
 * Public projection of the product identity shared by landing, methodology,
 * metadata, and structured-data surfaces. Product maturity lives in
 * capabilities.ts; this file contains no provider-specific live promise.
 *
 * The product positions by audience, and the two positions are not
 * interchangeable: `category` is the whole company, `guardCategory` is the
 * developer/B2B surface. A surface that speaks to individual users takes the
 * company line; developer and partner artifacts take the developer line.
 * Collapsing the two is how the site previously read as if the developer
 * surface were all of Ryntra.
 *
 * The constants are the legacy public projection the archived v2.7 README
 * recorded; the identity, network boundary, description and audience line of
 * the earlier product left on 2026-09-29.
 */
export const PRODUCT_CANON = {
  category: "Risk, Strategy & Evidence OS",
  companyIdentity:
    "Ryntra is a venue-neutral Risk, Strategy & Evidence OS for programmable assets.",
  kernel: "Ryntra Evidence Kernel",
  workspaceRole:
    "Ryntra Workspace is the human-facing product and reference implementation of the same Evidence Kernel.",
  guardCategory: "Decision & Settlement Evidence Layer",
  hero: "Know whether this action is ready — and preserve the evidence.",
  motto: "Plan. Prove. Improve.",
  modeRelationship:
    "Observe, Guard, and Evidence integration modes share the same facts and policy results; Workspace Simple and Pro views change depth, never the underlying evidence, decision, authorization, or maturity truth.",
  trustLine:
    "Non-custodial. Paper-first. Human-authorized. No profit promises.",
  arcusBoundary:
    "Arcus on Robinhood Chain is the first shipped adapter and specialist tokenized-asset proof, not the Ryntra brand boundary.",
  publicMaturityLine:
    "Guard prototype: source implemented, not deployed or live-transaction verified.",
  northStar: {
    id: "wrrd",
    label: "Workspace Weekly Risk-Reviewed Decisions",
    definition:
      "A Workspace weekly count of decisions that received a documented risk review; it is not trade count, volume, profit, referrals, or AI calls.",
  },
} as const;

/**
 * The kernel lifecycle every surface shares. It is the company-level loop;
 * MINIMUM_PRODUCT_LOOP below is the Workspace decision loop expressed in the
 * shipped object vocabulary. Both are canonical and neither replaces the other.
 */
export const CANONICAL_LIFECYCLE = [
  "Observe",
  "Verify Evidence",
  "Plan",
  "Decide",
  "Authorize",
  "Execute",
  "Reconcile",
  "Journal",
  "Improve",
] as const;

/**
 * Four independent status axes. A UI may summarize them; an API, receipt, or
 * claim may never collapse one into another.
 */
export const INDEPENDENT_STATE_AXES = [
  "evidenceStatus",
  "policyDecision",
  "executionStatus",
  "reconciliationStatus",
] as const;

export const DECISION_DISPOSITIONS = [
  "no_trade",
  "paper",
  "manual",
  "live",
] as const;

export type DecisionDisposition = (typeof DECISION_DISPOSITIONS)[number];

export const MINIMUM_PRODUCT_LOOP = [
  "StrategySpec",
  "deterministic readiness",
  "no_trade | paper | manual | live",
  "DecisionReceipt",
  "ReviewRecord",
  "human-approved next StrategySpec",
] as const;
