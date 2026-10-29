import type { LiquidityReview } from '../../../../lib/liquidity/studio/actions.ts';
import { formatUnits } from '../../trade/format.ts';
import type { HarborPool } from './pools.ts';

/**
 * What the engine's Review says, in the card's words: what goes in or comes out, the SOL a new account costs and
 * whether it comes back, the network's fee, and the one fact to read before signing. Every figure is the Review's own.
 */

export type ReviewFigures = Readonly<{
  /** Add: what goes in at most; claim: the fees; exit: what comes back. Each side "12.4 USDC", zero sides left out. */
  amounts: readonly string[];
  /** The value at the venue's prices; null when a side is not priced. */
  valueUsd: number | null;
  /** SOL paid for new accounts, and how much of it comes back on exit. */
  rentSol: string | null;
  rentBack: boolean;
  /** SOL returned by closing accounts (an exit). */
  rentReturnedSol: string | null;
  networkSol: string;
  /** Wallet prompts: DLMM splits a wide range over several transactions. */
  transactions: number;
  /** The one notice to read before signing, worded. */
  note: string | null;
}>;

const NOTICE_WORDS: Readonly<Record<string, string>> = {
  out_of_range: 'The price is outside this range now: it earns nothing until it comes back.',
  one_sided: 'This range takes one coin only and earns nothing until the price comes in.',
  partial_deposit: 'The pool takes the two coins in its own ratio: the rest stays in your wallet.',
  transfer_fee: 'A coin here takes its own fee on transfer: a little less arrives.',
  locked_part_stays: 'Part of this position is locked and stays in the pool.',
  rewards_separate: 'This pool also pays farm rewards; they are claimed separately.',
};
/** The notice that matters most comes first. */
const NOTICE_ORDER = ['out_of_range', 'one_sided', 'locked_part_stays', 'partial_deposit', 'transfer_fee', 'rewards_separate'];

type Amount = Readonly<{ units: string; decimals: number; asset?: string }>;

const LAMPORTS = 9;

function side(amount: Amount, symbol: string): string | null {
  return /^\d+$/.test(amount.units) && amount.units !== '0' ? `${formatUnits(amount.units, amount.decimals, 'down')} ${symbol}` : null;
}

function valueOf(pair: Readonly<{ x: Amount; y: Amount }>, pool: HarborPool | null): number | null {
  if (!pool) return null;
  let total = 0;
  for (const [amount, token] of [
    [pair.x, pool.x],
    [pair.y, pool.y],
  ] as const) {
    if (amount.units === '0') continue;
    if (token.priceUsd === null) return null;
    total += (Number(amount.units) / 10 ** amount.decimals) * token.priceUsd;
  }
  return total;
}

export function reviewFigures(review: LiquidityReview, symbols: Readonly<{ x: string; y: string }>, pool: HarborPool | null): ReviewFigures {
  const preview = review.preview;
  const pair = preview.action === 'add' ? preview.deposit : preview.action === 'claim' ? preview.claimed : preview.expected;
  const amounts = [side(pair.x, symbols.x), side(pair.y, symbols.y)].filter((text): text is string => text !== null);
  if (preview.action === 'remove' && preview.closesPosition) {
    const fx = side(preview.feesClaimed.x, symbols.x);
    const fy = side(preview.feesClaimed.y, symbols.y);
    if (fx || fy) amounts.push(`fees ${[fx, fy].filter(Boolean).join(' + ')}`);
  }
  let paid = 0n;
  let back = 0n;
  let returned = 0n;
  for (const rent of preview.rent) {
    if (!/^\d+$/.test(rent.lamports)) continue;
    if (rent.direction === 'pay') {
      paid += BigInt(rent.lamports);
      if (rent.refundable) back += BigInt(rent.lamports);
    } else returned += BigInt(rent.lamports);
  }
  const note = NOTICE_ORDER.find((code) => preview.notices.includes(code as never));
  return {
    amounts,
    valueUsd: valueOf(pair, pool),
    rentSol: paid > 0n ? formatUnits(paid.toString(), LAMPORTS) : null,
    rentBack: paid > 0n && back === paid,
    rentReturnedSol: returned > 0n ? formatUnits(returned.toString(), LAMPORTS) : null,
    networkSol: /^\d+$/.test(review.networkFeeLamports) ? formatUnits(review.networkFeeLamports, LAMPORTS) : '—',
    transactions: review.transactions.length,
    note: note ? NOTICE_WORDS[note]! : null,
  };
}

/** The engine's refusal codes as a line a person reads; anything else, plainly. */
const FAILURE_WORDS: Readonly<Record<string, string>> = {
  ACTIONS_CLOSED: 'Adding to pools opens after a live check. Nothing was built.',
  CANARY_LIMIT: 'This amount is above what the live check allows. Pick a smaller one.',
  CANARY_UNPRICED: 'This pool has no dollar price now, so the check cannot hold it to its limit.',
  ACTIONS_UNAVAILABLE: 'Pool actions are not available right now. Nothing was built.',
  UNAVAILABLE: 'Solana did not answer. Nothing was built or sent.',
  SIMULATION_FAILED: 'The network would refuse this now — often not enough SOL for the new accounts.',
  RANGE_INVALID: 'The pool would not take this range now. Try again.',
  POOL_NOT_FOUND: 'This pool was not found on the chain.',
  POSITION_NOT_FOUND: 'This position is no longer on the chain.',
  NOT_OWNER: 'This wallet does not own the position.',
  PREVIEW_EXPIRED: 'The price moved since the figures. Try again for fresh ones.',
  WALLET_MISMATCH: 'This session is signed in with another wallet.',
  WALLET_REFUSED: 'The wallet did not sign. Nothing was sent.',
  RATE_LIMITED: 'Too many tries in a minute. Wait a moment.',
  TIMEOUT: 'The server did not answer in time. Nothing was sent.',
  NETWORK: 'The request did not complete. Nothing was sent.',
};

export function failureWords(code: string): string {
  return FAILURE_WORDS[code] ?? 'That did not work. Nothing was sent.';
}
