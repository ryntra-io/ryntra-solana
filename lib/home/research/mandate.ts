import { createHash } from "node:crypto";

import { canonicalJson, compareCanonicalStrings } from "../../guard/canonical-json.ts";
import { parseExplicitInstant, type FreshnessPolicy } from "../portfolio/freshness.ts";
import type { AttentionSeverity } from "../portfolio/attention.ts";

/**
 * The ResearchMandate — what Ryn may watch, and nothing about what it may do.
 *
 * The canon states the boundary in one sentence — *monitoring scope never
 * expands execution authority* — and the only reliable way to hold it is to
 * make the other answer unrepresentable. `executionAuthority` is therefore a
 * literal `"NONE"` on the compiled object, it is not read from the input, and
 * `monitoringAllows()` answers `false` for every execution verb without
 * consulting the mandate at all. A future field that widened this would have to
 * change the type, which is exactly the review moment it deserves.
 *
 * Two more rules are structural rather than remembered:
 *
 *   **Data rights precede ingestion.** A source arrives with an entitlement and
 *   the four things that entitlement does or does not permit — storage, AI
 *   processing, alerting, redistribution. A source with no entitlement is
 *   refused *before* it is ever read, and a source claiming more than its
 *   entitlement allows is refused as a contradiction rather than silently
 *   narrowed. Public web and social content is the case this exists for: it is
 *   untrusted data, readable and nothing else.
 *
 *   **The version is the content.** A counter can be bumped without a change
 *   and a change can happen without bumping a counter; a hash of the canonical
 *   material fields cannot do either. Two mandates that differ in any watched
 *   fact differ in version, and a re-compile of the same configuration produces
 *   the same string — which is what lets a rule name the exact mandate version
 *   it came from.
 */

export const MANDATE_SCOPE_KINDS = [
  "HOLDING",
  "WATCHLIST",
  "STRATEGY",
  "ISSUER",
  "CHAIN",
  "MACRO_EVENT",
  "EXPLICIT_ASSET",
] as const;

export type MandateScopeKind = (typeof MANDATE_SCOPE_KINDS)[number];

/**
 * What a source is allowed to be used for, recorded beside the source itself.
 *
 * `OWN_ACCOUNT` is the reader's own data through a connection they made.
 * `PROVIDER_PUBLIC` is a provider's own public API describing its own product —
 * a venue's market list, an issuer's registry. It is first-party evidence and
 * is trusted as such; it is not licensed for redistribution.
 * `LICENSED_FEED` is a paid or contractually permitted feed. `PUBLIC_UNTRUSTED`
 * is anything read off the open web, which the canon treats as data that can
 * never carry an instruction. `NONE` exists so an unentitled source has a name
 * to be refused under, rather than arriving as an absent field.
 *
 * The distinction that matters is not "public versus private" — it is *whose
 * statement about what*. A venue saying what its own funding rate will be is
 * evidence; a forum saying the same thing is not.
 */
export const ENTITLEMENTS = ["OWN_ACCOUNT", "PROVIDER_PUBLIC", "LICENSED_FEED", "PUBLIC_UNTRUSTED", "NONE"] as const;

export type Entitlement = (typeof ENTITLEMENTS)[number];

export type DataRights = Readonly<{
  entitlement: Entitlement;
  storage: boolean;
  aiProcessing: boolean;
  alerting: boolean;
  redistribution: boolean;
}>;

export type MandateScopeItem = Readonly<{
  kind: MandateScopeKind;
  ref: string;
  label: string;
}>;

export type MandateSource = Readonly<{
  sourceId: string;
  label: string;
  rights: DataRights;
  freshnessPolicy: FreshnessPolicy;
}>;

export const MATERIALITY_COMPARISONS = ["ABSOLUTE", "RELATIVE_BPS", "STATE_CHANGE"] as const;

export type MaterialityComparison = (typeof MATERIALITY_COMPARISONS)[number];

export type MaterialityThreshold = Readonly<{
  factKey: string;
  comparison: MaterialityComparison;
  /** `null` only for `STATE_CHANGE`, where the change itself is the threshold. */
  value: number | null;
  severity: AttentionSeverity;
  /**
   * Which scope kinds this threshold measures. `null` means every kind.
   *
   * Without it a holding rule would carry an oracle-state threshold that means
   * nothing for it, and a reader looking at why a change did not fire would be
   * reading triggers that were never applicable.
   */
  scopeKinds: readonly MandateScopeKind[] | null;
}>;

export type QuietHours = Readonly<{
  /** UTC hour the quiet window opens, inclusive. */
  fromHourUtc: number;
  /** UTC hour it closes, exclusive. A window may wrap midnight. */
  toHourUtc: number;
}>;

export type MandateCadence = Readonly<{
  mode: "SCHEDULE" | "EVENT";
  /** A declared cron expression. Never an observed run. */
  cron: string | null;
  quietHours: QuietHours | null;
  /** The minimum gap between two notifications from one rule. */
  cooldownSeconds: number;
}>;

export type MandateBudgets = Readonly<{
  dataReadsPerDay: number | null;
  aiCallsPerDay: number | null;
  maxAlertsPerDay: number | null;
}>;

