import { compareCanonicalStrings } from "../../guard/canonical-json.ts";
import type { AttentionSeverity } from "../portfolio/attention.ts";
import type { Entitlement, MandateBudgets, MandateScopeKind, MaterialityThreshold, ResearchMandate } from "./mandate.ts";
import { mandateState, type MandateState } from "./mandate.ts";
import type { MonitorRule, MonitorTrigger } from "./monitor-rule.ts";
import type { MaterialChange } from "./change.ts";
import type { QuietHours } from "./mandate.ts";
import type { RunProjection } from "./scheduler.ts";

/**
 * The Research read model — one projection, six views, no arithmetic.
 *
 * Every number on the Radar was already decided somewhere with a test on it:
 * the mandate compiled its own version, the rules compiled their own triggers,
 * the engine measured its own moves. This file arranges them, and arranging is
 * all it does. That boundary is what keeps two Home surfaces from disagreeing
 * about the same change.
 *
 * The views are the canon's own six, in its order. Three of them are cuts by
 * scope kind — *For me*, *Watchlist*, *Market* — and they partition: every
 * visible change lands in exactly one, which a test pins, because a change that
 * appears twice reads as two changes and a change that appears nowhere is the
 * defect nobody notices.
 *
 * **A change inside its threshold is counted, never listed.** It is real
 * evidence that the monitor measured something and found it small, and printing
 * it would bury the changes that matter under the ones that do not. The count
 * stays visible so "nothing here" and "nothing measured" are different
 * sentences.
 *
 * **Every empty view says why it is empty.** No mandate scope for it, nothing
 * material in this read, no source able to answer. An empty box with no reason
 * is indistinguishable from a broken one.
 */

export const RESEARCH_VIEW_IDS = [
  "FOR_ME",
  "WATCHLIST",
  "MARKET",
  "CONFLICTS",
  "UNKNOWNS",
  "SCHEDULED",
] as const;

export type ResearchViewId = (typeof RESEARCH_VIEW_IDS)[number];

const SCOPE_VIEW: Readonly<Record<MandateScopeKind, "FOR_ME" | "WATCHLIST" | "MARKET">> = {
  HOLDING: "FOR_ME",
  STRATEGY: "FOR_ME",
  WATCHLIST: "WATCHLIST",
  EXPLICIT_ASSET: "WATCHLIST",
  ISSUER: "MARKET",
  CHAIN: "MARKET",
  MACRO_EVENT: "MARKET",
};

const VIEW_LABEL: Readonly<Record<ResearchViewId, string>> = {
  FOR_ME: "For me",
  WATCHLIST: "Watchlist",
  MARKET: "Market",
  CONFLICTS: "Conflicts",
  UNKNOWNS: "Unknowns",
  SCHEDULED: "Scheduled",
};

export type ResearchSourceState = Readonly<{
  sourceId: string;
  label: string;
  state: "OK" | "STALE" | "FAILED";
  reason: string | null;
  entitlement: Entitlement;
}>;

export type ScheduledRule = Readonly<{
  ruleId: string;
  version: string;
  label: string;
  scopeKind: MandateScopeKind;
  mode: "SCHEDULE" | "EVENT";
  schedule: string | null;
  severity: AttentionSeverity;
  triggers: readonly MonitorTrigger[];
  quietHours: QuietHours | null;
  cooldownSeconds: number;
  maxAlerts: number | null;
  maxSourceAgeSeconds: number | null;
  requiredSources: readonly string[];
  run: RunProjection;
}>;

export type ResearchViewProjection = Readonly<{
  id: ResearchViewId;
  label: string;
  items: readonly MaterialChange[];
  scheduled: readonly ScheduledRule[];
  materialCount: number;
  conflictCount: number;
  unknownCount: number;
  withinThresholdCount: number;
  emptyReason: string | null;
  /**
   * Whether an empty view is a *result* or a *limit*.
   *
   * Found by looking: an empty Watchlist rendered a green tick beside the
   * sentence "Ryntra has no server-readable watchlist for this account" — a
   * pass mark on a limitation. `CALM` means the view was answered and nothing
   * material came back; `LIMITED` means it could not be answered.
   */
  emptyTone: "CALM" | "LIMITED";
}>;

