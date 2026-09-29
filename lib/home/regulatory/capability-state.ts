import { evaluateFreshness, parseExplicitInstant, type FreshnessPolicy } from "../portfolio/freshness.ts";

/**
 * `RegulatoryCapabilityState` — Home canon §4.
 *
 * A record of actual provider, counsel and product-perimeter facts for one
 * user context, one instrument class and one operation. It is **not** a Ryntra
 * legal opinion, a country denylist, or a prediction of whether a particular
 * person is eligible for anything.
 *
 * The whole module exists to make one sentence structurally true: *advice,
 * order transmission and discretion cannot be activated from UI copy or a
 * generic jurisdiction label.* The obvious way to write that is a comment above
 * a permission check, and a comment does not survive the third person to edit
 * the file. So the source kinds are split into two closed lists that cannot
 * overlap, an inadmissible source is refused **before** anything else about the
 * record is read, and there is no code path from an absent record to a
 * permissive answer.
 *
 * Fail-closed is not a policy setting here — it is the default return. Every
 * branch that is not a complete, admissible, in-scope, current, reviewed,
 * unambiguous, permitting record ends at `BLOCKED` with the reason that got it
 * there. A caller cannot opt out, because there is no parameter to opt out
 * with.
 *
 * Pure: no clock, no fetch, no randomness. `asOf` arrives from the caller.
 */

export const REGULATED_OPERATIONS = [
  "PERSONALIZED_ADVICE",
  "ORDER_TRANSMISSION",
  "DISCRETIONARY_MANAGEMENT",
] as const;

export type RegulatedOperation = (typeof REGULATED_OPERATIONS)[number];

/**
 * Sources a capability state may be built from.
 *
 * Each is an artifact somebody outside this product authored and can be shown
 * to a third party: a signed provider contract, written counsel, the product's
 * own declared perimeter, a regulator's own publication.
 */
export const ADMISSIBLE_SOURCE_KINDS = [
  "PROVIDER_CONTRACT",
  "COUNSEL_OPINION",
  "PRODUCT_PERIMETER",
  "REGULATOR_PUBLICATION",
] as const;

/**
 * Sources that exist only so they have a name to be refused under.
 *
 * Without these three, an inadmissible input arrives as an *absent* field and
 * gets handled by whatever the absent-field branch happens to do. Named, it
 * gets its own refusal and its own test.
 */
export const INADMISSIBLE_SOURCE_KINDS = [
  "UI_COPY",
  "JURISDICTION_LABEL",
  "INFERENCE",
] as const;

export type AdmissibleSourceKind = (typeof ADMISSIBLE_SOURCE_KINDS)[number];
export type InadmissibleSourceKind = (typeof INADMISSIBLE_SOURCE_KINDS)[number];
export type RegulatorySourceKind = AdmissibleSourceKind | InadmissibleSourceKind;

export const PROVIDER_ROLES = [
  /** No provider stands behind this operation — which is a fact, not a gap. */
  "NONE",
  "INTRODUCER",
  "EXECUTION_VENUE",
  "ADVISER",
  "DISCRETIONARY_MANAGER",
  "CUSTODIAN",
] as const;

export type ProviderRole = (typeof PROVIDER_ROLES)[number];

export type RegulatoryScope = Readonly<{
  /** Which version of the reader's declared context this was recorded against. */
  userContextVersion: string;
  instrumentClass: string;
  operation: RegulatedOperation;
}>;

export type RegulatorySource = Readonly<{
  kind: RegulatorySourceKind;
  reference: string;
  observedAt: string;
}>;

export type RegulatoryRecord = Readonly<{
  recordId: string;
  source: RegulatorySource;
  scope: RegulatoryScope;
  effectiveAt: string;
  expiresAt: string | null;
  reviewAt: string | null;
  providerRole: ProviderRole;
  limitations: readonly string[];
  unknowns: readonly string[];
  /** The record's own answer. A record that refuses is still a record. */
  permits: boolean;
}>;

export const REGULATORY_BLOCK_CODES = [
  "NO_RECORD",
  "INADMISSIBLE_SOURCE",
  "NOT_YET_EFFECTIVE",
  "EXPIRED",
  "STALE",
  "REVIEW_OVERDUE",
  "UNKNOWNS_PRESENT",
  "CONFLICTING_RECORDS",
  "NO_PROVIDER_ROLE",
  "NOT_PERMITTED",
  "INVALID_TIME",
] as const;

