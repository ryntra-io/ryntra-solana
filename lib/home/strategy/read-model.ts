import { BACKTEST_REQUIREMENT_LABEL, assessBacktest, canReachApproved, type ApprovalCheck, type BacktestAssessment, type BacktestRun } from "./backtest.ts";
import { STRATEGY_STATE_LABEL, materialDiff, type StrategyState } from "./lifecycle.ts";

/**
 * The strategy lifecycle, projected from records that already exist.
 *
 * The Strategy Lab has kept durable strategies since its own packet: versions
 * with approval artifacts, evidence-ready runs with their protocol and
 * manifest, AI and manual proposals. What it has never kept is a **lifecycle
 * state**. There is no column that says a strategy is Approved, Active, Paused
 * or Archived, because no control has ever recorded one.
 *
 * So this module derives the four states the records can actually support —
 * Idea, Draft, Backtest, Forward paper — and refuses the other seven by name.
 * `STRATEGY_UNRECORDABLE_STATES` is not a to-do list; it is the honest answer to
 * *why does nothing here say Active*, and it is rendered rather than hidden,
 * because a lifecycle that silently tops out at Forward paper reads like a
 * product where nobody ever approved anything.
 *
 * **Three things the lab records are deliberately dropped.** Its evidence report
 * carries `quality`, `verdict` and a numeric `score`. Those are meaningful
 * inside the lab, where they describe *evidence completeness* against a fixed
 * rubric. Carried onto a Home surface beside a portfolio they would read as a
 * judgement about the strategy, which is exactly the universal score frozen
 * decision 20 refuses. Home shows which requirements are satisfied and which
 * are not, and lets the reader do the judging.
 *
 * **A version that changed no rule is shown as one.** The canon's rule is that
 * a material change creates a new version; the readable consequence is that a
 * version which changed nothing material is a rename, and saying so is what
 * stops a version list from reading as a history of rule changes when half of
 * it is edits to a title.
 */

export type StrategyVersionRecord = Readonly<{
  versionId: string;
  versionNumber: number;
  recordedAt: string;
  approvedAt: string;
  specHash: string;
  spec: Readonly<Record<string, unknown>>;
}>;

export type StrategyBacktestRecord = BacktestRun & Readonly<{ versionId: string; createdAt: string }>;

export type StrategyRecord = Readonly<{
  strategyId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  versions: readonly StrategyVersionRecord[];
  runs: readonly StrategyBacktestRecord[];
}>;

export type StrategyMaterialChange = Readonly<{
  fromVersion: number;
  toVersion: number;
  fields: readonly string[];
  reason: string;
}>;

export type StrategyProjection = Readonly<{
  strategyId: string;
  title: string;
  href: string;
  createdAt: string;
  updatedAt: string;
  state: StrategyState;
  stateLabel: string;
  stateReason: string;
  versionCount: number;
  latestVersion: StrategyVersionRecord | null;
  materialChanges: readonly StrategyMaterialChange[];
  evidence: readonly BacktestAssessment[];
  approval: ApprovalCheck;
  limitations: readonly string[];
}>;

export type StrategiesProjection = Readonly<{
  asOf: string;
  state: "EMPTY" | "CALM" | "ATTENTION" | "DEGRADED";
  strategies: readonly StrategyProjection[];
  counts: Readonly<{
    strategies: number;
    versions: number;
    runs: number;
    evidenceComplete: number;
    evidenceIncomplete: number;
  }>;
  unreachable: readonly Readonly<{ state: StrategyState; reason: string }>[];
  lifecycleAuthority: "USER";
  recovery: readonly string[];
}>;

/**
 * The seven states no record in this product can produce, and why.
 *
 * Each reason names the missing record rather than the missing feature: a
 * reader needs to know that nothing *observed* an approval, not that a button
 * is on a roadmap.
 */
export const STRATEGY_UNRECORDABLE_STATES: readonly Readonly<{ state: StrategyState; reason: string }>[] = [
  { state: "APPROVED", reason: "No approval decision is recorded anywhere, so no strategy can be shown as approved." },
  { state: "ACTIVE", reason: "Nothing records a strategy being put to work, and no execution path exists to observe." },
  { state: "REVIEW", reason: "No review decision is recorded, so a strategy cannot be shown as under review." },
  { state: "PAUSED", reason: "Pausing needs something running to pause, and no run state is recorded." },
  { state: "INVALIDATED", reason: "No invalidation decision is recorded against any evidence." },
  { state: "EXPIRED", reason: "No expiry is recorded on any strategy version." },
  { state: "ARCHIVED", reason: "No archive action is recorded, and a strategy is never removed from this list on its own." },
];

/**
 * The declared rule fields, flattened out of the lab's nested spec.
 *
 * Flat because materiality is a flat list: a symbol nested two levels down is
 * still the symbol, and a diff that walked the object tree would report
 * `universe` changing rather than the field a reader recognises.
 */
