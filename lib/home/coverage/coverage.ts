/**
 * Coverage — how much of the reader's world this product can actually see.
 *
 * Three questions, kept apart because they fail for different reasons: which
 * declared **sources** answered, how much of the reader's own **data** carries
 * the fields a calculation needs, and what the declared **AI and data budgets**
 * have recorded.
 *
 * Two rules do the work here, and both are refusals.
 *
 * **A percentage is not offered.** `67%` reads as a measurement and hides the
 * denominator that makes it meaningful — twelve of eighteen and two of three
 * are the same figure and not the same situation. So a count is always
 * `counted`, `total` and the *named* reasons for the gap, and the sum of those
 * reasons has to account for the gap or the count is refused outright. A
 * display layer that wants a percentage has to compute it, which is the moment
 * somebody asks whether it should.
 *
 * **Unrecorded is not zero.** A budget with no recorded spend is the single
 * most tempting place in this product to write `0`, and it would be a
 * fabricated measurement: nobody observed zero calls, nobody observed anything.
 * `UNRECORDED` and `NOT_DECLARED` are separate states and neither renders as a
 * number.
 *
 * Pure: no clock, no fetch, no randomness. `asOf` arrives from the caller.
 */

export const COVERAGE_GROUPS = ["SOURCES", "DATA", "AI_BUDGET"] as const;

export type CoverageGroup = (typeof COVERAGE_GROUPS)[number];

export type UncountedReason = Readonly<{ reason: string; count: number }>;

export type CoverageCount = Readonly<{
  counted: number;
  total: number;
  uncounted: readonly UncountedReason[];
  state: "COMPLETE" | "PARTIAL" | "NOTHING_IN_SCOPE";
  label: string;
}>;

/**
 * A count that cannot be shown without its denominator or without its gap.
 *
 * The refusal is the point: if the named reasons do not account for the
 * difference, the count is describing something the caller has not actually
 * measured, and shipping it would put an unexplained gap on an evidence
 * surface.
 */
export function coverageCount(input: Readonly<{
  counted: number;
  total: number;
  uncounted: readonly UncountedReason[];
}>): CoverageCount {
  if (!Number.isInteger(input.counted) || !Number.isInteger(input.total) || input.counted < 0 || input.total < 0) {
    throw new TypeError("coverageCount: counted and total must be non-negative integers");
  }
  if (input.counted > input.total) {
    throw new TypeError("coverageCount: counted cannot exceed total");
  }
  const gap = input.total - input.counted;
  const named = input.uncounted.reduce((sum, entry) => sum + entry.count, 0);
  if (named !== gap) {
    throw new TypeError(
      "coverageCount: the uncounted reasons account for " + String(named) + " of " + String(gap)
      + ". Every item outside the count needs a named reason.",
    );
  }

  if (input.total === 0) {
    return { counted: 0, total: 0, uncounted: [], state: "NOTHING_IN_SCOPE", label: "Nothing in scope" };
  }
  return {
    counted: input.counted,
    total: input.total,
    uncounted: input.uncounted,
    state: gap === 0 ? "COMPLETE" : "PARTIAL",
    label: String(input.counted) + " of " + String(input.total),
  };
}

export type BudgetReading = Readonly<{ declared: number | null; recorded: number | null }>;

export type BudgetState = Readonly<{
  declared: number | null;
  recorded: number | null;
  state: "WITHIN" | "EXHAUSTED" | "UNRECORDED" | "NOT_DECLARED";
  label: string;
  /**
   * The figure a tile shows beside its state chip.
   *
   * Separate from `label` because a tile renders both, and for the two states
   * with no number `label` *is* the state word — so the tile printed
   * `UNRECORDED / Unrecorded`, the same word twice, which is a defect this
   * product has now shipped twice. The figure carries the declared ceiling
   * instead, which is the fact the chip does not already state.
   */
  figure: string;
  reason: string;
}>;

