import { z } from "zod";

import {
  addDecimalStrings,
  compareDecimalStrings,
} from "../guard/kernel.ts";
import {
  actionCaseVerdict,
  type ActionCase,
} from "./action-case.ts";

/*
 * Owner control is deliberately separate from the legacy preview policy.
 *
 * `AgentControlPolicySchema` answers whether one source-preview proposal fits
 * one immutable local rule. This module answers the larger owner question:
 * what class of authority exists, which evidence that class requires, what
 * execution path enforces it, and how much of the period budget is already
 * unavailable before the next action is considered.
 *
 * It still creates no authority. A bounded mandate is accepted only when a
 * technical binding already exists, is exact to the path and is revocable.
 * The current Golden RWA workspace has no such binding, so its honest result is
 * PER_ACTION even when the deterministic preflight itself allows the action.
 */

const timestamp = z.string().datetime({ offset: true });
const CAIP2 = /^[a-z0-9-]+:[A-Za-z0-9-]+$/;
const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const AGENT_OWNER_ACTION_CLASSES = [
  "SERVICE_PAYMENT",
  "TRANSFER",
  "SWAP",
  "TRADE",
  "BRIDGE",
  "LEND",
  "BORROW",
  "STAKE",
  "JOB_FUNDING",
  "CONTRACT_CALL",
  "PERMISSION",
  "DELEGATION",
  "OTHER",
] as const;

export type AgentOwnerActionClass = (typeof AGENT_OWNER_ACTION_CLASSES)[number];

export const AGENT_OWNER_AUTHORIZATION_MODES = [
  "PER_ACTION",
  "BOUNDED_MANDATE",
] as const;

export type AgentOwnerAuthorizationMode =
  (typeof AGENT_OWNER_AUTHORIZATION_MODES)[number];

export const AGENT_ENFORCEMENT_GRADES = [
  "OBSERVE_ONLY",
  "RYNTRA_GATEWAY_ENFORCED",
  "PROVIDER_NATIVE_ENFORCED",
  "WALLET_NATIVE_ENFORCED",
  "SMART_CONTRACT_ENFORCED",
] as const;

export type AgentEnforcementGrade = (typeof AGENT_ENFORCEMENT_GRADES)[number];

export const AGENT_MANDATE_STATES = [
  "DRAFT",
  "REVIEWED",
  "ACTIVE",
  "PAUSED",
  "REVOKED",
  "EXPIRED",
  "SUPERSEDED",
] as const;

export const AGENT_BUDGET_ENTRY_STATES = [
  "RESERVED",
  "COMMITTED",
  "SETTLED",
  "RELEASED",
  "RECOVERY",
] as const;

export type AgentBudgetEntryState = (typeof AGENT_BUDGET_ENTRY_STATES)[number];

const MoneySchema = z
  .object({
    amount: z.string().regex(DECIMAL_STRING).max(128),
    assetRef: z.string().min(1).max(256),
  })
  .strict();

const EnforcementCoverageSchema = z
  .object({
    pathId: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
    enforcement: z.enum(AGENT_ENFORCEMENT_GRADES),
    limitation: z.string().min(1).max(500),
  })
  .strict();

const BypassRouteSchema = z
  .object({
    routeId: z.string().min(1).max(128),
    pathId: z.string().min(1).max(128),
    status: z.enum(["OPEN", "MITIGATED", "UNKNOWN"]),
    description: z.string().min(1).max(500),
  })
  .strict();

function duplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function addUniqueIssue(
  values: readonly string[],
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  const value = duplicate(values);
  if (value) {
    context.addIssue({
      code: "custom",
      path,
      message: `Duplicate value is not allowed: ${value}`,
    });
  }
}

export const AgentOwnerPolicySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyId: z.string().min(1).max(128),
    version: z.number().int().positive(),
    ownerRef: z.string().min(1).max(256),
    publishedAt: timestamp,
    immutable: z.literal(true),
    /** Consumer authority never widens by omission. */
    defaultAuthorizationMode: z.literal("PER_ACTION"),
    emergencyPause: z.boolean(),
    allowedSubjects: z.array(z.string().min(1).max(256)).min(1).max(64),
    allowedActionClasses: z.array(z.enum(AGENT_OWNER_ACTION_CLASSES)).min(1).max(32),
    allowedNetworks: z.array(z.string().regex(CAIP2)).min(1).max(32),
    allowedAssets: z.array(z.string().min(1).max(256)).max(128),
    allowedCounterparties: z.array(z.string().min(1).max(256)).max(128),
    limits: z
      .object({
        perAction: MoneySchema.nullable(),
        daily: MoneySchema.nullable(),
      })
      .strict(),
    additionalEvidenceRequirements: z.array(z.string().min(1).max(128)).max(64),
    executionPaths: z.array(EnforcementCoverageSchema).min(1).max(32),
    /** Never optional. Unknown is data; silence is not proof of no bypass. */
    knownBypassRoutes: z.array(BypassRouteSchema).min(1).max(64),
    unknownActionBehavior: z.literal("BLOCK"),
  })
  .strict()
  .superRefine((value, context) => {
    addUniqueIssue(value.allowedSubjects, ["allowedSubjects"], context);
    addUniqueIssue(value.allowedActionClasses, ["allowedActionClasses"], context);
    addUniqueIssue(value.allowedNetworks, ["allowedNetworks"], context);
    addUniqueIssue(value.allowedAssets, ["allowedAssets"], context);
    addUniqueIssue(value.allowedCounterparties, ["allowedCounterparties"], context);
    addUniqueIssue(
      value.executionPaths.map((path) => path.pathId),
      ["executionPaths"],
      context,
    );
    addUniqueIssue(
      value.knownBypassRoutes.map((route) => route.routeId),
      ["knownBypassRoutes"],
      context,
    );
    if (
      value.limits.perAction &&
      value.limits.daily &&
      value.limits.perAction.assetRef !== value.limits.daily.assetRef
    ) {
      context.addIssue({
        code: "custom",
        path: ["limits"],
        message: "Per-action and daily limits must use the same asset ledger.",
      });
    }
  });