export type RegulatoryBlockCode = (typeof REGULATORY_BLOCK_CODES)[number];

export type RegulatoryCapabilityState = Readonly<{
  operation: RegulatedOperation;
  instrumentClass: string;
  userContextVersion: string;
  state: "ALLOWED" | "BLOCKED";
  code: RegulatoryBlockCode | "RECORDED";
  reason: string;
  record: RegulatoryRecord | null;
  conflicts: readonly RegulatoryRecord[];
  providerRole: ProviderRole;
  limitations: readonly string[];
  unknowns: readonly string[];
  effectiveAt: string | null;
  expiresAt: string | null;
  reviewAt: string | null;
}>;

/** Default freshness for a regulatory record: one year, then re-observe. */
const DEFAULT_POLICY: FreshnessPolicy = { maxAgeSeconds: 60 * 60 * 24 * 365 };

const INADMISSIBLE_REASON: Readonly<Record<InadmissibleSourceKind, string>> = {
  UI_COPY: "A sentence of interface copy is not a record. What the product says about itself cannot authorize the product.",
  JURISDICTION_LABEL: "A generic jurisdiction label names where somebody is, not what a provider or counsel actually permits.",
  INFERENCE: "This was inferred rather than recorded. An inference cannot open a regulated operation.",
};

function blocked(
  scope: RegulatoryScope,
  code: RegulatoryBlockCode,
  reason: string,
  extra: Partial<RegulatoryCapabilityState> = {},
): RegulatoryCapabilityState {
  return {
    operation: scope.operation,
    instrumentClass: scope.instrumentClass,
    userContextVersion: scope.userContextVersion,
    state: "BLOCKED",
    code,
    reason,
    record: null,
    conflicts: [],
    providerRole: "NONE",
    limitations: [],
    unknowns: [],
    effectiveAt: null,
    expiresAt: null,
    reviewAt: null,
    ...extra,
  };
}

function inScope(record: RegulatoryRecord, scope: RegulatoryScope): boolean {
  return record.scope.operation === scope.operation
    && record.scope.instrumentClass === scope.instrumentClass
    && record.scope.userContextVersion === scope.userContextVersion;
}

/**
 * One operation, one instrument class, one context version — allowed or not.
 *
 * The order of the checks is deliberate and is part of the contract. Source
 * admissibility is decided **first**, before scope, freshness or the record's
 * own answer, so an inadmissible record can never be reported as merely stale
 * or merely out of scope — which would invite somebody to fix the date and
 * ship it.
 */
