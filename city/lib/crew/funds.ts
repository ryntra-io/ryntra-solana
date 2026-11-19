import { budgetTotal, OPENING_LAMPORTS, type AgentBudget } from '../../../lib/mandate/budget.ts';

/**
 * Enough SOL for the agent's budget: the signature moves the budget into the person's own vault and the SOL
 * for the agent's network fees to the agent (`lib/mandate/human.ts`), and opens a few accounts besides. A wallet with
 * less than the budget and the agent's fees cannot sign it at all — the card offers «Add SOL» there instead of a «Sign»
 * the wallet would refuse. Above that floor the card never stands in the way: the wallet itself is the last word.
 * The budget is the person's own numbers (`lib/mandate/budget.ts`), any of them.
 * Pure — the cards and the tests read it as it is.
 */

export { OPENING_LAMPORTS };

export type Funds = Readonly<{ floor: bigint; about: bigint }>;

/** The least a wallet must hold to sign this budget — with the accounts the signature opens — and the «about» the card says. */
export function fundsFor(budget: AgentBudget): Funds {
  const floor = budgetTotal(budget) + OPENING_LAMPORTS;
  return { floor, about: floor };
}

/** Whether the wallet's spendable SOL is certainly short of the budget; unknown balances are never short. */
export function shortOfFunds(spendableRaw: string | null | undefined, budget: AgentBudget | null): boolean {
  if (!budget || typeof spendableRaw !== 'string' || !/^\d{1,20}$/u.test(spendableRaw)) return false;
  return BigInt(spendableRaw) < fundsFor(budget).floor;
}

/** Lamports as the card writes SOL: two decimals, rounded up — «about 0.12». */
export function solAbout(lamports: bigint): string {
  const hundredths = (lamports + 9_999_999n) / 10_000_000n;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
}
