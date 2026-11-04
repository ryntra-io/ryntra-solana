/**
 * CITY-174 — the budgets the city's window offers: one tap picks the day's budget, and the trade cap and the length
 * follow from it, inside the starter caps a new agent holds (`./terms.ts`). Pure — the window and the server share it.
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

export const budgetPreset = (id: BudgetPresetId): BudgetPreset => BUDGET_PRESETS[id];

export const isBudgetPreset = (value: unknown): value is BudgetPresetId => typeof value === "string" && (BUDGET_PRESET_IDS as readonly string[]).includes(value);

/**
 * The budgets each network offers. Mainnet opened to everyone of 4.11.2026 with one budget only —
 * 0.1 SOL a day (`small`) — while Squads' policy layer waits on its audit.
 */
export const PRESETS_ON: Readonly<Record<"devnet" | "mainnet", readonly BudgetPresetId[]>> = Object.freeze({ devnet: BUDGET_PRESET_IDS, mainnet: ["small"] });

export const presetOpenOn = (network: "devnet" | "mainnet", id: BudgetPresetId): boolean => PRESETS_ON[network].includes(id);