export function evaluateRegulatoryCapability(input: Readonly<{
  records: readonly RegulatoryRecord[];
  scope: RegulatoryScope;
  asOf: string;
  policy?: FreshnessPolicy;
}>): RegulatoryCapabilityState {
  const { scope, asOf } = input;
  if (!(REGULATED_OPERATIONS as readonly string[]).includes(scope.operation)) {
    throw new TypeError("Unknown regulated operation: " + String(scope.operation));
  }

  const asOfMs = parseExplicitInstant(asOf);
  if (asOfMs === null) {
    return blocked(scope, "INVALID_TIME", "The evaluation time is not an explicit instant, so nothing can be judged current.");
  }

  /* Inadmissible first, and across every record regardless of scope: a record
     built from interface copy is a defect wherever it points. */
  for (const record of input.records) {
    const kind = record.source.kind;
    if ((INADMISSIBLE_SOURCE_KINDS as readonly string[]).includes(kind)) {
      return blocked(
        scope,
        "INADMISSIBLE_SOURCE",
        INADMISSIBLE_REASON[kind as InadmissibleSourceKind] + " Source: " + record.source.reference + ".",
      );
    }
  }

  const candidates = input.records.filter((record) => inScope(record, scope));
  if (candidates.length === 0) {
    return blocked(
      scope,
      "NO_RECORD",
      "No record. Nothing from a provider, counsel or the product perimeter covers this operation for this instrument class and context version.",
    );
  }

  if (candidates.length > 1 && new Set(candidates.map((record) => record.permits)).size > 1) {
    return blocked(
      scope,
      "CONFLICTING_RECORDS",
      "Two records disagree about this operation. Both are kept and neither is chosen.",
      { conflicts: candidates },
    );
  }

  /* Deterministic pick: the record ids are sorted, so the same set always
     yields the same record without reading a clock or an insertion order. */
  const record = [...candidates].sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0))[0]!;

  const effective = parseExplicitInstant(record.effectiveAt);
  if (effective === null) {
    return blocked(scope, "INVALID_TIME", "The record's effective time is not an explicit instant.", { record });
  }
  if (effective > asOfMs) {
    return blocked(scope, "NOT_YET_EFFECTIVE", "The record takes effect on " + record.effectiveAt + " and has not yet.", { record, effectiveAt: record.effectiveAt });
  }

  /* Expiry is decided before freshness and on its own terms. A record whose
     expiry precedes its observation is a contradiction the freshness evaluator
     reports as an invalid window — true, and the wrong sentence to show
     somebody: the fact that matters is that the permission has run out. */
  if (record.expiresAt !== null) {
    const expires = parseExplicitInstant(record.expiresAt);
    if (expires === null) {
      return blocked(scope, "INVALID_TIME", "The record's expiry is not an explicit instant.", { record });
    }
    if (expires < asOfMs) {
      return blocked(scope, "EXPIRED", "The record expired on " + record.expiresAt + ".", { record, expiresAt: record.expiresAt });
    }
  }

  const freshness = evaluateFreshness({
    observedAt: record.source.observedAt,
    validUntil: record.expiresAt,
    policy: input.policy ?? DEFAULT_POLICY,
    asOf,
  });
  if (freshness.state === "INVALID") {
    return blocked(scope, "INVALID_TIME", "The record's own times cannot be read: " + freshness.code + ".", { record });
  }
  if (freshness.state === "STALE") {
    return blocked(scope, "STALE", "The record has not been re-observed inside its freshness window.", { record });
  }

  if (record.reviewAt !== null) {
    const review = parseExplicitInstant(record.reviewAt);
    if (review === null) {
      return blocked(scope, "INVALID_TIME", "The record's review time is not an explicit instant.", { record });
    }
    if (review < asOfMs) {
      return blocked(scope, "REVIEW_OVERDUE", "The record was due for review on " + record.reviewAt + " and has not been reviewed.", { record, reviewAt: record.reviewAt });
    }
  }

  if (record.unknowns.length > 0) {
    return blocked(
      scope,
      "UNKNOWNS_PRESENT",
      "The record carries an unresolved unknown: " + record.unknowns.join(" "),
      { record, unknowns: record.unknowns },
    );
  }

  if (record.providerRole === "NONE") {
    return blocked(scope, "NO_PROVIDER_ROLE", "No provider stands behind this operation, so nothing can be activated on it.", { record });
  }

  if (!record.permits) {
    return blocked(scope, "NOT_PERMITTED", "The record covers this operation and does not permit it.", { record, providerRole: record.providerRole, limitations: record.limitations });
  }

  return {
    operation: scope.operation,
    instrumentClass: scope.instrumentClass,
    userContextVersion: scope.userContextVersion,
    state: "ALLOWED",
    code: "RECORDED",
    reason: "Recorded by " + record.source.reference + ", effective " + record.effectiveAt + ".",
    record,
    conflicts: [],
    providerRole: record.providerRole,
    limitations: record.limitations,
    unknowns: [],
    effectiveAt: record.effectiveAt,
    expiresAt: record.expiresAt,
    reviewAt: record.reviewAt,
  };
}

export type RegulatoryPerimeter = Readonly<{
  state: "ALLOWED" | "PARTIAL" | "BLOCKED";
  operations: readonly RegulatoryCapabilityState[];
  disclaimer: string;
}>;

export const REGULATORY_DISCLAIMER =
  "This is a record of what providers, counsel and the product perimeter actually state. "
  + "It is not a Ryntra legal opinion, not a country denylist, and not a prediction of anyone's individual eligibility.";

/** All three regulated operations, answered together for one surface. */
export function regulatoryPerimeter(input: Readonly<{
  records: readonly RegulatoryRecord[];
  userContextVersion: string;
  instrumentClass: string;
  asOf: string;
  policy?: FreshnessPolicy;
}>): RegulatoryPerimeter {
  const operations = REGULATED_OPERATIONS.map((operation) => evaluateRegulatoryCapability({
    records: input.records,
    scope: {
      userContextVersion: input.userContextVersion,
      instrumentClass: input.instrumentClass,
      operation,
    },
    asOf: input.asOf,
    policy: input.policy,
  }));

  const allowed = operations.filter((entry) => entry.state === "ALLOWED").length;
  return {
    state: allowed === 0 ? "BLOCKED" : allowed === operations.length ? "ALLOWED" : "PARTIAL",
    operations,
    disclaimer: REGULATORY_DISCLAIMER,
  };
}