export type AgentOwnerPolicy = z.output<typeof AgentOwnerPolicySchema>;

const TechnicalAuthoritySchema = z
  .object({
    bindingId: z.string().min(1).max(128),
    pathId: z.string().min(1).max(128),
    authorityRef: z.string().min(1).max(512),
    enforcement: z.enum(AGENT_ENFORCEMENT_GRADES),
    state: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]),
    grantedAt: timestamp,
    expiresAt: timestamp,
    revocation: z
      .object({
        method: z.enum(["OWNER_WALLET", "PROVIDER_CONSOLE", "SMART_CONTRACT", "GATEWAY_ADMIN"]),
        reference: z.string().min(1).max(512),
        state: z.enum(["AVAILABLE", "COMPLETED", "UNAVAILABLE"]),
      })
      .strict(),
    evidenceRef: z.string().min(1).max(512),
  })
  .strict();

export const AgentOwnerMandateSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    mandateId: z.string().min(1).max(128),
    version: z.number().int().positive(),
    ownerRef: z.string().min(1).max(256),
    subjectRef: z.string().min(1).max(256),
    policyRef: z
      .object({ id: z.string().min(1).max(128), version: z.number().int().positive() })
      .strict(),
    state: z.enum(AGENT_MANDATE_STATES),
    immutable: z.boolean(),
    actionClasses: z.array(z.enum(AGENT_OWNER_ACTION_CLASSES)).min(1).max(32),
    networks: z.array(z.string().regex(CAIP2)).min(1).max(32),
    assets: z
      .array(
        z
          .object({
            assetRef: z.string().min(1).max(256),
            maxAmount: z.string().regex(DECIMAL_STRING).max(128).nullable(),
          })
          .strict(),
      )
      .max(128),
    counterparties: z.array(z.string().min(1).max(256)).max(128),
    limits: z
      .object({
        perAction: MoneySchema.nullable(),
        daily: MoneySchema.nullable(),
      })
      .strict(),
    evidenceRequirements: z.array(z.string().min(1).max(128)).min(1).max(64),
    authorizationMode: z.enum(AGENT_OWNER_AUTHORIZATION_MODES),
    enforcementCoverage: z.array(EnforcementCoverageSchema).min(1).max(32),
    knownBypassRoutes: z.array(BypassRouteSchema).min(1).max(64),
    technicalAuthority: TechnicalAuthoritySchema.nullable(),
    validFrom: timestamp,
    validUntil: timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    addUniqueIssue(value.actionClasses, ["actionClasses"], context);
    addUniqueIssue(value.networks, ["networks"], context);
    addUniqueIssue(value.assets.map((asset) => asset.assetRef), ["assets"], context);
    addUniqueIssue(value.counterparties, ["counterparties"], context);
    addUniqueIssue(
      value.enforcementCoverage.map((path) => path.pathId),
      ["enforcementCoverage"],
      context,
    );
    addUniqueIssue(
      value.knownBypassRoutes.map((route) => route.routeId),
      ["knownBypassRoutes"],
      context,
    );
    if (Date.parse(value.validUntil) <= Date.parse(value.validFrom)) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "A mandate must end after it starts.",
      });
    }
    if (value.state === "ACTIVE" && !value.immutable) {
      context.addIssue({
        code: "custom",
        path: ["immutable"],
        message: "An active mandate version is immutable; an expansion is a new version.",
      });
    }
    if (value.authorizationMode !== "BOUNDED_MANDATE") return;

    const authority = value.technicalAuthority;
    if (!authority) {
      context.addIssue({
        code: "custom",
        path: ["technicalAuthority"],
        message: "BOUNDED_MANDATE requires explicit technical authority.",
      });
      return;
    }
    if (authority.enforcement === "OBSERVE_ONLY") {
      context.addIssue({
        code: "custom",
        path: ["technicalAuthority", "enforcement"],
        message: "Observe-only evidence is not delegated technical authority.",
      });
    }
    const coverage = value.enforcementCoverage.find(
      (path) => path.pathId === authority.pathId,
    );
    if (!coverage || coverage.enforcement !== authority.enforcement) {
      context.addIssue({
        code: "custom",
        path: ["enforcementCoverage"],
        message: "The technical authority must match one declared execution-path grade.",
      });
    }
    if (Date.parse(authority.expiresAt) < Date.parse(value.validUntil)) {
      context.addIssue({
        code: "custom",
        path: ["technicalAuthority", "expiresAt"],
        message: "Technical authority cannot expire before the mandate it enforces.",
      });
    }
    if (
      value.state === "ACTIVE" &&
      (authority.state !== "ACTIVE" || authority.revocation.state !== "AVAILABLE")
    ) {
      context.addIssue({
        code: "custom",
        path: ["technicalAuthority"],
        message: "Active bounded authority must be active and explicitly revocable.",
      });
    }
  });

export type AgentOwnerMandate = z.output<typeof AgentOwnerMandateSchema>;

export const AgentBudgetLedgerSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    ledgerId: z.string().min(1).max(128),
    version: z.number().int().positive(),
    ownerRef: z.string().min(1).max(256),
    mandateRef: z
      .object({ id: z.string().min(1).max(128), version: z.number().int().positive() })
      .strict(),
    assetRef: z.string().min(1).max(256),
    period: z
      .object({ startsAt: timestamp, endsAt: timestamp })
      .strict(),
    allocated: z.string().regex(DECIMAL_STRING).max(128),
    /** Stored explicitly so drift between the ledger and its projection fails. */
    available: z.string().regex(DECIMAL_STRING).max(128),
    entries: z
      .array(
        z
          .object({
            entryId: z.string().min(1).max(128),
            actionId: z.string().min(1).max(128),
            state: z.enum(AGENT_BUDGET_ENTRY_STATES),
            amount: z.string().regex(DECIMAL_STRING).max(128),
            updatedAt: timestamp,
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.period.endsAt) <= Date.parse(value.period.startsAt)) {
      context.addIssue({
        code: "custom",
        path: ["period", "endsAt"],
        message: "A budget period must end after it starts.",
      });
    }
    addUniqueIssue(value.entries.map((entry) => entry.entryId), ["entries"], context);
    addUniqueIssue(value.entries.map((entry) => entry.actionId), ["entries"], context);
  });

