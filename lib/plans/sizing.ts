/**
 * The deterministic size of a Trading Plan.
 *
 * Spot-long with a stated invalidation, in comparable units (USD per
 * underlying share on both sides):
 *
 *   lossPerShare        = entry − invalidation + entry × costBufferBps / 10 000
 *   riskLimitedUnits    = plannedRiskUsd / lossPerShare
 *   capitalLimitedUnits = (budgetUsd − reserveForCostsUsd) / entry
 *   units               = min(riskLimitedUnits, capitalLimitedUnits)
 *   notionalUsd         = units × entry
 *
 * A planning model under stated assumptions, never a promised maximum
 * loss: a gap through the invalidation, slippage, missing liquidity or a
 * missed manual exit change what is lost, and v1 places no exit order. The
 * assumptions travel with the figure so the UI shows them beside it.
 *
 * Pure and client-safe: the same function sizes the form on the web, the
 * phone's preview and the server's stored version, so no client keeps a
 * second financial logic. Costs are modelled once, in `lossPerShare`; the
 * budget is spent net of the reserve; nothing here subtracts a fee twice.
 *
 * The module owns the shape it reads and the shape it returns. A full plan
 * carries more (a thesis, execution limits, evidence conditions) and
 * satisfies `PlanSizingRules` structurally; the API contract's plan types are
 * built on the same fields, so a stored plan and this function agree by
 * construction rather than by import.
 */

/**
 * The stable id of a rule that failed (1.7.0) — the same list the contract's
 * `PLAN_ISSUE_CODES` enumerates (the contract test pins the two together),
 * written here as a type so this module keeps owning its own shapes.
 */
export type PlanIssueCode =
  | "INVALIDATION_NOT_BELOW_ENTRY"
  | "MAX_PRICE_BELOW_ENTRY"
  | "ENTRY_VALIDITY_OVER"
  | "RESERVE_LEAVES_NOTHING"
  | "RISK_ABOVE_BUDGET"
  | "TARGET_NOT_ABOVE_ENTRY"
  | "TIME_EXIT_IN_PAST"
  | "TIME_EXIT_BEFORE_VALIDITY"
  | "LOSS_PER_UNIT_NOT_POSITIVE"
  | "SIZES_TO_NOTHING"
  | "REFERENCE_NOT_ON_TOKEN"
  | "DEVIATION_NOT_ON_TOKEN";

/** A failing rule: the field, the sentence, and (1.7.0) the stable id a client renders in its own words with the person's figures. */
export type PlanIssue = Readonly<{ path: string; message: string; code?: PlanIssueCode }>;

/**
 * What the size is computed for (1.7.0): the unit word the assumptions use
 * and the token rules. A stock plan is the default — every caller before
 * 1.7.0 passes nothing and reads the same size as before.
 */
export type PlanSizingContext = Readonly<{
  /** `share` (the default) or `token`. */
  unitWord?: "share" | "token";
  /** True on a crypto or meme asset: the reference cannot be required and no deviation bound can be set, because there is no issuer reference. */
  tokenAsset?: boolean;
}>;

/** The rules the size is computed from — per underlying unit, in USD. */
export type PlanSizingRules = Readonly<{
  entry: Readonly<{
    /** The planned entry, the basis every size is computed on. */
    pricePerShare: number;
    /** The bound above which the execution is refused; null means reported, never refused. */
    maxPricePerShare: number | null;
    /** ISO time the entry stops being valid; null means no limit. */
    validUntil: string | null;
  }>;
  capital: Readonly<{
    budgetUsd: number;
    /** Kept back for costs; the size spends `budgetUsd − reserveForCostsUsd`. */
    reserveForCostsUsd: number;
  }>;
  risk: Readonly<{
    /** Below the entry: where the thesis is wrong. */
    invalidationPerShare: number;
    /** The loss the person plans for if the invalidation is hit. */
    plannedRiskUsd: number;
    /** Modelled cost and slippage on the way in and out, basis points of the entry. */
    costBufferBps: number;
  }>;
  exit: Readonly<{
    targetPerShare: number | null;
    timeExitAt: string | null;
  }>;
  /** Typed evidence conditions — a person's rules on observations. Carried, not read: the size is arithmetic on money, and the evidence layer validates the conditions on their own registry. */
  evidenceConditions: readonly unknown[];
  /** The execution limits, where the caller sizes a full plan (1.7.0): on a token asset the two reference rules are refused here, because there is no reference to judge them on. */
  execution?: Readonly<{ referenceRequired: boolean; maxReferenceDeviationPct: number | null }>;
}>;

