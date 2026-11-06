import type { Holdings } from '../trade/wallet.ts';
import { PARTS_LIVE, type PilotLegs, type PilotNetwork } from '../../../lib/pilot/plan.ts';

/**
 * CITY-204 — whether the wallet holds what the plan moves, before the wallet is asked: the SOL that goes into the trade,
 * the savings and the pier on this network (the reserve stays where it is; the engine's spendable already keeps the
 * network's fees back), and the USDC that goes into the savings. A balance not read is no refusal — the engines refuse
 * again before anything is built. Pure.
 */

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** What a mandate's own account rent and the agent's transactions need beyond its budget, lamports. */
export const SETUP_LAMPORTS = 10_000_000n;

export type Moves = Readonly<{ solRaw: bigint; usdcRaw: bigint }>;

/** What the plan takes from the wallet on this network. */
export function movesOf(legs: PilotLegs, network: PilotNetwork): Moves {
  const live = PARTS_LIVE[network];
  const sol = (live.includes('trade') ? legs.trade.solRaw : 0n) + (live.includes('save') ? legs.save.solRaw : 0n) + (live.includes('pool') ? legs.pool.solRaw : 0n);
  return { solRaw: sol > 0n ? sol + SETUP_LAMPORTS : 0n, usdcRaw: live.includes('save') ? legs.save.usdcRaw : 0n };
}

/** The asset the wallet holds too little of; null — enough, or not read. */
export function walletShort(legs: PilotLegs, network: PilotNetwork, holdings: Holdings | null): 'SOL' | 'USDC' | null {
  if (!holdings) return null;
  const moves = movesOf(legs, network);
  const sol = holdings.sol ? BigInt(holdings.sol.spendableRaw) : null;
  if (moves.solRaw > 0n && sol !== null && sol < moves.solRaw) return 'SOL';
  const usdc = holdings.tokens.get(USDC_MINT);
  const usdcRaw = usdc ? BigInt(usdc.spendableRaw) : holdings.complete ? 0n : null;
  if (moves.usdcRaw > 0n && usdcRaw !== null && usdcRaw < moves.usdcRaw) return 'USDC';
  return null;
}