export type AgentBudgetLedger = z.output<typeof AgentBudgetLedgerSchema>;

export const AGENT_ACTION_EVIDENCE_PROFILE_VERSION = "1.0.0" as const;

export type AgentActionEvidenceProfile = Readonly<{
  actionClass: AgentOwnerActionClass;
  canonicalClass:
    | "RECORD_ONLY"
    | "VALUE_COMMIT"
    | "VALUE_RELEASE"
    | "VALUE_TRANSFER"
    | "WORK_DELIVERY";
  label: string;
  requiredEvidence: readonly string[];
  riskNote: string;
}>;

const ACTION_EVIDENCE_PROFILES: Readonly<
  Record<AgentOwnerActionClass, AgentActionEvidenceProfile>
> = Object.freeze({
  SERVICE_PAYMENT: {
    actionClass: "SERVICE_PAYMENT",
    canonicalClass: "VALUE_TRANSFER",
    label: "Service payment",
    requiredEvidence: [
      "service_identity",
      "invocation_schema_digest",
      "payment_requirement",
      "recipient_identity",
      "amount_and_asset",
      "response_observation_plan",
    ],
    riskNote: "A paid response and a delivered service are separate outcomes.",
  },
  TRANSFER: {
    actionClass: "TRANSFER",
    canonicalClass: "VALUE_TRANSFER",
    label: "Asset transfer",
    requiredEvidence: [
      "asset_identity",
      "amount_and_decimals",
      "recipient_identity",
      "network_and_account",
      "transfer_eligibility",
      "expected_balance_effects",
    ],
    riskNote: "Recipient, asset, amount and network are exact-action fields.",
  },
  SWAP: {
    actionClass: "SWAP",
    canonicalClass: "VALUE_TRANSFER",
    label: "Asset swap",
    requiredEvidence: [
      "asset_pair_identity",
      "route_quote",
      "quote_freshness",
      "slippage_and_fee_bounds",
      "liquidity_context",
      "expected_balance_effects",
    ],
    riskNote: "A route or price change invalidates the prior decision.",
  },
  TRADE: {
    actionClass: "TRADE",
    canonicalClass: "VALUE_TRANSFER",
    label: "Trade",
    requiredEvidence: [
      "instrument_identity",
      "venue_and_session",
      "market_reference_freshness",
      "position_risk",
      "price_and_fee_bounds",
      "expected_fill_effects",
    ],
    riskNote: "Market-hours, NAV/oracle freshness and position risk remain independent checks.",
  },
  BRIDGE: {
    actionClass: "BRIDGE",
    canonicalClass: "VALUE_TRANSFER",
    label: "Cross-network bridge",
    requiredEvidence: [
      "source_and_destination_network",
      "bridge_route_identity",
      "asset_mapping",
      "recipient_identity",
      "fee_and_time_bounds",
      "destination_observation_plan",
    ],
    riskNote: "Source settlement is not proof of the destination effect.",
  },
  LEND: {
    actionClass: "LEND",
    canonicalClass: "VALUE_COMMIT",
    label: "Lend",
    requiredEvidence: [
      "protocol_identity",
      "asset_and_market",
      "rate_terms",
      "withdrawal_conditions",
      "counterparty_or_pool_risk",
      "expected_position_effects",
    ],
    riskNote: "Committed liquidity stays unavailable until the position is independently observed.",
  },
  BORROW: {
    actionClass: "BORROW",
    canonicalClass: "VALUE_COMMIT",
    label: "Borrow",
    requiredEvidence: [
      "protocol_identity",
      "collateral_state",
      "borrow_terms",
      "liquidation_bounds",
      "rate_freshness",
      "expected_debt_effects",
    ],
    riskNote: "Borrow authority is risk-increasing and never inherits from a read or payment mandate.",
  },
  STAKE: {
    actionClass: "STAKE",
    canonicalClass: "VALUE_COMMIT",
    label: "Stake",
    requiredEvidence: [
      "staking_contract_or_validator",
      "asset_identity",
      "lockup_terms",
      "slashing_conditions",
      "withdrawal_path",
      "expected_position_effects",
    ],
    riskNote: "Lockup and revocation/withdrawal conditions are authority facts, not fine print.",
  },
  JOB_FUNDING: {
    actionClass: "JOB_FUNDING",
    canonicalClass: "VALUE_COMMIT",
    label: "Job funding",
    requiredEvidence: [
      "job_terms",
      "counterparty_identity",
      "deliverable_definition",
      "escrow_or_release_terms",
      "amount_and_asset",
      "delivery_observation_plan",
    ],
    riskNote: "Escrowed value is committed budget; payment is not delivery evidence.",
  },
  CONTRACT_CALL: {
    actionClass: "CONTRACT_CALL",
    canonicalClass: "VALUE_COMMIT",
    label: "Contract call",
    requiredEvidence: [
      "contract_identity",
      "invocation_schema_digest",
      "decoded_side_effects",
      "simulation",
      "native_value_and_allowances",
      "expected_state_effects",
    ],
    riskNote: "Unknown or changed side effects fail closed before authorization.",
  },
  PERMISSION: {
    actionClass: "PERMISSION",
    canonicalClass: "VALUE_COMMIT",
    label: "Permission",
    requiredEvidence: [
      "permission_scope",
      "grantee_identity",
      "expiry",
      "revocation_path",
      "enforcement_location",
      "known_bypass_routes",
    ],
    riskNote: "Permission breadth is economic exposure even before value moves.",
  },
  DELEGATION: {
    actionClass: "DELEGATION",
    canonicalClass: "VALUE_COMMIT",
    label: "Delegation",
    requiredEvidence: [
      "parent_remaining_authority",
      "child_identity",
      "delegated_scope",
      "delegated_budget",
      "expiry",
      "revocation_path",
    ],
    riskNote: "A child receives no more than parent authority, child mandate and provider hard limits permit.",
  },
  OTHER: {
    actionClass: "OTHER",
    canonicalClass: "RECORD_ONLY",
    label: "Other / unclassified",
    requiredEvidence: [
      "side_effect_classification",
      "subject_identity",
      "scope",
      "unknown_field_review",
    ],
    riskNote: "Unclassified side effects never receive broad delegated authority.",
  },
});