/** The deterministic size and the assumptions it stands on. */
export type PlanSizing = {
  model: "spot-long-v1";
  lossPerShareUsd: number;
  riskLimitedUnits: number;
  capitalLimitedUnits: number;
  /** Underlying units, truncated to six decimals. */
  units: number;
  notionalUsd: number;
  limitedBy: "risk" | "capital";
  /** What the model assumes, in the person's language; shown beside the figure, never hidden. */
  assumptions: string[];
};

const UNIT_DECIMALS = 6;

function truncate(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-9) / factor;
}

/**
 * The rules that fail as rules, before any size is computed. Empty means the
 * plan is well-formed; the list is what `PLAN_INVALID` carries as `issues`.
 * Times are judged against `nowMs`, so an expired entry is refused at write.
 */
export function validatePlanRules(rules: PlanSizingRules, nowMs: number, context: PlanSizingContext = {}): readonly PlanIssue[] {
  const issues: PlanIssue[] = [];
  const { entry, capital, risk, exit } = rules;
  const unit = context.unitWord ?? "share";
  if (!(entry.pricePerShare > risk.invalidationPerShare)) {
    issues.push({ path: "risk.invalidationPerShare", code: "INVALIDATION_NOT_BELOW_ENTRY", message: "The invalidation must be below the planned entry for a long." });
  }
  if (entry.maxPricePerShare !== null && entry.maxPricePerShare < entry.pricePerShare) {
    issues.push({ path: "entry.maxPricePerShare", code: "MAX_PRICE_BELOW_ENTRY", message: "The maximum entry price cannot be below the planned entry." });
  }
  if (entry.validUntil !== null && Date.parse(entry.validUntil) <= nowMs) {
    issues.push({ path: "entry.validUntil", code: "ENTRY_VALIDITY_OVER", message: "The entry's validity is already over." });
  }
  const spendable = capital.budgetUsd - capital.reserveForCostsUsd;
  if (!(spendable > 0)) {
    issues.push({ path: "capital.reserveForCostsUsd", code: "RESERVE_LEAVES_NOTHING", message: "The reserve for costs leaves nothing of the budget to spend." });
  }
  if (risk.plannedRiskUsd > capital.budgetUsd) {
    issues.push({ path: "risk.plannedRiskUsd", code: "RISK_ABOVE_BUDGET", message: "The planned risk cannot exceed the budget." });
  }
  if (exit.targetPerShare !== null && exit.targetPerShare <= entry.pricePerShare) {
    issues.push({ path: "exit.targetPerShare", code: "TARGET_NOT_ABOVE_ENTRY", message: "The target must be above the planned entry for a long." });
  }
  if (exit.timeExitAt !== null && Date.parse(exit.timeExitAt) <= nowMs) {
    issues.push({ path: "exit.timeExitAt", code: "TIME_EXIT_IN_PAST", message: "The time exit is already in the past." });
  }
  if (entry.validUntil !== null && exit.timeExitAt !== null && Date.parse(exit.timeExitAt) < Date.parse(entry.validUntil)) {
    issues.push({ path: "exit.timeExitAt", code: "TIME_EXIT_BEFORE_VALIDITY", message: "The time exit is before the entry stops being valid." });
  }
  /* A token has no issuer reference (1.7.0): a rule that could never be judged
     is refused at the write, not left to block every Review. The execution
     rules are carried by the full plan; a caller that sizes bare money rules
     has none and is judged on nothing here. */
  const execution = rules.execution;
  if (context.tokenAsset && execution?.referenceRequired === true) {
    issues.push({ path: "execution.referenceRequired", code: "REFERENCE_NOT_ON_TOKEN", message: `A ${unit === "token" ? "token" : "share"} of this kind has no issuer reference, so the reference cannot be required.` });
  }
  if (context.tokenAsset && execution?.maxReferenceDeviationPct !== undefined && execution.maxReferenceDeviationPct !== null) {
    issues.push({ path: "execution.maxReferenceDeviationPct", code: "DEVIATION_NOT_ON_TOKEN", message: "A token of this kind has no issuer reference, so no deviation bound can be set." });
  }
  return issues;
}

