import type { AmountProblem } from './amount.ts';

/**
 * A connected wallet with nothing to buy with (CITY-237, CITY-239): the ticket's one action is the way to get some —
 * Money's top-up — on the market ticket, a limit and a stop alike, where a dead «Not enough SOL» or a dead «Review
 * order» stood. Selling spends the coin itself, and an empty Sell has its own line. With Money shut on this deployment
 * there is nowhere to send the person: the ticket says what it said before.
 *
 * `max` is the ticket's own figure of what may be spent (`Sizing.max`): `'0'` is a read balance of nothing, `null` a
 * balance not read yet — unknown is never empty.
 */
export function offersTopUp(input: Readonly<{ connected: boolean; side: 'buy' | 'sell'; max: string | null; moneyOpen: boolean }>): boolean {
  return input.connected && input.side === 'buy' && input.max === '0' && input.moneyOpen;
}

/**
 * The line beside the action. While the action is «Add SOL», the balance's own sentence — «Up to 0 SOL: the rest pays
 * the network.», «You have 0 USDC. Type that or less.» — is the same news a second time, worded as the person's
 * mistake: the button already is the answer, so the line is not said. Any other fault of the typed amount stays.
 */
export function problemLine(problem: AmountProblem | null | undefined, topUp: boolean): string | null {
  if (!problem) return null;
  return topUp && problem.kind === 'balance' ? null : problem.text;
}
