import { compareCanonicalStrings } from "../../guard/canonical-json.ts";
import { validateAccounting, type AccountingIssue } from "./accounting.ts";
import { rankAttention, type AttentionItem } from "./attention.ts";
import { decimal, type MoneyValue, type RoundingMode } from "./decimal.ts";
import { evaluateFreshness, parseExplicitInstant, type FreshnessPolicy } from "./freshness.ts";
import { mergePositionRecords } from "./identity.ts";
import { projectPnlBooks, type PnlBooks, type PnlObservation } from "./pnl.ts";
import type { PositionRecord } from "./position.ts";
import {
  calculateRisk,
  RISK_CALCULATION_VERSION,
  RISK_FORMULA_VERSION,
  type ConstraintResult,
  type MetricValue,
  type RiskCalculation,
  type RiskConstraint,
} from "./risk-calculation.ts";
import {
  convertMoneyValue,
  effectiveState,
  included,
  type FxReference,
  type InclusionMethod,
  type ValuationCoverage,
} from "./valuation.ts";
import type { AdapterResult } from "./adapters/types.ts";

/**
 * The Home portfolio read model.
 *
 * One deterministic projection between the released `RYN-HOME-002` foundation
 * and the two Home surfaces. It owns *presentation state* — what is knowable,
 * what is degraded, what needs attention, what may be shown beside what — and
 * it owns no arithmetic of its own: value comes from `calculateValuationCoverage`,
 * exposure and cash come from `calculateRisk`, decomposition comes from
 * `projectPnlBooks`. A surface that recomputed any of those would be a second
 * definition of the same money, which is how two screens end up disagreeing.
 *
 * Every input is explicit. Sources arrive as already-adapted results, so a
 * provider failure is a value this function reasons about rather than an
 * exception that empties the page: the failed source degrades the aggregate and
 * names itself, and the healthy sources keep their facts.
 */
export const HOME_RISK_CATEGORIES = [
  "EXPOSURE",
  "CONCENTRATION",
  "LIQUIDITY",
  "COMMITMENTS",
  "EVIDENCE",
] as const;

export type HomeRiskCategoryId = (typeof HOME_RISK_CATEGORIES)[number];

/**
 * The five cash buckets, in the canon's order.
 *
 * They are exclusive because a `PositionRecord` carries exactly one
 * `cashState`, so one economic amount cannot be counted twice however the
 * surface groups it. There is deliberately no total: adding them would produce
 * a "cash" figure whose parts mean different things — spendable now, spendable
 * after a settlement, and not spendable at all.
 */
export const HOME_CASH_BUCKETS = [
  "SPENDABLE",
  "PENDING",
  "FUNDS_IN_MOTION",
  "COMMITTED",
  "LOCKED_COLLATERAL",
] as const;

export type HomeCashBucketId = (typeof HOME_CASH_BUCKETS)[number];

export type HomeSourceObservation = Readonly<{
  sourceId: string;
  label: string;
  observedAt: string;
  freshnessPolicy: FreshnessPolicy;
  detailHref: string | null;
  result: AdapterResult;
}>;

export type HomeSourceState = Readonly<{
  sourceId: string;
  label: string;
  state: "OK" | "STALE" | "FAILED";
  observedAt: string;
  freshness: "CURRENT" | "STALE" | "UNKNOWN" | "INVALID";
  recordCount: number;
  reason: string | null;
  detailHref: string | null;
}>;

export type HomeObservedValue = Readonly<{
  state: "OBSERVED" | "UNAVAILABLE";
  value: MoneyValue | null;
  reason: string | null;
  currency: string;
  asOf: string;
  sourceState: "CURRENT" | "STALE" | "DEGRADED" | "UNKNOWN";
  coverage: ValuationCoverage;
}>;

export type HomeCashBucket = Readonly<{
  id: HomeCashBucketId;
  state: "KNOWN" | "UNKNOWN";
  value: MoneyValue | null;
  reasons: readonly string[];
}>;

export type HomeRiskMetric = Readonly<{
  id: string;
  state: "KNOWN" | "UNKNOWN";
  value: MoneyValue | null;
  reasons: readonly string[];
}>;