export const OWNER_CONTROL_REFUSALS = [
  "ACTION_CLASS_UNKNOWN",
  "OWNER_POLICY_PAUSED",
  "OWNER_SCOPE_MISMATCH",
  "SUBJECT_NOT_ALLOWED",
  "ACTION_NOT_ALLOWED",
  "NETWORK_NOT_ALLOWED",
  "ASSET_NOT_ALLOWED",
  "COUNTERPARTY_NOT_ALLOWED",
  "PER_ACTION_LIMIT_EXCEEDED",
  "MANDATE_INVALID",
  "MANDATE_POLICY_MISMATCH",
  "MANDATE_NOT_ACTIVE",
  "MANDATE_NOT_YET_ACTIVE",
  "MANDATE_EXPIRED",
  "MANDATE_SCOPE_MISMATCH",
  "TECHNICAL_AUTHORITY_MISSING",
  "TECHNICAL_AUTHORITY_NOT_ACTIVE",
  "TECHNICAL_AUTHORITY_NOT_REVOCABLE",
  "TECHNICAL_AUTHORITY_PATH_MISMATCH",
  "TECHNICAL_AUTHORITY_EXPIRED",
  "ENFORCEMENT_COVERAGE_MISMATCH",
  "KNOWN_BYPASS_OPEN_ON_PATH",
  "EXACT_HUMAN_AUTHORIZATION_REQUIRED",
] as const;

export type OwnerControlRefusal = (typeof OWNER_CONTROL_REFUSALS)[number];

export class OwnerControlError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "OwnerControlError";
    this.reasonCode = reasonCode;
  }
}

export function actionEvidenceProfile(actionClass: string): AgentActionEvidenceProfile {
  const profile = ACTION_EVIDENCE_PROFILES[actionClass as AgentOwnerActionClass];
  if (!profile) {
    throw new OwnerControlError(
      "ACTION_CLASS_UNKNOWN",
      `${actionClass || "<empty>"} is not in the closed owner action vocabulary`,
    );
  }
  return profile;
}

const ProposalSchema = z
  .object({
    ownerRef: z.string().min(1).max(256),
    subjectRef: z.string().min(1).max(256),
    /** Kept as string so an unknown value becomes a named refusal, not a throw. */
    actionClass: z.string().min(1).max(128),
    network: z.string().regex(CAIP2),
    assetRef: z.string().min(1).max(256).nullable(),
    amount: z.string().regex(DECIMAL_STRING).max(128).nullable(),
    counterpartyRef: z.string().min(1).max(256).nullable(),
    executionPath: z.string().min(1).max(128),
    at: z.date(),
  })
  .strict();

type OwnerAuthorityDecision = Readonly<{
  decision: "BLOCKED" | "PER_ACTION_REQUIRED" | "ALLOWED_BY_MANDATE";
  authorizationMode: AgentOwnerAuthorizationMode;
  enforcement: AgentEnforcementGrade;
  reasonCodes: readonly string[];
  requiredEvidence: readonly string[];
  coverage: readonly z.output<typeof EnforcementCoverageSchema>[];
  knownBypassRoutes: readonly z.output<typeof BypassRouteSchema>[];
}>;

function orderedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function blocked(
  policy: AgentOwnerPolicy,
  reasonCodes: readonly string[],
  requiredEvidence: readonly string[] = [],
): OwnerAuthorityDecision {
  return {
    decision: "BLOCKED",
    authorizationMode: "PER_ACTION",
    enforcement: "OBSERVE_ONLY",
    reasonCodes: orderedUnique(reasonCodes),
    requiredEvidence: orderedUnique(requiredEvidence),
    coverage: policy.executionPaths,
    knownBypassRoutes: policy.knownBypassRoutes,
  };
}

