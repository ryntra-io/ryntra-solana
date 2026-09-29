/**
 * The Prediction Plan: a typed plan class of its own, native to markets on outcomes, in the three-step Ryntra
 * grammar — *Why* (the thesis and the outcome), *Risk / Money* (the amount,
 * the principal at risk, the entry probability and its bound), *Conditions*
 * (the invalidation, the resolution deadline, the monitoring rules and the
 * research references). No stock field is forced on it: there is no share,
 * no reference price, no multiplier — a prediction pays $1 a share if the
 * outcome resolves in its favour and $0 otherwise, so the whole amount is
 * the principal at risk.
 *
 * This file is the model — the schemas, the sizing and the validation — and
 * imports nothing of the server, so the plan builder in the browser computes
 * what the rules imply the one way the server does. The store and the
 * lifecycle live in `plan.ts`.
 */

import { z } from "zod";

export const PREDICTION_PLAN_ID = /^pplan_[0-9a-f]{24}$/;
export const PREDICTION_PLAN_STATUSES = ["draft", "active", "executed", "cancelled", "expired"] as const;
export type PredictionPlanStatus = (typeof PREDICTION_PLAN_STATUSES)[number];
export const PREDICTION_PLAN_LIST_LIMIT = 50;
export const PREDICTION_PLAN_VERSIONS_KEPT = 50;
export const PREDICTION_PLAN_JOURNAL_KEPT = 100;

const Usd = z.number().finite().positive().max(1_000_000);
const Probability = z.number().finite().min(0.001).max(0.999);
const Iso = z.string().datetime({ offset: true });
const Note = z.string().max(240);
const Url = z.string().url().max(512);

/** Which figure a monitoring condition watches, and how. */
export const PREDICTION_MONITOR_METRICS = ["probability", "volume24h", "signal", "resolution", "plan"] as const;
export type PredictionMonitorMetric = (typeof PREDICTION_MONITOR_METRICS)[number];

export const PredictionMonitorConditionSchema = z
  .object({
    metric: z.enum(PREDICTION_MONITOR_METRICS),
    /** `probability`: crosses `threshold` (0–1) in `direction`; `volume24h`: moves by `threshold` % ; `resolution`: `threshold` hours before the end; `signal` and `plan`: no threshold. */
    direction: z.enum(["above", "below", "any"]),
    threshold: z.number().finite().nullable(),
    note: Note.nullable(),
  })
  .strict();
export type PredictionMonitorCondition = z.infer<typeof PredictionMonitorConditionSchema>;

export const PredictionPlanRulesSchema = z
  .object({
    /* ---- Why */
    thesis: z.string().min(1).max(2000),
    whyNow: z.string().max(500).nullable(),
    /* ---- the market */
    eventId: z.string().min(1).max(64),
    eventTitle: z.string().min(1).max(300),
    venueMarketId: z.string().min(1).max(64),
    question: z.string().min(1).max(300),
    outcomeId: z.string().min(1).max(64),
    outcomeLabel: z.string().min(1).max(64),
    /* ---- Risk / Money */
    /** USD the plan may put on the outcome — and, for a prediction, the whole principal at risk. */
    amountUsd: Usd,
    /** The probability (0–1) the thesis was priced at when the plan was written. */
    entryProbability: Probability,
    /** The Review refuses a quote whose average probability is above this; null means reported, never refused. */
    maxProbability: Probability.nullable(),
    /* ---- Conditions */
    /** Where the thesis is wrong: a sentence the person acts on, and an optional probability that names it. */
    invalidation: z.object({ text: z.string().min(1).max(500), probabilityBelow: Probability.nullable() }).strict(),
    /** The moment the market should have resolved by; after it the plan is expired, not executed. */
    resolutionDeadline: Iso.nullable(),
    monitoring: z.array(PredictionMonitorConditionSchema).max(8),
    references: z.array(Url).max(10),
    assumptions: z.array(z.string().min(1).max(240)).max(10),
  })
  .strict();
export type PredictionPlanRules = z.infer<typeof PredictionPlanRulesSchema>;

/** What the rules imply, computed by the server and stored with the version. */
export const PredictionPlanSizingSchema = z
  .object({
    model: z.literal("prediction-long-v1"),
    /** Shares the amount buys at the entry probability (one share pays $1 if right). */
    sharesAtEntry: z.number().finite().min(0),
    /** The whole amount: a prediction that resolves against the thesis pays nothing. */
    maxLossUsd: Usd,
    payoutIfRightUsd: z.number().finite().min(0),
    profitIfRightUsd: z.number().finite(),
    /** The market's implied odds the thesis needs to beat: profit / max loss. */
    returnIfRightPct: z.number().finite(),
    breakEvenProbability: Probability,
  })
  .strict();
