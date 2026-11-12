import { budgetPreset, type BudgetPresetId } from '../../../lib/mandate/presets.ts';

/**
 * Enough SOL for the agent's budget (CITY-222): the signature moves the budget into the person's own vault and the SOL
 * for the agent's network fees to the agent (`lib/mandate/human.ts`), and opens a few accounts besides. A wallet with
 * less than the budget and the agent's fees cannot sign it at all — the card offers «Add SOL» there instead of a «Sign»
 * the wallet would refuse. Above that floor the card never stands in the way: the wallet itself is the last word.
 * Pure — the cards and the tests read it as it is.
 */

/** SOL the accounts and the network's fees take, shown with the floor as «about»: 0.01 SOL. */
export const OPENING_LAMPORTS = 10_000_000n;

export type Funds = Readonly<{ floor: bigint; about: bigint }>;

/** The least a wallet must hold to sign this budget, and the «about» the card says. */
export function fundsFor(preset: BudgetPresetId): Funds {
  const p = budgetPreset(preset);
  const floor = p.budget + p.agentFee;
  return { floor, about: floor + OPENING_LAMPORTS };
}

/** Whether the wallet's spendable SOL is certainly short of the budget; unknown balances are never short. */
export function shortOfFunds(spendableRaw: string | null | undefined, preset: BudgetPresetId | null): boolean {
  if (!preset || typeof spendableRaw !== 'string' || !/^\d{1,20}$/u.test(spendableRaw)) return false;
  return BigInt(spendableRaw) < fundsFor(preset).floor;
}

/** Lamports as the card writes SOL: two decimals, rounded up — «about 0.12». */
export function solAbout(lamports: bigint): string {
  const hundredths = (lamports + 9_999_999n) / 10_000_000n;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
}