export function budgetState(input: BudgetReading): BudgetState {
  if (input.declared === null) {
    return {
      declared: null,
      recorded: input.recorded,
      state: "NOT_DECLARED",
      label: input.recorded === null ? "Not declared" : String(input.recorded) + " recorded, no limit declared",
      figure: input.recorded === null ? "—" : String(input.recorded) + " recorded",
      reason: "No limit is declared in the research mandate. An undeclared limit is not an unlimited one — nothing is enforcing a ceiling.",
    };
  }
  if (input.recorded === null) {
    return {
      declared: input.declared,
      recorded: null,
      state: "UNRECORDED",
      label: "Unrecorded",
      figure: "Limit " + String(input.declared),
      reason: "A limit of " + String(input.declared) + " is declared and nothing recorded a spend against it. No record is not the same as none spent.",
    };
  }
  return {
    declared: input.declared,
    recorded: input.recorded,
    state: input.recorded >= input.declared ? "EXHAUSTED" : "WITHIN",
    label: String(input.recorded) + " of " + String(input.declared),
    figure: String(input.recorded) + " of " + String(input.declared),
    reason: input.recorded >= input.declared
      ? "The declared limit is reached, so further work under this budget is refused."
      : "Recorded spend is inside the declared limit.",
  };
}

/* ---------------------------------------------------------------- sources */

export const COVERAGE_SOURCE_STATES = ["OK", "STALE", "FAILED", "NEVER_OBSERVED"] as const;

export type CoverageSourceState = (typeof COVERAGE_SOURCE_STATES)[number];

export type CoverageSource = Readonly<{
  sourceId: string;
  label: string;
  state: CoverageSourceState;
  entitlement: string;
  observedAt: string | null;
  reason: string | null;
}>;

export type CoverageOwner = Readonly<{ surface: string; href: string }>;

export type CoverageTile = Readonly<{
  tileId: string;
  group: CoverageGroup;
  label: string;
  value: string;
  state: "COMPLETE" | "PARTIAL" | "NOTHING_IN_SCOPE" | "WITHIN" | "EXHAUSTED" | "UNRECORDED" | "NOT_DECLARED" | "DEGRADED";
  reason: string;
  owner: CoverageOwner;
}>;

export type CoverageProjection = Readonly<{
  asOf: string;
  state: "EMPTY" | "CALM" | "PARTIAL" | "DEGRADED";
  emptyReason: string;
  sources: readonly CoverageSource[];
  sourceCoverage: CoverageCount;
  data: Readonly<{ positions: CoverageCount; valuations: CoverageCount; identities: CoverageCount }>;
  budgets: Readonly<{ dataReadsPerDay: BudgetState; aiCallsPerDay: BudgetState; maxAlertsPerDay: BudgetState }>;
  tiles: readonly CoverageTile[];
}>;

const DATA_OWNER: CoverageOwner = { surface: "Portfolio", href: "/app/portfolio" };
const SOURCE_OWNER: CoverageOwner = { surface: "Connections", href: "/app/connect" };
const BUDGET_OWNER: CoverageOwner = { surface: "Research", href: "/app/research" };

