/**
 * What others see when a stock is bought from the private balance, and when a stock pool's income goes back into it —
 * the band «what others see» before the signature (`terminal/ui/PrivacyBand.tsx`) and its one line.
 *
 * The band's four cells are the existing ones (`../exposure.ts`): a buy crosses the ring's edge and trades in the
 * open — `routeSwap`, all four seen; income goes into the ring — `hide`, all four seen. What a stock adds is said in
 * the one line under the band, and step by step here, never more than the chain shows:
 *
 * Buy:
 * 1. Out of the ring — the ring's vault pays the person's own wallet in the open: to whom, the coin and the sum are
 *    seen. This is the line «the amount is seen on the way out».
 * 2. The route — an ordinary swap from that wallet into the stock: the coins and the amounts of the trade are seen.
 * 3. The stock lands on the person's wallet and stays there — the ring does not take a stock token yet — so the stock
 *    and how much of it the wallet holds are seen, as any wallet's are.
 * Hidden: the rest of the private balance — how much more there is, and what it does later inside the ring.
 *
 * Income:
 * 1. The claim — the pool, the position and its fees are public, as they always are on Meteora.
 * 2. Back into the ring — the wallet pays the ring's vault in the open: who, the coin and the sum are seen.
 * Hidden: what the private balance holds after, and where that income goes next inside the ring. The stock's side of
 * the fees stays on the wallet.
 *
 * Checked: the ring's edge both ways on devnet (`docs/research/ryntra-private-2026-11-18/PROBE.md`); the buy and the
 * income as a whole — locally only, until the stock pass runs on devnet (`scripts/privacy/stock-devnet.mjs`).
 * Nothing here says «anonymous».
 */

import type { BandAction, BandPart, Checked } from '../exposure.ts';

export type StockFlow = 'buy' | 'income';

/** The band each flow stands under — the existing actions, so the band is the kit's one band. */
export const STOCK_BAND: Readonly<Record<StockFlow, BandAction>> = { buy: 'routeSwap', income: 'hide' };

export type StepName = 'out' | 'route' | 'lands' | 'claim' | 'in';

export type StockStep = Readonly<{
  step: StepName;
  /** What everyone sees on this step. */
  seen: readonly BandPart[];
}>;

export type StockSeen = Readonly<{
  flow: StockFlow;
  steps: readonly StockStep[];
  /** What stays hidden from everyone, across all the steps. */
  hidden: readonly ('rest' | 'later')[];
  checked: Exclude<Checked, 'chain'>;
}>;

const SEEN: Readonly<Record<StockFlow, StockSeen>> = {
  buy: {
    flow: 'buy',
    steps: [
      { step: 'out', seen: ['to', 'what', 'amount'] },
      { step: 'route', seen: ['who', 'what', 'amount'] },
      { step: 'lands', seen: ['to', 'what', 'amount'] },
    ],
    hidden: ['rest', 'later'],
    checked: 'local',
  },
  income: {
    flow: 'income',
    steps: [
      { step: 'claim', seen: ['who', 'what', 'amount'] },
      { step: 'in', seen: ['who', 'what', 'amount'] },
    ],
    hidden: ['rest', 'later'],
    checked: 'local',
  },
};

export function stockSeen(flow: StockFlow): StockSeen {
  return SEEN[flow];
}

/** The sum is seen on the way out of the ring, and the stock lands where everyone sees it: the line the band carries. */
export function amountSeenOnExit(flow: StockFlow): boolean {
  return SEEN[flow].steps.some((s) => (s.step === 'out' || s.step === 'in') && s.seen.includes('amount'));
}
