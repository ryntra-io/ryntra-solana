import type { PlanRules } from "../api/v1/contract.ts";
import { MAX_PRICE_OVER_ENTRY } from "./builder-defaults.ts";

/**
 * The purchase with a loss limit — the one strategy of «Простий»: the person
 * chooses the asset, the amount and one of the published presets; these rules
 * — the same for everyone, never the model's — turn that choice into the plan
 * the Review checks before the signature and Monitoring watches after it.
 *
 * - The presets: «Обережно» −5 % / +10 %, «Збалансовано» −10 % / +20 %.
 *   «Своє» is the full plan builder.
 * - The entry is the planning price the plan's own asset read gives, in the
 *   plan's unit (a share, or a token for a pre-IPO instrument); the Review
 *   refuses above two per cent over it (the builder's protective default).
 * - The budget is the amount plus the builder's reserve for costs, so the
 *   Review's spendable part is exactly the amount the person chose.
 * - The planned risk is the most the Review lets the modelled loss be: the
 *   distance to the loss limit, the costs and slippage both ways, and the
 *   room a price still inside the two-per-cent bound adds — so the purchase
 *   the person chose is never refused for the price moving within its own
 *   bound, and the figure the card shows is that ceiling, not a guess.
 * - The entry is valid for two hours: a purchase decided now, not an order
 *   left waiting. Once bought, the plan is watched as a position for its
 *   loss limit (`lib/monitoring/position.ts`).
 *
 * Pure. Figures in USD per unit; rounding the way the builder writes them.
 */

export const LOSS_LIMIT_PRESETS = {
  careful: { stopPct: 5, targetPct: 10 },
  balanced: { stopPct: 10, targetPct: 20 },
} as const;
export type LossLimitPreset = keyof typeof LOSS_LIMIT_PRESETS;

/** Modelled cost and slippage on the way in and out, basis points of the entry — the agent's and the builder's figure. */
export const PURCHASE_COST_BUFFER_BPS = 100;
/** How long the entry of a purchase decided on the card stays valid. */
export const PURCHASE_VALID_MS = 2 * 60 * 60 * 1000;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const ceil2 = (value: number): number => Math.ceil(value * 100 - 1e-9) / 100;

/** A per-unit price the way the builder writes one: two decimals above a cent, six significant digits below. */
export function roundUnit(value: number): number {
  if (value >= 0.01) return round2(value);
  return Number(value.toPrecision(6));
}

/** The builder's reserve for costs: one per cent of the budget, never under ten cents. */
export const reserveFor = (budget: number): number => Math.max(0.1, Math.round(budget) / 100);

export type LossLimitPurchase = Readonly<{
  rules: PlanRules;
  preset: LossLimitPreset;
  stopPct: number;
  targetPct: number;
  /** The loss limit per unit: where Ryntra warns. */
  limitPerUnit: number;
  /** Where the plan would sell if the price gets there — a rule of the plan, never an order. */
  targetPerUnit: number;
  /** The most the Review lets the modelled loss be, USD — what the card calls «можеш втратити». */
  canLoseUsd: number;
}>;

export type LossLimitPurchaseInput = Readonly<{
  amountUsd: number;
  /** The planning price per unit the plan's asset read gave. */
  pricePerUnit: number;
  preset: LossLimitPreset;
  /** Whether the asset has an exchange reference; with one, the Review also bounds the deviation from it. */
  hasReference: boolean;
  /** The words of the plan's thesis, in the person's language. */
  thesis: string;
  nowMs: number;
}>;

export function lossLimitPurchase(input: LossLimitPurchaseInput): LossLimitPurchase | null {
  const { amountUsd, pricePerUnit, preset } = input;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(pricePerUnit) || pricePerUnit <= 0) return null;
  const { stopPct, targetPct } = LOSS_LIMIT_PRESETS[preset];
  const entry = roundUnit(pricePerUnit);
  const maxPrice = roundUnit(entry * MAX_PRICE_OVER_ENTRY);
  const limit = roundUnit(entry * (1 - stopPct / 100));
  const target = roundUnit(entry * (1 + targetPct / 100));
  const buffer = PURCHASE_COST_BUFFER_BPS / 10_000;
  /* The modelled loss of the amount bought at the highest price the Review lets through: (1 − limit / price + buffer) of it. */
  const ceilingShare = 1 - limit / maxPrice + buffer;
  const canLose = Math.max(0.01, ceil2(amountUsd * ceilingShare));
  const amount = round2(amountUsd);
  const reserve = round2(reserveFor(amount));
  const rules: PlanRules = {
    thesis: { text: input.thesis.slice(0, 280), whyNow: null, horizon: null, sources: [], assumptions: [] },
    entry: { pricePerShare: entry, maxPricePerShare: maxPrice, validUntil: new Date(input.nowMs + PURCHASE_VALID_MS).toISOString() },
    capital: { budgetUsd: round2(amount + reserve), reserveForCostsUsd: reserve },
    risk: { invalidationPerShare: limit, plannedRiskUsd: canLose, costBufferBps: PURCHASE_COST_BUFFER_BPS },
    exit: { targetPerShare: target, timeExitAt: null, invalidationIsOrder: false },
    execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: input.hasReference ? 1.5 : null, referenceRequired: false, minLiquidityUsd: null },
    evidenceConditions: [],
  };
  return { rules, preset, stopPct, targetPct, limitPerUnit: limit, targetPerUnit: target, canLoseUsd: canLose };
}