export type HomeRiskCategory = Readonly<{
  id: HomeRiskCategoryId;
  status: "WITHIN" | "EXCEEDED" | "UNKNOWN" | "DEGRADED";
  metrics: readonly HomeRiskMetric[];
  constraints: readonly ConstraintResult[];
  limitations: readonly string[];
  detailHref: string;
}>;

export type HomeBookProjection = Readonly<{
  book: "LIVE" | "PAPER";
  positionCount: number;
  sourceIds: readonly string[];
}>;

export type HomeDistributionSlice = Readonly<{
  key: string;
  value: MoneyValue;
  shareBps: number;
}>;

export type HomePortfolioProjection = Readonly<{
  state: "ERROR" | "DEGRADED" | "ATTENTION" | "EMPTY" | "PARTIAL" | "CALM";
  asOf: string;
  observedValue: HomeObservedValue;
  coverage: ValuationCoverage;
  hidden: Readonly<{ count: number; amountDisclosed: false }>;
  books: Readonly<{ live: HomeBookProjection; paper: HomeBookProjection }>;
  pnl: PnlBooks;
  cash: readonly HomeCashBucket[];
  risk: readonly HomeRiskCategory[];
  attention: readonly AttentionItem[];
  sources: readonly HomeSourceState[];
  distribution: readonly HomeDistributionSlice[];
  distributionBasis: "PRICED_POSITIONS_AT_AS_OF";
  distributionExcludedCount: number;
  coverageLimit: readonly string[];
  recovery: readonly string[];
  calculation: Readonly<{ schemaVersion: string; formulaVersion: string; inputDigest: string }>;
}>;

export type HomePortfolioInput = Readonly<{
  asOf: string;
  displayCurrency: string;
  scale: number;
  roundingMode: RoundingMode;
  inclusionMethod: InclusionMethod;
  scope: Readonly<{ scopeId: string; ownerRef: string; contextVersion: number | null }>;
  sources: readonly HomeSourceObservation[];
  fx: readonly FxReference[];
  constraints: readonly RiskConstraint[];
  pnl: readonly PnlObservation[];
  signals: readonly AttentionItem[];
}>;

const SOURCE_DETAIL = "/app/portfolio#sources";
const COVERAGE_DETAIL = "/app/portfolio#coverage";
const RISK_DETAIL = "/app/portfolio#risk";
const CASH_DETAIL = "/app/portfolio#cash";

function metricProjection(id: string, metric: MetricValue): HomeRiskMetric {
  return Object.freeze(
    metric.state === "KNOWN"
      ? { id, state: "KNOWN" as const, value: metric.value, reasons: Object.freeze([]) }
      : { id, state: "UNKNOWN" as const, value: null, reasons: Object.freeze([...metric.reasons]) },
  );
}

function unknownMetric(id: string, reasons: readonly string[]): HomeRiskMetric {
  return Object.freeze({ id, state: "UNKNOWN" as const, value: null, reasons: Object.freeze([...reasons]) });
}

function categoryStatus(
  metrics: readonly HomeRiskMetric[],
  constraints: readonly ConstraintResult[],
  degraded: boolean,
): HomeRiskCategory["status"] {
  /* Exceeded first: it is a fact the reader has to act on even when other
     metrics in the same category are unknown. Unknown outranks degraded and
     both outrank `WITHIN`, because the one thing this may never do is present
     an absence of evidence as an absence of risk. */
  if (constraints.some((entry) => entry.status === "EXCEEDED")) return "EXCEEDED";
  if (metrics.some((entry) => entry.state === "UNKNOWN")) return "UNKNOWN";
  if (constraints.some((entry) => entry.status === "UNKNOWN")) return "UNKNOWN";
  return degraded ? "DEGRADED" : "WITHIN";
}

function constraintsFor(
  calculation: RiskCalculation,
  metrics: readonly RiskConstraint["metric"][],
): readonly ConstraintResult[] {
  return Object.freeze(calculation.constraints.filter((entry) => metrics.includes(entry.metric)));
}

function limitationsFrom(
  metrics: readonly HomeRiskMetric[],
  constraints: readonly ConstraintResult[],
  extra: readonly string[],
): readonly string[] {
  const reasons = [
    ...metrics.flatMap((entry) => entry.reasons),
    ...constraints.map((entry) => entry.reason).filter((value): value is string => value !== null),
    ...extra,
  ];
  return Object.freeze([...new Set(reasons)].sort(compareCanonicalStrings));
}