export type ResearchMandateSummary = Readonly<{
  mandateId: string;
  version: string;
  state: MandateState;
  scopeCount: number;
  sourceCount: number;
  budgets: MandateBudgets;
  reviewAt: string | null;
  expiresAt: string | null;
  executionAuthority: "NONE";
  materiality: readonly MaterialityThreshold[];
  cadence: ResearchMandate["cadence"];
  /**
   * The channels the mandate *declares*, which is not the same as the channels
   * that exist. Carried so the Alerts surface can tell a reader "you asked for
   * email and there is no email transport" instead of quietly listing it as
   * simply not built.
   */
  notificationChannels: readonly string[];
}>;

export type ResearchProjection = Readonly<{
  state: "CALM" | "ATTENTION" | "DEGRADED" | "UNKNOWN" | "ERROR";
  asOf: string;
  mandate: ResearchMandateSummary;
  rules: readonly ScheduledRule[];
  views: readonly ResearchViewProjection[];
  changes: readonly MaterialChange[];
  sources: readonly ResearchSourceState[];
  recovery: readonly string[];
}>;

const NO_RECORD: RunProjection = {
  last: { state: "UNKNOWN", at: null, reason: "No scheduler record exists for this rule.", source: null },
  lastEvidenceRefresh: { state: "UNKNOWN", at: null, reason: "No scheduler record exists for this rule.", source: null },
  next: { state: "UNKNOWN", at: null, reason: "No run projection was supplied for this rule." },
  enrolled: false,
  watermark: null,
  runCount: null,
};

function scheduledRule(rule: MonitorRule, run: RunProjection): ScheduledRule {
  return {
    ruleId: rule.ruleId,
    version: rule.version,
    label: rule.scope.label,
    scopeKind: rule.scope.kind,
    mode: rule.mode,
    schedule: rule.schedule,
    severity: rule.severity,
    triggers: rule.triggers,
    quietHours: rule.quietHours,
    cooldownSeconds: rule.cooldownSeconds,
    maxAlerts: rule.maxAlerts,
    maxSourceAgeSeconds: rule.maxSourceAgeSeconds,
    requiredSources: rule.requiredSources,
    run,
  };
}

function emptyReason(input: Readonly<{
  id: ResearchViewId;
  hasScope: boolean;
  withinThreshold: number;
  anySource: boolean;
}>): string {
  if (input.id === "SCHEDULED") return "This mandate compiled no rule, so nothing is scheduled.";
  if (!input.hasScope) {
    return "Nothing in this mandate's scope belongs to this view. Widen the mandate scope to change that.";
  }
  if (!input.anySource) return "No source answered this read, so nothing here is a current fact.";
  if (input.withinThreshold > 0) {
    return input.withinThreshold === 1
      ? "One change was measured and stayed within its threshold."
      : `${input.withinThreshold} changes were measured and stayed within their thresholds.`;
  }
  if (input.id === "CONFLICTS") return "No two sources disagree in this read.";
  if (input.id === "UNKNOWNS") return "Every fact this mandate requires was supplied in this read.";
  return "Nothing material in this read.";
}