/** The size, or the issues that make it impossible (a plan with issues has no size). */
export function computePlanSizing(rules: PlanSizingRules, nowMs: number, context: PlanSizingContext = {}): Readonly<{ ok: true; sizing: PlanSizing }> | Readonly<{ ok: false; issues: readonly PlanIssue[] }> {
  const issues = validatePlanRules(rules, nowMs, context);
  if (issues.length > 0) return { ok: false, issues };
  const unit = context.unitWord ?? "share";
  const { entry, capital, risk } = rules;
  const costPerShare = (entry.pricePerShare * risk.costBufferBps) / 10_000;
  const lossPerShareUsd = entry.pricePerShare - risk.invalidationPerShare + costPerShare;
  if (!(lossPerShareUsd > 0) || !Number.isFinite(lossPerShareUsd)) {
    return { ok: false, issues: [{ path: "risk.invalidationPerShare", code: "LOSS_PER_UNIT_NOT_POSITIVE", message: `The loss per ${unit} is not a positive number.` }] };
  }
  const riskLimitedUnits = truncate(risk.plannedRiskUsd / lossPerShareUsd, UNIT_DECIMALS);
  const capitalLimitedUnits = truncate((capital.budgetUsd - capital.reserveForCostsUsd) / entry.pricePerShare, UNIT_DECIMALS);
  const limitedBy: PlanSizing["limitedBy"] = riskLimitedUnits <= capitalLimitedUnits ? "risk" : "capital";
  const units = Math.min(riskLimitedUnits, capitalLimitedUnits);
  if (!(units > 0)) {
    return { ok: false, issues: [{ path: "capital.budgetUsd", code: "SIZES_TO_NOTHING", message: "The budget and the planned risk size to nothing." }] };
  }
  const notionalUsd = truncate(units * entry.pricePerShare, 2);
  const assumptions = [
    `The invalidation at $${formatUsd(risk.invalidationPerShare)} per ${unit} is a rule you act on, not an exit order.`,
    `Costs and slippage are modelled at ${(risk.costBufferBps / 100).toFixed(2)}% of the entry, on the way in and out together.`,
    "A gap through the invalidation, missing liquidity or a missed exit can lose more than the planned risk.",
    limitedBy === "risk" ? "The size is limited by the planned risk, not by the budget." : "The size is limited by the budget, not by the planned risk.",
  ];
  return {
    ok: true,
    sizing: { model: "spot-long-v1", lossPerShareUsd: roundPrice(lossPerShareUsd), riskLimitedUnits, capitalLimitedUnits, units, notionalUsd, limitedBy, assumptions },
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * A per-unit figure rounded to six decimals, as every share plan was — and,
 * below a cent (a meme priced in millionths of a dollar), to six significant
 * digits instead, so the loss per unit is never rounded to nothing.
 */
export function roundPrice(value: number): number {
  if (value >= 0.01 || value <= 0) return round(value, 6);
  return Number(value.toPrecision(6));
}

/**
 * Money the assumptions print: two decimals from a cent up, and below a cent
 * (a token priced in fractions of a cent) enough significant digits to say
 * the figure rather than `$0.00`.
 */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return value >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