function sourceFreshness(source: HomeSourceObservation, asOf: string): HomeSourceState["freshness"] {
  const result = evaluateFreshness({
    observedAt: source.observedAt,
    validUntil: null,
    policy: source.freshnessPolicy,
    asOf,
  });
  if (result.state === "CURRENT") return "CURRENT";
  if (result.state === "INVALID") return "INVALID";
  return result.reason === "FRESHNESS_BOUNDARY_UNKNOWN" ? "UNKNOWN" : "STALE";
}

function bookProjection(
  book: "LIVE" | "PAPER",
  records: readonly PositionRecord[],
): HomeBookProjection {
  const own = records.filter((record) => record.book === book);
  return Object.freeze({
    book,
    positionCount: own.length,
    sourceIds: Object.freeze([...new Set(own.map((record) => record.source.sourceId))].sort(compareCanonicalStrings)),
  });
}

function distribution(input: {
  records: readonly PositionRecord[];
  uncertainIds: ReadonlySet<string>;
  asOf: string;
  displayCurrency: string;
  scale: number;
  roundingMode: RoundingMode;
  inclusionMethod: InclusionMethod;
  fx: readonly FxReference[];
}): Readonly<{ slices: readonly HomeDistributionSlice[]; excluded: number }> {
  const totals = new Map<string, bigint>();
  let excluded = 0;
  let total = 0n;
  for (const record of input.records) {
    if (record.book !== "LIVE" || record.accountingRole !== "PRIMARY" || record.valuationContribution === "NONE") {
      continue;
    }
    const state = effectiveState(record, input.asOf);
    const usable = included(state, input.inclusionMethod)
      && !input.uncertainIds.has(record.positionId)
      && record.valuation.value !== null;
    if (!usable) {
      excluded += 1;
      continue;
    }
    const converted = convertMoneyValue({
      value: record.valuation.value as MoneyValue,
      displayCurrency: input.displayCurrency,
      scale: input.scale,
      roundingMode: input.roundingMode,
      fx: input.fx,
      asOf: input.asOf,
    });
    if (!converted.ok) {
      excluded += 1;
      continue;
    }
    const units = BigInt(converted.value.amount.units);
    const magnitude = units < 0n ? -units : units;
    totals.set(record.underlyingKey, (totals.get(record.underlyingKey) ?? 0n) + magnitude);
    total += magnitude;
  }

  const slices = [...totals.entries()]
    .sort((left, right) => (right[1] === left[1] ? compareCanonicalStrings(left[0], right[0]) : right[1] > left[1] ? 1 : -1))
    .map(([key, units]) => Object.freeze({
      key,
      value: Object.freeze({ amount: decimal(units.toString(), input.scale), currency: input.displayCurrency }),
      shareBps: total === 0n ? 0 : Number((units * 10_000n) / total),
    }));
  return Object.freeze({ slices: Object.freeze(slices), excluded });
}