export function resolveOwnerAuthority({
  policy: unsafePolicy,
  mandate: unsafeMandate,
  proposal: unsafeProposal,
}: {
  policy: unknown;
  mandate: unknown | null;
  proposal: unknown;
}): OwnerAuthorityDecision {
  const policy = AgentOwnerPolicySchema.parse(unsafePolicy);
  const proposal = ProposalSchema.parse(unsafeProposal);
  let profile: AgentActionEvidenceProfile;
  try {
    profile = actionEvidenceProfile(proposal.actionClass);
  } catch (error) {
    if (error instanceof OwnerControlError && error.reasonCode === "ACTION_CLASS_UNKNOWN") {
      return blocked(policy, ["ACTION_CLASS_UNKNOWN"]);
    }
    throw error;
  }

  const requiredEvidence = [
    ...profile.requiredEvidence,
    ...policy.additionalEvidenceRequirements,
  ];
  const policyRefusals: string[] = [];
  if (policy.emergencyPause) policyRefusals.push("OWNER_POLICY_PAUSED");
  if (proposal.ownerRef !== policy.ownerRef) policyRefusals.push("OWNER_SCOPE_MISMATCH");
  if (!policy.allowedSubjects.includes(proposal.subjectRef)) policyRefusals.push("SUBJECT_NOT_ALLOWED");
  if (!policy.allowedActionClasses.includes(proposal.actionClass as AgentOwnerActionClass)) {
    policyRefusals.push("ACTION_NOT_ALLOWED");
  }
  if (!policy.allowedNetworks.includes(proposal.network)) policyRefusals.push("NETWORK_NOT_ALLOWED");
  if (proposal.assetRef && !policy.allowedAssets.includes(proposal.assetRef)) {
    policyRefusals.push("ASSET_NOT_ALLOWED");
  }
  if (
    proposal.counterpartyRef &&
    !policy.allowedCounterparties.includes(proposal.counterpartyRef)
  ) {
    policyRefusals.push("COUNTERPARTY_NOT_ALLOWED");
  }
  if (proposal.amount && policy.limits.perAction) {
    if (proposal.assetRef !== policy.limits.perAction.assetRef) {
      policyRefusals.push("ASSET_NOT_ALLOWED");
    } else if (compareDecimalStrings(proposal.amount, policy.limits.perAction.amount) > 0) {
      policyRefusals.push("PER_ACTION_LIMIT_EXCEEDED");
    }
  }
  if (policyRefusals.length) return blocked(policy, policyRefusals, requiredEvidence);

  if (unsafeMandate === null) {
    return {
      decision: "PER_ACTION_REQUIRED",
      authorizationMode: "PER_ACTION",
      enforcement: "OBSERVE_ONLY",
      reasonCodes: ["EXACT_HUMAN_AUTHORIZATION_REQUIRED"],
      requiredEvidence: orderedUnique(requiredEvidence),
      coverage: policy.executionPaths,
      knownBypassRoutes: policy.knownBypassRoutes,
    };
  }

  const parsedMandate = AgentOwnerMandateSchema.safeParse(unsafeMandate);
  if (!parsedMandate.success) {
    return blocked(policy, ["MANDATE_INVALID"], requiredEvidence);
  }
  const mandate = parsedMandate.data;
  requiredEvidence.push(...mandate.evidenceRequirements);
  const mandateRefusals: string[] = [];
  if (
    mandate.policyRef.id !== policy.policyId ||
    mandate.policyRef.version !== policy.version ||
    mandate.ownerRef !== policy.ownerRef
  ) {
    mandateRefusals.push("MANDATE_POLICY_MISMATCH");
  }
  if (mandate.state !== "ACTIVE") mandateRefusals.push("MANDATE_NOT_ACTIVE");
  if (Date.parse(mandate.validFrom) > proposal.at.getTime()) {
    mandateRefusals.push("MANDATE_NOT_YET_ACTIVE");
  }
  if (Date.parse(mandate.validUntil) <= proposal.at.getTime()) {
    mandateRefusals.push("MANDATE_EXPIRED");
  }
  if (
    mandate.subjectRef !== proposal.subjectRef ||
    !mandate.actionClasses.includes(proposal.actionClass as AgentOwnerActionClass) ||
    !mandate.networks.includes(proposal.network)
  ) {
    mandateRefusals.push("MANDATE_SCOPE_MISMATCH");
  }
  if (proposal.assetRef) {
    const asset = mandate.assets.find((item) => item.assetRef === proposal.assetRef);
    if (!asset) {
      mandateRefusals.push("MANDATE_SCOPE_MISMATCH");
    } else if (
      proposal.amount &&
      asset.maxAmount &&
      compareDecimalStrings(proposal.amount, asset.maxAmount) > 0
    ) {
      mandateRefusals.push("PER_ACTION_LIMIT_EXCEEDED");
    }
  }
  if (
    proposal.counterpartyRef &&
    !mandate.counterparties.includes(proposal.counterpartyRef)
  ) {
    mandateRefusals.push("MANDATE_SCOPE_MISMATCH");
  }
  if (proposal.amount && mandate.limits.perAction) {
    if (
      proposal.assetRef !== mandate.limits.perAction.assetRef ||
      compareDecimalStrings(proposal.amount, mandate.limits.perAction.amount) > 0
    ) {
      mandateRefusals.push("PER_ACTION_LIMIT_EXCEEDED");
    }
  }
  if (mandateRefusals.length) {
    return blocked(policy, mandateRefusals, requiredEvidence);
  }

  if (mandate.authorizationMode === "PER_ACTION") {
    return {
      decision: "PER_ACTION_REQUIRED",
      authorizationMode: "PER_ACTION",
      enforcement: "OBSERVE_ONLY",
      reasonCodes: ["EXACT_HUMAN_AUTHORIZATION_REQUIRED"],
      requiredEvidence: orderedUnique(requiredEvidence),
      coverage: mandate.enforcementCoverage,
      knownBypassRoutes: mandate.knownBypassRoutes,
    };
  }

  const authority = mandate.technicalAuthority;
  if (!authority) return blocked(policy, ["TECHNICAL_AUTHORITY_MISSING"], requiredEvidence);
  const authorityRefusals: string[] = [];
  if (authority.state !== "ACTIVE") authorityRefusals.push("TECHNICAL_AUTHORITY_NOT_ACTIVE");
  if (authority.revocation.state !== "AVAILABLE") {
    authorityRefusals.push("TECHNICAL_AUTHORITY_NOT_REVOCABLE");
  }
  if (authority.pathId !== proposal.executionPath) {
    authorityRefusals.push("TECHNICAL_AUTHORITY_PATH_MISMATCH");
  }
  if (Date.parse(authority.expiresAt) <= proposal.at.getTime()) {
    authorityRefusals.push("TECHNICAL_AUTHORITY_EXPIRED");
  }
  const policyCoverage = policy.executionPaths.find(
    (path) => path.pathId === proposal.executionPath,
  );
  const mandateCoverage = mandate.enforcementCoverage.find(
    (path) => path.pathId === proposal.executionPath,
  );
  if (
    !policyCoverage ||
    !mandateCoverage ||
    policyCoverage.enforcement !== authority.enforcement ||
    mandateCoverage.enforcement !== authority.enforcement
  ) {
    authorityRefusals.push("ENFORCEMENT_COVERAGE_MISMATCH");
  }
  if (
    [...policy.knownBypassRoutes, ...mandate.knownBypassRoutes].some(
      (route) => route.pathId === proposal.executionPath && route.status !== "MITIGATED",
    )
  ) {
    authorityRefusals.push("KNOWN_BYPASS_OPEN_ON_PATH");
  }
  if (authorityRefusals.length) {
    return blocked(policy, authorityRefusals, requiredEvidence);
  }

  return {
    decision: "ALLOWED_BY_MANDATE",
    authorizationMode: "BOUNDED_MANDATE",
    enforcement: authority.enforcement,
    reasonCodes: ["ACTIVE_REVOCABLE_TECHNICAL_AUTHORITY"],
    requiredEvidence: orderedUnique(requiredEvidence),
    coverage: mandate.enforcementCoverage,
    knownBypassRoutes: mandate.knownBypassRoutes,
  };
}