export type PredictionPlanSizing = z.infer<typeof PredictionPlanSizingSchema>;

export const PredictionPlanVersionSchema = z
  .object({ version: z.number().int().min(1), createdAt: Iso, reason: Note.nullable(), rules: PredictionPlanRulesSchema, sizing: PredictionPlanSizingSchema })
  .strict();
export type PredictionPlanVersion = z.infer<typeof PredictionPlanVersionSchema>;

export const PredictionPlanJournalSchema = z
  .object({
    at: Iso,
    kind: z.enum(["created", "edited", "activated", "cancelled", "expired", "reviewed", "executed", "note"]),
    version: z.number().int().min(1),
    note: Note.nullable(),
    ref: z.string().max(128).nullable(),
  })
  .strict();
export type PredictionPlanJournalEntry = z.infer<typeof PredictionPlanJournalSchema>;

export const PredictionPlanSchema = z
  .object({
    id: z.string().regex(PREDICTION_PLAN_ID),
    kind: z.literal("prediction"),
    owner: z.string().min(32).max(44),
    status: z.enum(PREDICTION_PLAN_STATUSES),
    createdAt: Iso,
    updatedAt: Iso,
    version: z.number().int().min(1),
    current: PredictionPlanVersionSchema,
    versions: z.array(PredictionPlanVersionSchema.pick({ version: true, createdAt: true, reason: true })).max(PREDICTION_PLAN_VERSIONS_KEPT),
    journal: z.array(PredictionPlanJournalSchema).max(PREDICTION_PLAN_JOURNAL_KEPT),
    /** The paper orders placed under this plan, by quote id. */
    executions: z.array(z.object({ quoteId: z.string(), at: Iso, state: z.string() }).strict()).max(50),
  })
  .strict();
export type PredictionPlan = z.infer<typeof PredictionPlanSchema>;

export const PredictionPlanCreateSchema = z.object({ rules: PredictionPlanRulesSchema, activate: z.boolean().optional() }).strict();
export const PredictionPlanUpdateSchema = z.object({ version: z.number().int().min(1), rules: PredictionPlanRulesSchema, reason: Note.nullable().optional() }).strict();
export const PredictionPlanStatusSchema = z.object({ version: z.number().int().min(1), status: z.enum(["active", "cancelled"]), note: Note.nullable().optional() }).strict();

export type PredictionPlanIssue = Readonly<{ path: string; message: string }>;

/* ------------------------------------------------------------- sizing */

export function computePredictionSizing(rules: Pick<PredictionPlanRules, "amountUsd" | "entryProbability">): PredictionPlanSizing {
  const shares = rules.amountUsd / rules.entryProbability;
  const payout = shares;
  const profit = payout - rules.amountUsd;
  return {
    model: "prediction-long-v1",
    sharesAtEntry: round(shares, 6),
    maxLossUsd: round(rules.amountUsd, 2),
    payoutIfRightUsd: round(payout, 2),
    profitIfRightUsd: round(profit, 2),
    returnIfRightPct: round((profit / rules.amountUsd) * 100, 2),
    breakEvenProbability: round(rules.entryProbability, 4),
  };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Rules that parse and make sense together; every failing field named. */
export function validatePredictionRules(input: unknown, nowMs: number = Date.now()): Readonly<{ ok: true; rules: PredictionPlanRules }> | Readonly<{ ok: false; issues: readonly PredictionPlanIssue[] }> {
  const parsed = PredictionPlanRulesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  const rules = parsed.data;
  const issues: PredictionPlanIssue[] = [];
  if (rules.maxProbability !== null && rules.maxProbability < rules.entryProbability) issues.push({ path: "maxProbability", message: "The bound must be at or above the entry probability, or the plan can never be executed." });
  if (rules.invalidation.probabilityBelow !== null && rules.invalidation.probabilityBelow >= rules.entryProbability) issues.push({ path: "invalidation.probabilityBelow", message: "The invalidation probability must be below the entry probability." });
  if (rules.resolutionDeadline !== null && Date.parse(rules.resolutionDeadline) <= nowMs) issues.push({ path: "resolutionDeadline", message: "The resolution deadline is already past." });
  for (const [index, c] of rules.monitoring.entries()) {
    if ((c.metric === "probability" || c.metric === "volume24h" || c.metric === "resolution") && c.threshold === null) issues.push({ path: `monitoring.${index}.threshold`, message: "This condition needs a threshold." });
    if (c.metric === "probability" && c.threshold !== null && (c.threshold <= 0 || c.threshold >= 1)) issues.push({ path: `monitoring.${index}.threshold`, message: "A probability is between 0 and 1." });
    if (c.metric === "probability" && c.direction === "any") issues.push({ path: `monitoring.${index}.direction`, message: "Say whether the probability crossing above or below the bound matters." });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, rules };
}