function derivedAttention(input: {
  asOf: string;
  sources: readonly HomeSourceObservation[];
  sourceStates: readonly HomeSourceState[];
  accountingIssues: readonly AccountingIssue[];
  calculation: RiskCalculation;
  coverage: ValuationCoverage;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const state of input.sourceStates) {
    if (state.state !== "FAILED") continue;
    items.push({
      id: `source:${state.sourceId}`,
      kind: "DEGRADED_PROVIDER",
      severity: "HIGH",
      observedAt: state.observedAt,
      title: `${state.label} could not be read`,
      reason: state.reason ?? "the source read did not complete",
      sourceRef: state.sourceId,
      freshness: "UNKNOWN",
      detailHref: state.detailHref ?? SOURCE_DETAIL,
      actionLabel: "Open sources",
      limitation: null,
    });
  }

  if (input.accountingIssues.length > 0) {
    items.push({
      id: "reconciliation:accounting",
      kind: "INCOMPLETE_RECONCILIATION",
      severity: "HIGH",
      observedAt: input.asOf,
      title: "Some holdings could not be reconciled to one economic lot",
      reason: `${input.accountingIssues.length} unresolved accounting identity result(s); the affected amounts are excluded rather than guessed`,
      sourceRef: "reconciliation",
      freshness: "CURRENT",
      detailHref: COVERAGE_DETAIL,
      actionLabel: "Open coverage",
      limitation: null,
    });
  }

  for (const constraint of input.calculation.constraints) {
    if (constraint.status !== "EXCEEDED") continue;
    items.push({
      id: `constraint:${constraint.id}`,
      kind: "DETERMINISTIC_REVIEW",
      severity: "CRITICAL",
      observedAt: input.asOf,
      title: `${constraint.metric} is outside its configured bound`,
      reason: "A deterministic portfolio constraint evaluated EXCEEDED on the current evidence",
      sourceRef: `constraint:${constraint.id}`,
      freshness: "CURRENT",
      detailHref: RISK_DETAIL,
      actionLabel: "Open risk",
      limitation: null,
    });
  }

  const uncertainEvidence = input.coverage.stateCounts.STALE + input.coverage.stateCounts.CONFLICTING;
  if (uncertainEvidence > 0) {
    items.push({
      id: "evidence:stale-or-conflicting",
      kind: "STALE_OR_CONFLICTING_EVIDENCE",
      severity: "MEDIUM",
      observedAt: input.asOf,
      title: "Critical valuation evidence is stale or conflicting",
      reason: `${uncertainEvidence} position(s) hold a stale or conflicting price and stay outside the observed value`,
      sourceRef: "valuation",
      freshness: "STALE",
      detailHref: COVERAGE_DETAIL,
      actionLabel: "Open coverage",
      limitation: null,
    });
  }

  const delayed = input.calculation.cash.fundsInMotion;
  if (delayed.state === "UNKNOWN" && delayed.reasons.length > 0) {
    items.push({
      id: "cash:funds-in-motion",
      kind: "DELAYED_FUNDS",
      severity: "MEDIUM",
      observedAt: input.asOf,
      title: "Funds in motion cannot be valued",
      reason: "A transfer is in flight and its source does not report an exact amount",
      sourceRef: "cash",
      freshness: "UNKNOWN",
      detailHref: CASH_DETAIL,
      actionLabel: "Open cash",
      limitation: null,
    });
  }

  return items;
}

/**
 * Project one Home portfolio surface from explicit source results.
 *
 * Deterministic in the strict sense: same inputs in any order, byte-identical
 * output. Callers collect sources concurrently, so anything order-sensitive
 * here would make the page change between two identical reads.
 */