function addMany(values: readonly string[]): string {
  return values.reduce((total, value) => addDecimalStrings(total, value), "0");
}

function decimalParts(value: string): { integer: bigint; scale: number } {
  const [whole, fraction = ""] = value.split(".");
  return {
    integer: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function formatDecimal(integer: bigint, scale: number): string {
  if (scale === 0) return integer.toString();
  const padded = integer.toString().padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function subtractDecimalStrings(left: string, right: string): string {
  if (compareDecimalStrings(left, right) < 0) {
    throw new OwnerControlError(
      "BUDGET_OVERCOMMITTED",
      `${right} is already unavailable against ${left} allocated`,
    );
  }
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const leftInteger = a.integer * 10n ** BigInt(scale - a.scale);
  const rightInteger = b.integer * 10n ** BigInt(scale - b.scale);
  return formatDecimal(leftInteger - rightInteger, scale);
}

export type AgentBudgetSnapshot = Readonly<{
  allocated: string;
  available: string;
  reserved: string;
  committed: string;
  settled: string;
  released: string;
  recovery: string;
  unavailable: string;
  assetRef: string;
}>;

export function budgetSnapshot(unsafeLedger: unknown): AgentBudgetSnapshot {
  const ledger = AgentBudgetLedgerSchema.parse(unsafeLedger);
  const byState = (state: AgentBudgetEntryState) =>
    addMany(
      ledger.entries
        .filter((entry) => entry.state === state)
        .map((entry) => entry.amount),
    );
  const reserved = byState("RESERVED");
  const committed = byState("COMMITTED");
  const settled = byState("SETTLED");
  const released = byState("RELEASED");
  const recovery = byState("RECOVERY");
  /* Recovery stays unavailable until it is resolved. RELEASED is historical
     evidence and returns to AVAILABLE, so it is intentionally not subtracted. */
  const unavailable = addMany([reserved, committed, settled, recovery]);
  const available = subtractDecimalStrings(ledger.allocated, unavailable);
  if (compareDecimalStrings(available, ledger.available) !== 0) {
    throw new OwnerControlError(
      "BUDGET_RECONCILIATION_DRIFT",
      `stored AVAILABLE ${ledger.available} does not equal computed ${available}`,
    );
  }
  return {
    allocated: ledger.allocated,
    available,
    reserved,
    committed,
    settled,
    released,
    recovery,
    unavailable,
    assetRef: ledger.assetRef,
  };
}

function assertBudgetLedgerBinding({
  actionCase,
  policy,
  mandate,
  ledger,
  entry,
}: {
  actionCase: ActionCase;
  policy: AgentOwnerPolicy;
  mandate: AgentOwnerMandate | null;
  ledger: AgentBudgetLedger;
  entry: AgentBudgetLedger["entries"][number] | null;
}): void {
  if (
    ledger.ownerRef !== policy.ownerRef ||
    (mandate !== null && ledger.ownerRef !== mandate.ownerRef)
  ) {
    throw new OwnerControlError(
      "BUDGET_OWNER_MISMATCH",
      "the budget ledger owner does not match the selected owner policy and mandate",
    );
  }
  if (mandate === null) {
    throw new OwnerControlError(
      "BUDGET_MANDATE_MISSING",
      "a mandate-bound budget ledger cannot be projected without its selected mandate",
    );
  }
  if (
    ledger.mandateRef.id !== mandate.mandateId ||
    ledger.mandateRef.version !== mandate.version
  ) {
    throw new OwnerControlError(
      "BUDGET_MANDATE_MISMATCH",
      "the budget ledger does not reference the selected immutable mandate version",
    );
  }

  const actionAt = Date.parse(actionCase.createdAt);
  if (
    actionAt < Date.parse(ledger.period.startsAt) ||
    actionAt >= Date.parse(ledger.period.endsAt)
  ) {
    throw new OwnerControlError(
      "BUDGET_PERIOD_MISMATCH",
      "the selected action falls outside the ledger period",
    );
  }

  if (actionCase.amount === null) {
    if (entry !== null) {
      throw new OwnerControlError(
        "BUDGET_ACTION_AMOUNT_MISMATCH",
        "a non-budget action cannot own a budget ledger entry",
      );
    }
    return;
  }
  if (actionCase.assetRef === null || ledger.assetRef !== actionCase.assetRef) {
    throw new OwnerControlError(
      "BUDGET_ASSET_MISMATCH",
      "the budget ledger asset does not match the selected action asset",
    );
  }

  for (const limit of [policy.limits.daily, mandate.limits.daily]) {
    if (limit === null) continue;
    if (limit.assetRef !== ledger.assetRef) {
      throw new OwnerControlError(
        "BUDGET_ASSET_MISMATCH",
        "the budget ledger asset does not match a governing daily limit",
      );
    }
    if (compareDecimalStrings(ledger.allocated, limit.amount) > 0) {
      throw new OwnerControlError(
        "BUDGET_ALLOCATION_LIMIT_EXCEEDED",
        "the ledger allocation exceeds a governing daily limit",
      );
    }
  }

  if (entry === null) return;
  if (compareDecimalStrings(entry.amount, actionCase.amount) !== 0) {
    throw new OwnerControlError(
      "BUDGET_ACTION_AMOUNT_MISMATCH",
      "the selected action entry does not reserve its exact amount",
    );
  }
  if (entry.state === "RELEASED") {
    throw new OwnerControlError(
      "BUDGET_ACTION_ENTRY_RELEASED",
      "a released entry is not active budget exposure for the selected action",
    );
  }
}

const LEGACY_ACTION_CLASS: Readonly<Record<string, AgentOwnerActionClass>> = {
  CREATE_JOB_DRAFT: "OTHER",
  FUND_JOB: "JOB_FUNDING",
  SUBMIT_WORK: "OTHER",
  SETTLE_JOB: "JOB_FUNDING",
  TRANSFER: "TRANSFER",
};

export type AgentOwnerQueueItem = Readonly<{
  actionId: string;
  actionClass: string;
  canonicalClass: AgentActionEvidenceProfile["canonicalClass"] | "UNKNOWN";
  queueState: "BLOCKED" | "PENDING_REVIEW" | "READY_BY_MANDATE" | "ESCROWED" | "SETTLED" | "RECOVERY";
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  authorizationMode: AgentOwnerAuthorizationMode;
  enforcement: AgentEnforcementGrade;
  policyVersion: number;
  ownerPolicyVersion: number;
  mandateRef: string | null;
  requiredEvidence: readonly string[];
  reasonCodes: readonly string[];
  budget: AgentBudgetSnapshot & Readonly<{
    impact: string | null;
    impactBucket: AgentBudgetEntryState | null;
  }>;
  coverage: OwnerAuthorityDecision["coverage"];
  knownBypassRoutes: OwnerAuthorityDecision["knownBypassRoutes"];
}>;

export function buildOwnerActionQueueItem({
  actionCase,
  policy: unsafePolicy,
  mandate: unsafeMandate,
  ledger: unsafeLedger,
  executionPath,
}: {
  actionCase: ActionCase;
  policy: unknown;
  mandate: unknown | null;
  ledger: unknown;
  executionPath: string;
}): AgentOwnerQueueItem {
  const policy = AgentOwnerPolicySchema.parse(unsafePolicy);
  const mandate = unsafeMandate === null ? null : AgentOwnerMandateSchema.parse(unsafeMandate);
  const ledger = AgentBudgetLedgerSchema.parse(unsafeLedger);
  const entry = ledger.entries.find((item) => item.actionId === actionCase.id) ?? null;
  assertBudgetLedgerBinding({ actionCase, policy, mandate, ledger, entry });
  const snapshot = budgetSnapshot(ledger);
  const actionClass = LEGACY_ACTION_CLASS[actionCase.actionKind] ?? actionCase.actionKind;
  let profile: AgentActionEvidenceProfile | null = null;
  try {
    profile = actionEvidenceProfile(actionClass);
  } catch (error) {
    if (!(error instanceof OwnerControlError) || error.reasonCode !== "ACTION_CLASS_UNKNOWN") {
      throw error;
    }
  }
  const authority = resolveOwnerAuthority({
    policy,
    mandate,
    proposal: {
      ownerRef: policy.ownerRef,
      subjectRef: actionCase.agentId,
      actionClass,
      network: actionCase.chainRef,
      assetRef: actionCase.assetRef,
      amount: actionCase.amount,
      counterpartyRef: actionCase.counterpartyRef,
      executionPath,
      at: new Date(actionCase.createdAt),
    },
  });
  const actionVerdict = actionCaseVerdict(actionCase);
  const reasonCodes = [...authority.reasonCodes];
  if (actionVerdict === "BLOCK") reasonCodes.push("ACTION_POLICY_BLOCKED");
  if (actionVerdict === "REVIEW") reasonCodes.push("ACTION_EVIDENCE_REVIEW_REQUIRED");
  if (actionCase.amount && !entry) reasonCodes.push("BUDGET_RESERVATION_MISSING");

  const decision =
    authority.decision === "BLOCKED" || actionVerdict === "BLOCK" || (actionCase.amount && !entry)
      ? "BLOCK"
      : authority.decision === "ALLOWED_BY_MANDATE" && actionVerdict === "ALLOW"
        ? "ALLOW"
        : "REVIEW";
  const queueState =
    decision === "BLOCK"
      ? "BLOCKED"
      : entry?.state === "COMMITTED"
        ? "ESCROWED"
        : entry?.state === "SETTLED"
          ? "SETTLED"
          : entry?.state === "RECOVERY"
            ? "RECOVERY"
            : decision === "ALLOW"
              ? "READY_BY_MANDATE"
              : "PENDING_REVIEW";

  return {
    actionId: actionCase.id,
    actionClass,
    canonicalClass: profile?.canonicalClass ?? "UNKNOWN",
    queueState,
    decision,
    authorizationMode: authority.authorizationMode,
    enforcement: authority.enforcement,
    policyVersion: actionCase.policyVersion,
    ownerPolicyVersion: policy.version,
    mandateRef: mandate ? `${mandate.mandateId}@${mandate.version}` : null,
    requiredEvidence: authority.requiredEvidence,
    reasonCodes: orderedUnique(reasonCodes),
    budget: {
      ...snapshot,
      impact: entry?.amount ?? actionCase.amount,
      impactBucket: entry?.state ?? null,
    },
    coverage: authority.coverage,
    knownBypassRoutes: authority.knownBypassRoutes,
  };
}

const GOLDEN_OWNER = "owner:sample-treasury";
const GOLDEN_ASSET = "Sample tokenized equity";
const GOLDEN_NETWORK = "eip155:84532";
const GOLDEN_COUNTERPARTY = "Sample issuer transfer agent";
const GOLDEN_PATH = "external-base-wallet";

/**
 * The fixed read-only owner-control context for the existing Golden RWA case.
 *
 * It is intentionally not derived to fit an arbitrary selected action. A
 * policy built from the proposal it evaluates cannot prove scope. This sample
 * accepts only the existing Golden RWA transfer and throws for anything else.
 */
export function buildGoldenRwaOwnerControl(actionCase: ActionCase) {
  if (
    actionCase.actionKind !== "TRANSFER" ||
    actionCase.chainRef !== GOLDEN_NETWORK ||
    actionCase.assetRef !== GOLDEN_ASSET ||
    actionCase.amount !== "500" ||
    actionCase.counterpartyRef !== GOLDEN_COUNTERPARTY
  ) {
    throw new OwnerControlError(
      "GOLDEN_RWA_ACTION_REQUIRED",
      "the fixed sample policy cannot be rebuilt around a different proposal",
    );
  }
  const at = new Date(actionCase.createdAt);
  const minute = 60_000;
  const iso = (offset: number) => new Date(at.getTime() + offset).toISOString();
  const coverage = {
    pathId: GOLDEN_PATH,
    label: "External Base Sepolia wallet",
    enforcement: "OBSERVE_ONLY" as const,
    limitation: "The external wallet is not technically bound to this sample policy.",
  };
  const bypass = {
    routeId: "external-direct-call",
    pathId: GOLDEN_PATH,
    status: "OPEN" as const,
    description: "The owner wallet can receive a direct request outside Ryntra.",
  };
  const policy = AgentOwnerPolicySchema.parse({
    schemaVersion: "1.0.0",
    policyId: "golden-rwa-owner-policy",
    version: 1,
    ownerRef: GOLDEN_OWNER,
    publishedAt: iso(-10 * minute),
    immutable: true,
    defaultAuthorizationMode: "PER_ACTION",
    emergencyPause: false,
    allowedSubjects: [actionCase.agentId],
    allowedActionClasses: ["TRANSFER"],
    allowedNetworks: [GOLDEN_NETWORK],
    allowedAssets: [GOLDEN_ASSET],
    allowedCounterparties: [GOLDEN_COUNTERPARTY],
    limits: {
      perAction: { amount: "500", assetRef: GOLDEN_ASSET },
      daily: { amount: "1000", assetRef: GOLDEN_ASSET },
    },
    additionalEvidenceRequirements: [
      "issuer_allowlist",
      "venue_allowlist",
      "market_session",
      "reference_price",
    ],
    executionPaths: [coverage],
    knownBypassRoutes: [bypass],
    unknownActionBehavior: "BLOCK",
  });
  const mandate = AgentOwnerMandateSchema.parse({
    schemaVersion: "1.0.0",
    mandateId: "golden-rwa-owner-mandate",
    version: 1,
    ownerRef: GOLDEN_OWNER,
    subjectRef: actionCase.agentId,
    policyRef: { id: policy.policyId, version: policy.version },
    state: "ACTIVE",
    immutable: true,
    actionClasses: ["TRANSFER"],
    networks: [GOLDEN_NETWORK],
    assets: [{ assetRef: GOLDEN_ASSET, maxAmount: "500" }],
    counterparties: [GOLDEN_COUNTERPARTY],
    limits: {
      perAction: { amount: "500", assetRef: GOLDEN_ASSET },
      daily: { amount: "1000", assetRef: GOLDEN_ASSET },
    },
    evidenceRequirements: [
      "issuer_allowlist",
      "venue_allowlist",
      "transfer_eligibility",
      "reference_price",
      "market_session",
    ],
    authorizationMode: "PER_ACTION",
    enforcementCoverage: [coverage],
    knownBypassRoutes: [bypass],
    technicalAuthority: null,
    validFrom: iso(-5 * minute),
    validUntil: actionCase.expiresAt,
  });
  const ledger = AgentBudgetLedgerSchema.parse({
    schemaVersion: "1.0.0",
    ledgerId: "golden-rwa-daily-budget",
    version: 1,
    ownerRef: GOLDEN_OWNER,
    mandateRef: { id: mandate.mandateId, version: mandate.version },
    assetRef: GOLDEN_ASSET,
    period: {
      startsAt: iso(-12 * 60 * minute),
      endsAt: iso(12 * 60 * minute),
    },
    allocated: "1000",
    available: "250",
    entries: [
      {
        entryId: "golden-rwa-pending",
        actionId: actionCase.id,
        state: "RESERVED",
        amount: "500",
        updatedAt: actionCase.createdAt,
      },
      {
        entryId: "golden-rwa-escrowed",
        actionId: "sample-escrowed-service",
        state: "COMMITTED",
        amount: "150",
        updatedAt: iso(-30 * minute),
      },
      {
        entryId: "golden-rwa-settled",
        actionId: "sample-settled-service",
        state: "SETTLED",
        amount: "100",
        updatedAt: iso(-60 * minute),
      },
    ],
  });
  const queue = buildOwnerActionQueueItem({
    actionCase,
    policy,
    mandate,
    ledger,
    executionPath: GOLDEN_PATH,
  });

  return {
    banner: "INTERACTIVE DEMO · SAMPLE DATA · NO FUNDS MOVE" as const,
    ownerRef: GOLDEN_OWNER,
    policy,
    mandate,
    ledger,
    queue,
    profiles: AGENT_OWNER_ACTION_CLASSES.map((actionClass) =>
      actionEvidenceProfile(actionClass),
    ),
  } as const;
}
