/**
 * When a backtest counts as evidence, and when it is just a curve.
 *
 * Home canon §10: *Backtest evidence must identify data and version, costs,
 * missing data, drawdown, out-of-sample/forward evidence and sensitivity; an
 * in-sample curve is never proof of future performance.*
 *
 * Seven requirements, each checked separately and each refused by name. That
 * separation is the point: "the backtest is incomplete" tells a reader nothing
 * they can act on, while "no maximum drawdown is recorded and costs were not
 * included" tells them exactly which two things to fix.
 *
 * **Two requirements are the ones that get quietly satisfied.** *Missing data*
 * passes when the run states how many bars were missing **and why** — a run
 * that reports forty missing bars with no reason has not disclosed anything, it
 * has produced a number nobody can interpret, so unstated missing data is
 * itself missing. And *out-of-sample* distinguishes `blind` from
 * `self-attested`: both are evidence, one is weaker, and flattening them into a
 * boolean is how a strategy that was tuned on its own holdout gets treated like
 * one that was not.
 *
 * **Nothing here scores anything.** No grade, no confidence, no quality. The
 * assessment reports which requirements are satisfied and which are not, and
 * the reader decides — which is the only arrangement `adviceAuthority: NONE`
 * permits.
 */

export const BACKTEST_REQUIREMENTS = [
  "dataset",
  "datasetVersion",
  "costs",
  "missingData",
  "maxDrawdown",
  "outOfSample",
  "forwardEvidence",
] as const;

export type BacktestRequirement = (typeof BACKTEST_REQUIREMENTS)[number];

export const BACKTEST_REQUIREMENT_LABEL: Readonly<Record<BacktestRequirement, string>> = {
  dataset: "Data identified",
  datasetVersion: "Data version",
  costs: "Costs included",
  missingData: "Missing data stated",
  maxDrawdown: "Maximum drawdown",
  outOfSample: "Out-of-sample",
  forwardEvidence: "Forward evidence",
};

export type BacktestRun = Readonly<{
  runId: string;
  dataset: string | null;
  datasetVersion: string | null;
  engineVersion: string | null;
  costsIncluded: boolean;
  commissionBps: number | null;
  spreadBps: number | null;
  slippageBps: number | null;
  fundingBpsPerDay: number | null;
  missingDataBars: number | null;
  missingDataReason: string | null;
  maxDrawdownPercent: number | null;
  outOfSample: "none" | "self-attested" | "blind" | null;
  forwardEvidence: boolean;
  parameterSensitivity: "not-tested" | "fragile" | "stable" | null;
  regimesCovered: number | null;
  trades: number | null;
}>;

export type BacktestAssessment = Readonly<{
  runId: string;
  state: "EVIDENCE" | "INCOMPLETE";
  satisfied: readonly BacktestRequirement[];
  missing: readonly BacktestRequirement[];
  reasons: Readonly<Record<string, string>>;
  /** How the out-of-sample claim was reached. Never flattened to a boolean. */
  strength: "NONE" | "SELF_ATTESTED" | "BLIND" | "UNSTATED";
  maxDrawdownPercent: number | null;
  missingDataBars: number | null;
  trades: number | null;
  parameterSensitivity: BacktestRun["parameterSensitivity"];
  regimesCovered: number | null;
}>;

function strengthOf(run: BacktestRun): BacktestAssessment["strength"] {
  if (run.outOfSample === "blind") return "BLIND";
  if (run.outOfSample === "self-attested") return "SELF_ATTESTED";
  if (run.outOfSample === "none") return "NONE";
  return "UNSTATED";
}

export function assessBacktest(run: BacktestRun): BacktestAssessment {
  const reasons: Record<string, string> = {};
  const missing: BacktestRequirement[] = [];

  const fail = (requirement: BacktestRequirement, reason: string) => {
    missing.push(requirement);
    reasons[requirement] = reason;
  };

  if (!run.dataset || run.dataset.trim().length === 0) {
    fail("dataset", "The run does not identify the data it ran over, so nobody can repeat it.");
  }
  if (!run.datasetVersion || run.datasetVersion.trim().length === 0) {
    fail("datasetVersion", "The data has no version, so a later run cannot be compared to this one.");
  }
  if (!run.costsIncluded) {
    fail("costs", "Costs were not included, so the result describes a market with no commission, spread or slippage.");
  }
  if (run.missingDataBars === null || run.missingDataBars === undefined) {
    fail("missingData", "The run does not say how much data was missing, so the gaps are unknown rather than absent.");
  } else if (run.missingDataBars > 0 && (!run.missingDataReason || run.missingDataReason.trim().length === 0)) {
    fail("missingData", "Missing data is counted but not explained, so the count cannot be interpreted.");
  }
  if (run.maxDrawdownPercent === null || run.maxDrawdownPercent === undefined) {
    fail("maxDrawdown", "No maximum drawdown is recorded, so the worst part of the curve is not stated.");
  }
  const strength = strengthOf(run);
  if (strength === "NONE" || strength === "UNSTATED") {
    fail("outOfSample", "No out-of-sample evidence is recorded. An in-sample curve is never proof of future performance.");
  }
  if (!run.forwardEvidence) {
    fail("forwardEvidence", "No forward evidence exists, so nothing has been observed after the rules were fixed.");
  }

  const satisfied = BACKTEST_REQUIREMENTS.filter((requirement) => !missing.includes(requirement));

  return {
    runId: run.runId,
    state: missing.length === 0 ? "EVIDENCE" : "INCOMPLETE",
    satisfied,
    missing,
    reasons,
    strength,
    maxDrawdownPercent: run.maxDrawdownPercent,
    missingDataBars: run.missingDataBars,
    trades: run.trades,
    parameterSensitivity: run.parameterSensitivity,
    regimesCovered: run.regimesCovered,
  };
}

export type ApprovalCheck = Readonly<{ ok: boolean; reason: string }>;

/**
 * Whether this evidence could carry a strategy to `APPROVED`.
 *
 * It is a *permission*, not an approval: the lifecycle still requires the human
 * transition, and this function only refuses the ones the canon refuses.
 */
export function canReachApproved(assessment: BacktestAssessment): ApprovalCheck {
  if (assessment.state !== "EVIDENCE") {
    return {
      ok: false,
      reason:
        "This run is not evidence yet: " +
        assessment.missing.map((requirement) => BACKTEST_REQUIREMENT_LABEL[requirement]).join(", ") +
        ".",
    };
  }
  if (assessment.strength === "NONE" || assessment.strength === "UNSTATED") {
    return { ok: false, reason: "No out-of-sample evidence, so an in-sample curve is all there is." };
  }
  return { ok: true, reason: "Every recorded requirement is satisfied, including out-of-sample and forward evidence." };
}
