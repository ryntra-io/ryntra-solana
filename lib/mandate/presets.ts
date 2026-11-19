/**
 * The three budgets the city's window once offered (one tap picked the day, the trade cap and the length
 * followed). A budget is the person's own numbers (`./budget.ts`) and nothing here is
 * offered or checked; the presets stay only to read the agent's book written before: an entry of then names its preset,
 * and what it moved into the vault and gave the agent for its fees are the preset's.
 */

export const BUDGET_PRESET_IDS = ["small", "medium", "large"] as const;
export type BudgetPresetId = (typeof BUDGET_PRESET_IDS)[number];

export type BudgetPreset = Readonly<{
  id: BudgetPresetId;
  /** SOL moved into the agent's vault, lamports — the day's cap too. */
  budget: bigint;
  perDay: bigint;
  perTrade: bigint;
  days: number;
  /** SOL for the agent's network fees, lamports. */
  agentFee: bigint;
}>;

const SOL = 1_000_000_000n;

export const BUDGET_PRESETS: Readonly<Record<BudgetPresetId, BudgetPreset>> = Object.freeze({
  small: { id: "small", budget: SOL / 10n, perDay: SOL / 10n, perTrade: SOL / 50n, days: 30, agentFee: SOL / 100n },
  medium: { id: "medium", budget: SOL / 4n, perDay: SOL / 4n, perTrade: SOL / 20n, days: 30, agentFee: SOL / 100n },
  large: { id: "large", budget: SOL / 2n, perDay: SOL / 2n, perTrade: SOL / 10n, days: 30, agentFee: SOL / 100n },
});

export const isBudgetPreset = (value: unknown): value is BudgetPresetId => typeof value === "string" && (BUDGET_PRESET_IDS as readonly string[]).includes(value);