export function projectCoverage(input: Readonly<{
  asOf: string;
  sources: readonly CoverageSource[];
  data: Readonly<{
    positions: Readonly<{ counted: number; total: number; uncounted: readonly UncountedReason[] }>;
    valuations: Readonly<{ counted: number; total: number; uncounted: readonly UncountedReason[] }>;
    identities: Readonly<{ counted: number; total: number; uncounted: readonly UncountedReason[] }>;
  }>;
  budgets: Readonly<{
    dataReadsPerDay: BudgetReading;
    aiCallsPerDay: BudgetReading;
    maxAlertsPerDay: BudgetReading;
  }>;
}>): CoverageProjection {
  const sources = [...input.sources].sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));

  const answered = sources.filter((entry) => entry.state === "OK");
  const uncountedSources: UncountedReason[] = [];
  for (const state of ["STALE", "FAILED", "NEVER_OBSERVED"] as const) {
    const count = sources.filter((entry) => entry.state === state).length;
    if (count > 0) {
      uncountedSources.push({
        reason: state === "STALE"
          ? "Answered, but older than its freshness window"
          : state === "FAILED"
            ? "Refused or errored on the last read"
            : "Never observed — no connection has ever been made",
        count,
      });
    }
  }
  const sourceCoverage = coverageCount({ counted: answered.length, total: sources.length, uncounted: uncountedSources });

  const data = {
    positions: coverageCount(input.data.positions),
    valuations: coverageCount(input.data.valuations),
    identities: coverageCount(input.data.identities),
  } as const;

  const budgets = {
    dataReadsPerDay: budgetState(input.budgets.dataReadsPerDay),
    aiCallsPerDay: budgetState(input.budgets.aiCallsPerDay),
    maxAlertsPerDay: budgetState(input.budgets.maxAlertsPerDay),
  } as const;

  const tiles: CoverageTile[] = [
    {
      tileId: "sources-answered",
      group: "SOURCES",
      label: "Sources answering",
      value: sourceCoverage.label,
      state: sourceCoverage.state,
      reason: sourceCoverage.uncounted.length === 0
        ? "Every declared source answered on its last read."
        : sourceCoverage.uncounted.map((entry) => entry.reason + ": " + String(entry.count)).join(" · "),
      owner: SOURCE_OWNER,
    },
    {
      tileId: "data-positions",
      group: "DATA",
      label: "Positions in the calculation",
      value: data.positions.label,
      state: data.positions.state,
      reason: data.positions.uncounted.length === 0
        ? "Every position carries the fields the calculation needs."
        : data.positions.uncounted.map((entry) => entry.reason + ": " + String(entry.count)).join(" · "),
      owner: DATA_OWNER,
    },
    {
      tileId: "data-valuations",
      group: "DATA",
      label: "Positions with a valuation",
      value: data.valuations.label,
      state: data.valuations.state,
      reason: data.valuations.uncounted.length === 0
        ? "Every position has a price at the valuation instant."
        : data.valuations.uncounted.map((entry) => entry.reason + ": " + String(entry.count)).join(" · "),
      owner: DATA_OWNER,
    },
    {
      tileId: "data-identities",
      group: "DATA",
      label: "Positions with an identity match",
      value: data.identities.label,
      state: data.identities.state,
      reason: data.identities.uncounted.length === 0
        ? "Every position resolves to a known instrument."
        : data.identities.uncounted.map((entry) => entry.reason + ": " + String(entry.count)).join(" · "),
      owner: DATA_OWNER,
    },
    {
      tileId: "budget-data-reads",
      group: "AI_BUDGET",
      label: "Data reads per day",
      value: budgets.dataReadsPerDay.figure,
      state: budgets.dataReadsPerDay.state,
      reason: budgets.dataReadsPerDay.reason,
      owner: BUDGET_OWNER,
    },
    {
      tileId: "budget-ai-calls",
      group: "AI_BUDGET",
      label: "AI calls per day",
      value: budgets.aiCallsPerDay.figure,
      state: budgets.aiCallsPerDay.state,
      reason: budgets.aiCallsPerDay.reason,
      owner: BUDGET_OWNER,
    },
    {
      tileId: "budget-alerts",
      group: "AI_BUDGET",
      label: "Alerts per day",
      value: budgets.maxAlertsPerDay.figure,
      state: budgets.maxAlertsPerDay.state,
      reason: budgets.maxAlertsPerDay.reason,
      owner: { surface: "Alerts", href: "/app/alerts" },
    },
  ];

  const nothingDeclared = sources.length === 0
    && data.positions.state === "NOTHING_IN_SCOPE"
    && budgets.dataReadsPerDay.state === "NOT_DECLARED"
    && budgets.aiCallsPerDay.state === "NOT_DECLARED";

  const degraded = sources.some((entry) => entry.state === "FAILED" || entry.state === "STALE");
  const partial = data.positions.state === "PARTIAL"
    || data.valuations.state === "PARTIAL"
    || data.identities.state === "PARTIAL"
    || sourceCoverage.state === "PARTIAL";

  return {
    asOf: input.asOf,
    state: nothingDeclared ? "EMPTY" : degraded ? "DEGRADED" : partial ? "PARTIAL" : "CALM",
    emptyReason: "Nothing is in scope yet. Connect a source in Connections and declare a research mandate to give this surface something to cover.",
    sources,
    sourceCoverage,
    data,
    budgets,
    tiles,
  };
}