export type ResearchMandate = Readonly<{
  mandateId: string;
  version: string;
  ownerRef: string;
  scope: readonly MandateScopeItem[];
  sources: readonly MandateSource[];
  freshness: FreshnessPolicy;
  materiality: readonly MaterialityThreshold[];
  cadence: MandateCadence;
  budgets: MandateBudgets;
  notificationChannels: readonly string[];
  effectiveFrom: string;
  reviewAt: string | null;
  expiresAt: string | null;
  /** Structural, not configurable. A mandate authorizes watching and nothing else. */
  executionAuthority: "NONE";
}>;

export type MandateCompileError =
  | "EMPTY_SCOPE"
  | "UNKNOWN_SCOPE_KIND"
  | "SOURCE_NOT_ENTITLED"
  | "RIGHTS_EXCEED_ENTITLEMENT"
  | "NO_SOURCE"
  | "INVALID_MATERIALITY"
  | "INVALID_BUDGET"
  | "INVALID_CADENCE"
  | "INVALID_TIME"
  | "INVALID_WINDOW";

export type MandateCompileResult =
  | Readonly<{ ok: true; mandate: ResearchMandate }>
  | Readonly<{ ok: false; code: MandateCompileError; reason: string }>;

export type MandateInput = Readonly<{
  mandateId: string;
  ownerRef: string;
  scope: readonly MandateScopeItem[];
  sources: readonly MandateSource[];
  freshness: FreshnessPolicy;
  materiality: readonly MaterialityThreshold[];
  cadence: MandateCadence;
  budgets: MandateBudgets;
  notificationChannels: readonly string[];
  effectiveFrom: string;
  reviewAt: string | null;
  expiresAt: string | null;
}>;

const fail = (code: MandateCompileError, reason: string): MandateCompileResult => ({ ok: false, code, reason });

function budgetOk(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 0);
}

/**
 * The entitlement ceiling.
 *
 * Untrusted public content may be read and nothing else — no storage, no AI
 * processing, no alerting, no redistribution. Redistribution is refused for
 * every entitlement here because Ryntra republishes no source's data, and a
 * flag nothing enforces is worse than an absent one.
 */
function rightsWithinEntitlement(rights: DataRights): boolean {
  if (rights.redistribution) return false;
  if (rights.entitlement === "PUBLIC_UNTRUSTED") {
    return !rights.storage && !rights.aiProcessing && !rights.alerting;
  }
  return true;
}

function sortedScope(scope: readonly MandateScopeItem[]): readonly MandateScopeItem[] {
  return [...scope].sort((left, right) => {
    const byKind = MANDATE_SCOPE_KINDS.indexOf(left.kind) - MANDATE_SCOPE_KINDS.indexOf(right.kind);
    return byKind !== 0 ? byKind : compareCanonicalStrings(left.ref, right.ref);
  });
}

function sortedSources(sources: readonly MandateSource[]): readonly MandateSource[] {
  return [...sources].sort((left, right) => compareCanonicalStrings(left.sourceId, right.sourceId));
}

function sortedMateriality(thresholds: readonly MaterialityThreshold[]): readonly MaterialityThreshold[] {
  return [...thresholds].sort((left, right) => {
    const byFact = compareCanonicalStrings(left.factKey, right.factKey);
    return byFact !== 0 ? byFact : compareCanonicalStrings(left.comparison, right.comparison);
  });
}