export function projectHomePortfolio(input: HomePortfolioInput): HomePortfolioProjection {
  if (parseExplicitInstant(input.asOf) === null) {
    throw new TypeError("Home portfolio asOf requires an explicit-offset instant");
  }

  const sources = [...input.sources].sort((left, right) => compareCanonicalStrings(left.sourceId, right.sourceId));
  const succeeded = sources.filter((source) => source.result.ok);
  const failed = sources.filter((source) => !source.result.ok);
  const observed = succeeded.flatMap((source) => (source.result.ok ? source.result.records : []));

  const merged = mergePositionRecords(observed);
  const accounting = validateAccounting(merged.records, merged.issues);
  const uncertainIds = new Set(accounting.uncertainPositionIds);

  const calculation = calculateRisk({
    schemaVersion: RISK_CALCULATION_VERSION,
    formulaVersion: RISK_FORMULA_VERSION,
    scope: input.scope,
    asOf: input.asOf,
    displayCurrency: input.displayCurrency,
    scale: input.scale,
    roundingMode: input.roundingMode,
    inclusionMethod: input.inclusionMethod,
    records: accounting.validRecords,
    accountingIssues: accounting.issues,
    fx: input.fx,
    constraints: input.constraints,
  });
  const coverage = calculation.valuation;

  const sourceStates: readonly HomeSourceState[] = Object.freeze(sources.map((source) => {
    const freshness = sourceFreshness(source, input.asOf);
    const ok = source.result.ok;
    return Object.freeze({
      sourceId: source.sourceId,
      label: source.label,
      state: (!ok ? "FAILED" : freshness === "CURRENT" ? "OK" : "STALE") as HomeSourceState["state"],
      observedAt: source.observedAt,
      freshness,
      recordCount: ok ? (source.result.ok ? source.result.records.length : 0) : 0,
      reason: ok ? null : (source.result.ok ? null : source.result.reason),
      detailHref: source.detailHref,
    });
  }));

  /* No source returned anything: there is no evidence, so there is no zero to
     report. Every derived money fact stays unknown rather than defaulting to
     the empty accumulator the calculation legitimately starts from. */
  const hasEvidence = succeeded.length > 0;
  const noEvidenceReason = failed.length > 0
    ? "no source returned evidence for this read"
    : "no source is connected to this workspace";

  const cash: readonly HomeCashBucket[] = Object.freeze(HOME_CASH_BUCKETS.map((id) => {
    if (!hasEvidence) {
      return Object.freeze({ id, state: "UNKNOWN" as const, value: null, reasons: Object.freeze([noEvidenceReason]) });
    }
    const metric = id === "SPENDABLE" ? calculation.cash.spendable
      : id === "PENDING" ? calculation.cash.pending
      : id === "FUNDS_IN_MOTION" ? calculation.cash.fundsInMotion
      : id === "COMMITTED" ? calculation.cash.committed
      : calculation.cash.lockedCollateral;
    return Object.freeze(
      metric.state === "KNOWN"
        ? { id, state: "KNOWN" as const, value: metric.value, reasons: Object.freeze([]) }
        : { id, state: "UNKNOWN" as const, value: null, reasons: Object.freeze([...metric.reasons]) },
    );
  }));

  const degradedEvidence = failed.length > 0;
  const risk: readonly HomeRiskCategory[] = Object.freeze(HOME_RISK_CATEGORIES.map((id) => {
    if (id === "EVIDENCE") {
      const limitations = limitationsFrom([], [], [
        ...(coverage.marketValueCoverageBps === null
          ? ["the share of value this total covers is unknown"]
          : []),
        ...coverage.unknowns.map((entry) => `${entry.positionId}: ${entry.code}`),
        ...(degradedEvidence ? failed.map((source) => `${source.sourceId}: source read failed`) : []),
        ...(hasEvidence ? [] : [noEvidenceReason]),
      ]);
      const metrics = hasEvidence && coverage.marketValueCoverageBps !== null
        ? Object.freeze([])
        : Object.freeze([unknownMetric("MARKET_VALUE_COVERAGE", limitations)]);
      return Object.freeze({
        id,
        status: categoryStatus(metrics, [], degradedEvidence || coverage.unknowns.length > 0),
        metrics,
        constraints: Object.freeze([]),
        limitations,
        detailHref: COVERAGE_DETAIL,
      });
    }

    const metrics = !hasEvidence
      ? Object.freeze([unknownMetric(id, [noEvidenceReason])])
      : id === "EXPOSURE"
        ? Object.freeze([
            metricProjection("GROSS_EXPOSURE", calculation.metrics.grossExposure),
            metricProjection("LONG_EXPOSURE", calculation.metrics.longExposure),
            metricProjection("SHORT_EXPOSURE", calculation.metrics.shortExposure),
            metricProjection("NET_EXPOSURE", calculation.metrics.netExposure),
          ])
        : id === "CONCENTRATION"
          ? Object.freeze(calculation.metrics.byUnderlying.map((entry) => metricProjection(entry.underlyingKey, entry.gross)))
          : id === "LIQUIDITY"
            ? Object.freeze([
                metricProjection("SPENDABLE_CASH", calculation.cash.spendable),
                metricProjection("FUNDS_IN_MOTION", calculation.cash.fundsInMotion),
              ])
            : Object.freeze([
                metricProjection("COMMITTED_CASH", calculation.cash.committed),
                metricProjection("PENDING_CASH", calculation.cash.pending),
                metricProjection("COMMITTED_EXPOSURE", calculation.metrics.committedExposure),
                metricProjection("PENDING_EXPOSURE", calculation.metrics.pendingExposure),
              ]);

    const constraints = !hasEvidence
      ? Object.freeze([])
      : id === "EXPOSURE"
        ? constraintsFor(calculation, ["MAX_GROSS_EXPOSURE", "MAX_GROSS_EXPOSURE_BPS_OF_NET_OBSERVED_VALUE"])
        : id === "CONCENTRATION"
          ? constraintsFor(calculation, ["MAX_SINGLE_UNDERLYING_EXPOSURE", "MAX_SINGLE_UNDERLYING_BPS_OF_NET_OBSERVED_VALUE"])
          : id === "LIQUIDITY"
            ? constraintsFor(calculation, ["MIN_SPENDABLE_CASH", "MAX_FUNDS_IN_MOTION"])
            : constraintsFor(calculation, ["MAX_COMMITTED_CASH"]);

    return Object.freeze({
      id,
      status: categoryStatus(metrics, constraints, degradedEvidence),
      metrics,
      constraints,
      limitations: limitationsFrom(metrics, constraints, degradedEvidence
        ? failed.map((source) => `${source.sourceId}: source read failed`)
        : []),
      detailHref: RISK_DETAIL,
    });
  }));

  const sourceState: HomeObservedValue["sourceState"] = failed.length > 0
    ? "DEGRADED"
    : !hasEvidence
      ? "UNKNOWN"
      : sourceStates.some((entry) => entry.state === "STALE")
        ? "STALE"
        : "CURRENT";

  const canObserve = hasEvidence && coverage.includedPositionCount > 0;
  const observedValue: HomeObservedValue = Object.freeze({
    state: (canObserve ? "OBSERVED" : "UNAVAILABLE") as HomeObservedValue["state"],
    value: canObserve ? coverage.netObservedValue : null,
    reason: canObserve
      ? null
      : hasEvidence
        ? "no position carries a priced valuation under the current inclusion method"
        : noEvidenceReason,
    currency: input.displayCurrency,
    asOf: input.asOf,
    sourceState,
    coverage,
  });

  const spread = distribution({
    records: accounting.validRecords,
    uncertainIds,
    asOf: input.asOf,
    displayCurrency: input.displayCurrency,
    scale: input.scale,
    roundingMode: input.roundingMode,
    inclusionMethod: input.inclusionMethod,
    fx: input.fx,
  });

  const attention = rankAttention([
    ...input.signals,
    ...derivedAttention({
      asOf: input.asOf,
      sources,
      sourceStates,
      accountingIssues: accounting.issues,
      calculation,
      coverage,
    }),
  ]);

  const unknownPresent = coverage.unknowns.length > 0
    || calculation.unknowns.length > 0
    || cash.some((bucket) => bucket.state === "UNKNOWN")
    || risk.some((category) => category.status === "UNKNOWN");

  const state: HomePortfolioProjection["state"] = !hasEvidence && failed.length > 0
    ? "ERROR"
    : failed.length > 0
      ? "DEGRADED"
      : attention.length > 0
        ? "ATTENTION"
        : accounting.validRecords.length === 0
          ? "EMPTY"
          : unknownPresent
            ? "PARTIAL"
            : "CALM";

  const coverageLimit = Object.freeze([
    `Observed Value covers ${coverage.includedPositionCount} of ${coverage.eligiblePositionCount} eligible position(s) under ${coverage.inclusionMethod}.`,
    coverage.marketValueCoverageBps === null
      ? "The share of total value this figure covers is unknown."
      : `It covers ${(coverage.marketValueCoverageBps / 100).toFixed(2)}% of observed value magnitude.`,
    ...(coverage.stateCounts.PRIVATE_HIDDEN > 0
      ? [`${coverage.stateCounts.PRIVATE_HIDDEN} private position(s) are counted here and never valued, totalled or plotted.`]
      : []),
  ]);

  const recovery = Object.freeze(
    state === "ERROR"
      ? [
          "No source returned evidence for this read; nothing on this surface is a current financial fact.",
          "Re-check the connection for each failed source, then reload this page.",
        ]
      : [],
  );

  return Object.freeze({
    state,
    asOf: input.asOf,
    observedValue,
    coverage,
    hidden: Object.freeze({ count: coverage.stateCounts.PRIVATE_HIDDEN, amountDisclosed: false as const }),
    books: Object.freeze({
      live: bookProjection("LIVE", accounting.validRecords),
      paper: bookProjection("PAPER", accounting.validRecords),
    }),
    pnl: projectPnlBooks({
      scale: input.scale,
      roundingMode: input.roundingMode,
      displayCurrency: input.displayCurrency,
      observations: input.pnl,
    }),
    cash,
    risk,
    attention,
    sources: sourceStates,
    distribution: spread.slices,
    distributionBasis: "PRICED_POSITIONS_AT_AS_OF" as const,
    distributionExcludedCount: spread.excluded,
    coverageLimit,
    recovery,
    calculation: Object.freeze({
      schemaVersion: calculation.schemaVersion,
      formulaVersion: calculation.formulaVersion,
      inputDigest: calculation.inputDigest,
    }),
  });
}