export function projectResearch(input: Readonly<{
  mandate: ResearchMandate;
  rules: readonly MonitorRule[];
  changes: readonly MaterialChange[];
  runs: readonly (readonly [string, RunProjection])[];
  sources: readonly ResearchSourceState[];
  asOf: string;
  /**
   * A source-specific sentence for a view that comes back empty.
   *
   * The generic reason can only say *nothing in scope*; the reader wants to
   * know **why** nothing is in scope, and only the layer that performed the
   * reads knows that — "Ryntra has no server-readable watchlist for this
   * account" is a fact about this product, not about this projection.
   */
  viewNotes?: Partial<Record<ResearchViewId, string>>;
}>): ResearchProjection {
  const runsById = new Map(input.runs);
  const rules = [...input.rules]
    .sort((left, right) => compareCanonicalStrings(left.ruleId, right.ruleId))
    .map((rule) => scheduledRule(rule, runsById.get(rule.ruleId) ?? NO_RECORD));

  const scopeKinds = new Set(input.rules.map((rule) => rule.scope.kind));
  const visible = input.changes.filter((change) => change.state !== "IMMATERIAL");
  const anySource = input.sources.some((source) => source.state !== "FAILED");

  const buckets = new Map<ResearchViewId, MaterialChange[]>(
    RESEARCH_VIEW_IDS.map((id) => [id, [] as MaterialChange[]]),
  );
  const withinThreshold = new Map<ResearchViewId, number>(RESEARCH_VIEW_IDS.map((id) => [id, 0]));

  for (const change of input.changes) {
    const kind = change.scopeKind as MandateScopeKind;
    const scopeView = SCOPE_VIEW[kind] ?? "MARKET";
    if (change.state === "IMMATERIAL") {
      withinThreshold.set(scopeView, (withinThreshold.get(scopeView) ?? 0) + 1);
      continue;
    }
    buckets.get(scopeView)?.push(change);
    if (change.state === "CONFLICT") buckets.get("CONFLICTS")?.push(change);
    if (change.state === "UNKNOWN") buckets.get("UNKNOWNS")?.push(change);
  }

  const views = RESEARCH_VIEW_IDS.map((id): ResearchViewProjection => {
    const items = buckets.get(id) ?? [];
    const within = withinThreshold.get(id) ?? 0;
    const hasScope = id === "CONFLICTS" || id === "UNKNOWNS" || id === "SCHEDULED"
      ? rules.length > 0
      : [...scopeKinds].some((kind) => SCOPE_VIEW[kind] === id);
    return {
      id,
      label: VIEW_LABEL[id],
      items,
      scheduled: id === "SCHEDULED" ? rules : [],
      materialCount: items.filter((item) => item.state === "MATERIAL").length,
      conflictCount: items.filter((item) => item.state === "CONFLICT").length,
      unknownCount: items.filter((item) => item.state === "UNKNOWN").length,
      withinThresholdCount: within,
      emptyReason: items.length > 0 || (id === "SCHEDULED" && rules.length > 0)
        ? null
        : input.viewNotes?.[id] ?? emptyReason({ id, hasScope, withinThreshold: within, anySource }),
      emptyTone: hasScope && anySource ? "CALM" : "LIMITED",
    };
  });

  const recovery: string[] = [];
  if (input.rules.length === 0) {
    recovery.push("This mandate compiled no rule, so nothing is being watched. Every view below is empty for that reason and not because the world is calm.");
  }
  if (input.sources.length > 0 && !anySource) {
    recovery.push("Every source in this mandate failed on this read, so no row below is a current fact.");
  }

  const degraded = input.sources.some((source) => source.state !== "OK");
  const material = visible.some((change) => change.state === "MATERIAL" || change.state === "CONFLICT");
  const unknown = visible.some((change) => change.state === "UNKNOWN");
  const state: ResearchProjection["state"] = input.rules.length === 0
    ? "ERROR"
    : degraded
      ? "DEGRADED"
      : material
        ? "ATTENTION"
        : unknown
          ? "UNKNOWN"
          : "CALM";

  return {
    state,
    asOf: input.asOf,
    mandate: {
      mandateId: input.mandate.mandateId,
      version: input.mandate.version,
      state: mandateState(input.mandate, input.asOf),
      scopeCount: input.mandate.scope.length,
      sourceCount: input.mandate.sources.length,
      budgets: input.mandate.budgets,
      reviewAt: input.mandate.reviewAt,
      expiresAt: input.mandate.expiresAt,
      executionAuthority: "NONE",
      materiality: input.mandate.materiality,
      cadence: input.mandate.cadence,
      notificationChannels: input.mandate.notificationChannels,
    },
    rules,
    views,
    changes: input.changes,
    sources: [...input.sources].sort((left, right) => compareCanonicalStrings(left.sourceId, right.sourceId)),
    recovery,
  };
}

/** Resolve one change by id. Any unknown or malformed id resolves to nothing. */
export function findChange(projection: ResearchProjection, id: string): MaterialChange | null {
  if (typeof id !== "string" || !/^chg-[0-9a-f]{12}$/.test(id)) return null;
  return projection.changes.find((change) => change.id === id) ?? null;
}