export function compileResearchMandate(input: MandateInput): MandateCompileResult {
  if (input.scope.length === 0) {
    return fail("EMPTY_SCOPE", "A mandate that watches nothing cannot produce a rule.");
  }
  for (const item of input.scope) {
    if (!MANDATE_SCOPE_KINDS.includes(item.kind)) {
      return fail("UNKNOWN_SCOPE_KIND", `${item.kind} is not a scope kind this product defines.`);
    }
  }
  if (input.sources.length === 0) {
    return fail("NO_SOURCE", "A mandate with no source has nothing to read and nothing to be honest about.");
  }
  for (const source of input.sources) {
    if (source.rights.entitlement === "NONE") {
      return fail("SOURCE_NOT_ENTITLED", `${source.sourceId} carries no entitlement, so it is refused before it is read.`);
    }
    if (!rightsWithinEntitlement(source.rights)) {
      return fail("RIGHTS_EXCEED_ENTITLEMENT", `${source.sourceId} claims more than its entitlement permits.`);
    }
  }
  for (const threshold of input.materiality) {
    if (!MATERIALITY_COMPARISONS.includes(threshold.comparison)) {
      return fail("INVALID_MATERIALITY", `${threshold.comparison} is not a comparison this engine performs.`);
    }
    if (threshold.scopeKinds !== null) {
      if (threshold.scopeKinds.length === 0) {
        return fail("INVALID_MATERIALITY", `${threshold.factKey} applies to no scope kind, which is a threshold that can never fire.`);
      }
      for (const kind of threshold.scopeKinds) {
        if (!MANDATE_SCOPE_KINDS.includes(kind)) {
          return fail("UNKNOWN_SCOPE_KIND", `${kind} is not a scope kind this product defines.`);
        }
      }
    }
    if (threshold.comparison === "STATE_CHANGE") {
      if (threshold.value !== null) {
        return fail("INVALID_MATERIALITY", "A state change has no numeric threshold.");
      }
    } else if (threshold.value === null || !Number.isFinite(threshold.value) || threshold.value < 0) {
      return fail("INVALID_MATERIALITY", `${threshold.factKey} needs a non-negative threshold.`);
    }
  }
  if (!budgetOk(input.budgets.dataReadsPerDay) || !budgetOk(input.budgets.aiCallsPerDay) || !budgetOk(input.budgets.maxAlertsPerDay)) {
    return fail("INVALID_BUDGET", "A budget is a whole non-negative count of operations per day.");
  }
  if (input.cadence.mode === "SCHEDULE" && input.cadence.cron === null) {
    return fail("INVALID_CADENCE", "A scheduled cadence must declare its schedule.");
  }
  if (!Number.isInteger(input.cadence.cooldownSeconds) || input.cadence.cooldownSeconds < 0) {
    return fail("INVALID_CADENCE", "A cooldown is a whole non-negative number of seconds.");
  }
  if (input.cadence.quietHours !== null) {
    const { fromHourUtc, toHourUtc } = input.cadence.quietHours;
    const hourOk = (hour: number) => Number.isInteger(hour) && hour >= 0 && hour <= 23;
    if (!hourOk(fromHourUtc) || !hourOk(toHourUtc)) {
      return fail("INVALID_CADENCE", "Quiet hours are whole UTC hours from 0 to 23.");
    }
  }

  const effectiveFrom = parseExplicitInstant(input.effectiveFrom);
  if (effectiveFrom === null) {
    return fail("INVALID_TIME", "Every instant must carry an explicit UTC offset.");
  }
  for (const [label, value] of [["reviewAt", input.reviewAt], ["expiresAt", input.expiresAt]] as const) {
    if (value === null) continue;
    const parsed = parseExplicitInstant(value);
    if (parsed === null) return fail("INVALID_TIME", `${label} must carry an explicit UTC offset.`);
    if (parsed < effectiveFrom) {
      return fail("INVALID_WINDOW", `${label} cannot precede the moment the mandate becomes effective.`);
    }
  }

  const material = {
    ownerRef: input.ownerRef,
    scope: sortedScope(input.scope),
    sources: sortedSources(input.sources),
    freshness: input.freshness,
    materiality: sortedMateriality(input.materiality),
    cadence: input.cadence,
    budgets: input.budgets,
    notificationChannels: [...input.notificationChannels].sort(compareCanonicalStrings),
    effectiveFrom: input.effectiveFrom,
    reviewAt: input.reviewAt,
    expiresAt: input.expiresAt,
  };

  return {
    ok: true,
    mandate: {
      mandateId: input.mandateId,
      version: mandateVersion(material),
      ownerRef: material.ownerRef,
      scope: material.scope,
      sources: material.sources,
      freshness: material.freshness,
      materiality: material.materiality,
      cadence: material.cadence,
      budgets: material.budgets,
      notificationChannels: material.notificationChannels,
      effectiveFrom: material.effectiveFrom,
      reviewAt: material.reviewAt,
      expiresAt: material.expiresAt,
      executionAuthority: "NONE",
    },
  };
}

function mandateVersion(material: unknown): string {
  const digest = createHash("sha256")
    .update(`ryntra.home.research.mandate.v1\n${canonicalJson(material)}`, "utf8")
    .digest("hex");
  return `v1-${digest.slice(0, 12)}`;
}

/** The verbs a mandate may authorize. Everything else is an execution verb. */
const MONITORING_VERBS = ["READ", "MONITOR", "INVESTIGATE", "ALERT"] as const;

export type MonitoringVerb = (typeof MONITORING_VERBS)[number];

/**
 * The one question a mandate answers about authority, and the one answer it can
 * give. The mandate is not consulted for an execution verb — there is no field
 * on it that could say yes.
 */
export function monitoringAllows(mandate: ResearchMandate, verb: string): boolean {
  void mandate;
  return (MONITORING_VERBS as readonly string[]).includes(verb);
}

export type MandateState = "NOT_YET_EFFECTIVE" | "ACTIVE" | "REVIEW_DUE" | "EXPIRED" | "UNKNOWN";

/** The clock is the caller's. A module that reads `Date.now()` cannot be tested. */
export function mandateState(mandate: ResearchMandate, asOf: string): MandateState {
  const now = parseExplicitInstant(asOf);
  const from = parseExplicitInstant(mandate.effectiveFrom);
  if (now === null || from === null) return "UNKNOWN";
  if (now < from) return "NOT_YET_EFFECTIVE";
  const expires = mandate.expiresAt === null ? null : parseExplicitInstant(mandate.expiresAt);
  if (expires !== null && now >= expires) return "EXPIRED";
  const review = mandate.reviewAt === null ? null : parseExplicitInstant(mandate.reviewAt);
  if (review !== null && now >= review) return "REVIEW_DUE";
  return "ACTIVE";
}
