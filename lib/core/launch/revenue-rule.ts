/**
 * What Ryntra takes from a launch, by source, and how much of it is revenue — one rule for Ryntra's financial panel
 * (SOL-F1) and for the DefiLlama adapter of Ryntra Launch (`docs/analytics/defillama/fork/fees/ryntra-launch.ts`,
 * held to this rule by `revenue-rule.test.mjs`). It is the rule of the SOL-L0 audit, §4
 * (`audit/2026-10/solana-launch/README.md`):
 *
 * - **Classic, Protected, «Спільнота»** — the partner's vault takes Ryntra's part: the partner's part of every curve fee
 *   (48 % of the fee), its part of the migration fee (60 %), the fees of its locked DAMM v2 position (20 % of the pool's
 *   fee) — all of it revenue;
 * - **Micro and the demo market** — Ryntra's executor holds the partner's role, and its money is the market's budget
 *   first: the migration fee and the surplus whole, a quarter (`BUDGET_RULE.feeShareBps`) of the partner's curve fees and
 *   of its locked position's fees. Three quarters of those two are revenue — on the curve 36 % of every fee;
 * - **the referral** — Meteora pays Ryntra's referral account out of its own protocol part on every trade sent through
 *   Ryntra, on any preset: revenue, never the market's;
 * - **the surplus** — the pair currency left above the graduation threshold, not a fee a trader pays: on the budget
 *   presets the market's, on the others Ryntra's. DefiLlama does not count it as a fee.
 *
 * Pure and client-safe.
 */

import { BUDGET_RULE, splitClaim } from "./budget.ts";
import { presetTerms } from "./preset-terms.ts";
import { LAUNCH_PRESET_IDS, type LaunchPresetId } from "../venues/meteora-dbc/presets.ts";

export const INCOME_SOURCES = ["curve", "referral", "graduation", "surplus", "lp"] as const;
export type IncomeSource = (typeof INCOME_SOURCES)[number];

export type IncomeSplit = Readonly<{
  revenueRaw: bigint;
  /** The market's budget — the ladder's money on Micro and the demo market; never Ryntra's revenue. */
  budgetRaw: bigint;
  /** A fee a trader or the curve pays — counted as fees on DefiLlama; the surplus is not one. */
  fee: boolean;
}>;

/** Whether Ryntra's part on this preset is the market's budget first (the executor's presets). */
export function budgetPreset(preset: string): boolean {
  return presetTerms(preset)?.budget != null;
}

/** One amount of Ryntra's income from a launch, split into revenue and the market's budget. */
export function incomeSplit(preset: string, source: IncomeSource, raw: bigint): IncomeSplit {
  const fee = source !== "surplus";
  if (raw <= 0n) return { revenueRaw: 0n, budgetRaw: 0n, fee };
  if (source === "referral" || !budgetPreset(preset)) return { revenueRaw: raw, budgetRaw: 0n, fee };
  const split = splitClaim(source === "graduation" ? "migration" : source, raw);
  return { revenueRaw: split.revenueRaw, budgetRaw: split.budgetRaw, fee };
}

/** The rule as shares — basis points of each source, by preset — for the panel's methodology and the adapter's test. */
export type IncomeRuleRow = Readonly<{ preset: LaunchPresetId; source: IncomeSource; revenueBps: number; budgetBps: number; fee: boolean }>;

export function incomeRule(): readonly IncomeRuleRow[] {
  const rows: IncomeRuleRow[] = [];
  for (const preset of LAUNCH_PRESET_IDS) {
    for (const source of INCOME_SOURCES) {
      const split = incomeSplit(preset, source, 10_000n);
      rows.push({ preset, source, revenueBps: Number(split.revenueRaw), budgetBps: Number(split.budgetRaw), fee: split.fee });
    }
  }
  return rows;
}

/** The market's share of the partner's curve and position fees on the budget presets, percent — what the adapter writes. */
export const MARKET_BUDGET_SHARE_PERCENT = BUDGET_RULE.feeShareBps / 100;
