import type { LiquidityReview } from '../../../../lib/liquidity/studio/actions.ts';
import { formatUnits } from '../../trade/format.ts';
import { digits, wordsNow } from '../../i18n/dict.ts';
import type { HarborPool } from './pools.ts';
import { HARBOR_FAILURES, HARBOR_FIGURES, HARBOR_NOTICES } from './words.ts';

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

/** The notice that matters most comes first. */
const NOTICE_ORDER = ['out_of_range', 'one_sided', 'locked_part_stays', 'partial_deposit', 'transfer_fee', 'rewards_separate'] as const;

type Amount = Readonly<{ units: string; decimals: number; asset?: string }>;

const LAMPORTS = 9;

function side(amount: Amount, symbol: string): string | null {
  return /^\d+$/.test(amount.units) && amount.units !== '0' ? `${digits(formatUnits(amount.units, amount.decimals, 'down'))} ${symbol}` : null;
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
    if (fx || fy) amounts.push(wordsNow(HARBOR_FIGURES).fees([fx, fy].filter(Boolean).join(' + ')));
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
    rentSol: paid > 0n ? digits(formatUnits(paid.toString(), LAMPORTS)) : null,
    rentBack: paid > 0n && back === paid,
    rentReturnedSol: returned > 0n ? digits(formatUnits(returned.toString(), LAMPORTS)) : null,
    networkSol: /^\d+$/.test(review.networkFeeLamports) ? digits(formatUnits(review.networkFeeLamports, LAMPORTS)) : '—',
    transactions: review.transactions.length,
    note: note ? wordsNow(HARBOR_NOTICES)[note] : null,
  };
}

/** The engine's refusal codes as a line a person reads; anything else, plainly. */
const FAILURE_CODES = new Set<string>(Object.keys(HARBOR_FAILURES.en).filter((code) => code === code.toUpperCase()));

export function failureWords(code: string): string {
  const w = wordsNow(HARBOR_FAILURES);
  return FAILURE_CODES.has(code) ? (w as Readonly<Record<string, string>>)[code] : w.fallback;
}
