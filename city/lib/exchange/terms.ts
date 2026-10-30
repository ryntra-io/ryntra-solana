import { wordsNow } from '../i18n/dict.ts';
import type { OrderReview } from './engine.ts';
import { leverage, price, units, usd } from './format.ts';
import { EX_TERMS } from './words.ts';

/**
 * The one line a person reads before signing an order that trades: the size, the leverage after it, where Phoenix
 * would liquidate the position, and the fee. Every figure is the Review's — Phoenix's view of the account after the
 * order (`after.leverage`, `after.liquidationUsd`, by the engine's Hawkeye read) and the engine's fees; the city
 * computes none of them. The fee is totalled the way the web terminal totals it (`order-panel.tsx`): an order that
 * takes liquidity now pays Phoenix's fee and Ryntra's in USDC; one that rests pays on the fill.
 */

export type ReviewTerms = Readonly<{
  size: string;
  /** Null when the order leaves no position (a whole close) or Phoenix sent no figure. */
  leverage: string | null;
  liquidation: string | null;
  fee: string;
}>;

/** Phoenix's word where it has no liquidation price, in the language on screen. */
function liquidationWord(status: string): string | null {
  const w = wordsNow(EX_TERMS);
  return status === 'already_liquidatable' ? w.liqNow : status === 'no_price_in_bounds' ? w.noneInRange : null;
}

/** The fee in one word: dollars for an order that trades now, «on fill» for one that rests. */
export function feeText(review: Pick<OrderReview, 'kind' | 'type' | 'fees'>): string {
  const fees = review.fees;
  const w = wordsNow(EX_TERMS);
  // A Review built before `venueLiquidity` came is read as the web reads it: a plain limit is decided on the fill.
  const liquidity = fees.venueLiquidity ?? (review.kind === 'open' && review.type === 'limit' ? 'mixed' : 'taker');
  if (liquidity === 'maker') return fees.venueUsd === null ? w.onFill : w.feeOnFill(usd(fees.venueUsd));
  if (liquidity === 'mixed' || (fees.venueUsd === null && fees.builderUsd === null)) return w.onFill;
  return usd((fees.venueUsd ?? 0) + (fees.builderUsd ?? 0));
}

/** The terms of an open, a cut or a close; null for an action that trades nothing (TP/SL, a cancel). */
export function reviewTerms(review: OrderReview): ReviewTerms | null {
  if (review.kind !== 'open' && review.kind !== 'reduce') return null;
  const after = review.after;
  const flat = !after || !(Math.abs(Number(after.positionUnits)) > 0);
  const liquidation = flat
    ? null
    : after.liquidationUsd !== null
      ? price(after.liquidationUsd)
      : liquidationWord(after.liquidationStatus);
  const lev = flat || after.leverage === null ? null : leverage(after.leverage);
  return { size: units(Number(review.sizeUnits), review.symbol), leverage: lev === '—' ? null : lev, liquidation, fee: feeText(review) };
}

/** The terms as the line under the Review's title: «0.2 SOL · 5× · Liq. $120.10 · Fee $0.12». */
export function termsLine(terms: ReviewTerms): string {
  const w = wordsNow(EX_TERMS);
  return [terms.size, terms.leverage, terms.liquidation === null ? null : w.liq(terms.liquidation), w.fee(terms.fee)].filter(Boolean).join(' · ');
}