export function strategyRuleFields(spec: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const universe = (spec.universe ?? {}) as Record<string, unknown>;
  const stop = (spec.stop ?? {}) as Record<string, unknown>;
  const sizing = (spec.sizing ?? {}) as Record<string, unknown>;
  const risk = (spec.riskPolicy ?? {}) as Record<string, unknown>;
  const cost = (spec.costModel ?? {}) as Record<string, unknown>;
  return {
    assetClass: universe.assetClass ?? null,
    symbol: universe.symbol ?? null,
    timeframe: spec.timeframe ?? null,
    direction: risk.allowShort ?? null,
    entry: spec.entry ?? null,
    exit: spec.exit ?? null,
    stopPercent: stop.value ?? null,
    riskPercent: sizing.value ?? null,
    maxDrawdownPercent: risk.maxDrawdownPercent ?? null,
    positionSizing: sizing.kind ?? null,
    commissionBps: cost.commissionBps ?? null,
    spreadBps: cost.spreadBps ?? null,
    slippageBps: cost.slippageBps ?? null,
    fundingBpsPerDay: cost.fundingBpsPerDay ?? null,
  };
}

function deriveState(record: StrategyRecord, evidence: readonly BacktestAssessment[]): Readonly<{
  state: StrategyState;
  reason: string;
}> {
  if (record.versions.length === 0) {
    return {
      state: "IDEA",
      reason: "No version is recorded for this strategy, so nothing states what its rules are.",
    };
  }
  if (record.runs.length === 0) {
    return {
      state: "DRAFT",
      reason: "The rules are recorded and no backtest run exists against them yet.",
    };
  }
  const complete = evidence.filter((assessment) => canReachApproved(assessment).ok);
  if (complete.length === 0) {
    return {
      state: "BACKTEST",
      /* Named with the requirement's own label rather than its key. Found by
         looking: this sentence read "... : missingData, forwardEvidence", which
         is two internal identifiers where a reader needed two facts. */
      reason:
        "A run exists but its evidence is incomplete, so the strategy has not reached forward paper: " +
        [...new Set(evidence.flatMap((assessment) => assessment.missing))]
          .map((requirement) => BACKTEST_REQUIREMENT_LABEL[requirement])
          .join(", ") +
        ".",
    };
  }
  return {
    state: "FORWARD_PAPER",
    reason:
      "A run carries complete evidence including out-of-sample and forward proof. Approval is a decision nothing records, so the lifecycle stops here.",
  };
}

function changes(versions: readonly StrategyVersionRecord[]): readonly StrategyMaterialChange[] {
  const ordered = [...versions].sort((left, right) => left.versionNumber - right.versionNumber);
  const result: StrategyMaterialChange[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const next = ordered[index];
    const fields = materialDiff(strategyRuleFields(previous.spec), strategyRuleFields(next.spec));
    result.push({
      fromVersion: previous.versionNumber,
      toVersion: next.versionNumber,
      fields,
      reason:
        fields.length === 0
          ? "This version changed no rule field, so it records an edit rather than a change to what the strategy would do."
          : "A material rule change, which is why it is a new version rather than an edit to the last one.",
    });
  }
  return result;
}

export function projectStrategies(input: Readonly<{
  asOf: string;
  records: readonly StrategyRecord[];
  recovery: readonly string[];
}>): StrategiesProjection {
  const strategies: StrategyProjection[] = input.records.map((record) => {
    const evidence = record.runs.map((run) => assessBacktest(run));
    const derived = deriveState(record, evidence);
    const ordered = [...record.versions].sort((left, right) => right.versionNumber - left.versionNumber);
    const best = evidence.find((assessment) => canReachApproved(assessment).ok) ?? evidence[0] ?? null;

    const limitations: string[] = [];
    if (record.runs.length === 0) {
      limitations.push("No backtest run is recorded against any version of this strategy.");
    }
    for (const assessment of evidence) {
      if (assessment.state !== "EVIDENCE") {
        limitations.push(
          "Run " + assessment.runId + " is missing " +
            assessment.missing.map((requirement) => BACKTEST_REQUIREMENT_LABEL[requirement]).join(", ") + ".",
        );
      }
    }

    return {
      strategyId: record.strategyId,
      title: record.title,
      href: "/app/strategies/" + record.strategyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      state: derived.state,
      stateLabel: STRATEGY_STATE_LABEL[derived.state],
      stateReason: derived.reason,
      versionCount: record.versions.length,
      latestVersion: ordered[0] ?? null,
      materialChanges: changes(record.versions),
      evidence,
      approval: best === null
        ? { ok: false, reason: "No run exists, so there is no evidence to approve anything on." }
        : canReachApproved(best),
      limitations,
    };
  });

  const counts = {
    strategies: strategies.length,
    versions: strategies.reduce((total, strategy) => total + strategy.versionCount, 0),
    runs: strategies.reduce((total, strategy) => total + strategy.evidence.length, 0),
    evidenceComplete: strategies.reduce(
      (total, strategy) => total + strategy.evidence.filter((assessment) => assessment.state === "EVIDENCE").length,
      0,
    ),
    evidenceIncomplete: strategies.reduce(
      (total, strategy) => total + strategy.evidence.filter((assessment) => assessment.state !== "EVIDENCE").length,
      0,
    ),
  };

  const state: StrategiesProjection["state"] = input.recovery.length > 0
    ? "DEGRADED"
    : strategies.length === 0
      ? "EMPTY"
      : counts.evidenceIncomplete > 0
        ? "ATTENTION"
        : "CALM";

  return {
    asOf: input.asOf,
    state,
    strategies,
    counts,
    unreachable: STRATEGY_UNRECORDABLE_STATES,
    lifecycleAuthority: "USER",
    recovery: input.recovery,
  };
}

export function findStrategy(
  projection: StrategiesProjection,
  strategyId: string,
): StrategyProjection | null {
  return projection.strategies.find((strategy) => strategy.strategyId === strategyId) ?? null;
}
