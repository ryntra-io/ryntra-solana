import type { ChartMark } from '@ryntra/core/adapters';
import type { TokenMark, TokenTrade } from '../../../lib/spot/token-page.ts';

/**
 * The marks on a coin's candles beyond the market's largest trades: the person's own buys and sales (their wallet's
 * trades among those the tape read), the creator's trades, and the moment the coin left its launch curve for a DEX. The
 * engine finds the creator and the moment (`marksOf`, `/api/spot/token?part=overview`; the tape's own `creator` mark);
 * the screen only names them. Reading only: a mark never becomes an order.
 *
 * On a phone the marks carry no price: the chart stands them along the foot of the plot, under the candles, never over
 * them. On a desk a trade's mark points at its price.
 *
 * Pure.
 */

export type CoinMarkWords = Readonly<{
  youBought: (usd: string) => string;
  youSold: (usd: string) => string;
  creatorBought: (usd: string) => string;
  creatorSold: (usd: string) => string;
  listed: string;
}>;

/** The person's own trades marked at most, the newest. */
export const OWN_MOST = 30;
/** The creator's trades marked at most, the newest. */
export const CREATOR_MOST = 20;

/** A price as the chart's mark takes it: a plain decimal, six significant digits, no exponent; none for a price unknown. */
function plain(price: number | null): string | null {
  if (price === null || !(price > 0) || !Number.isFinite(price)) return null;
  return price.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 6 });
}

/** A trade's mark id — the same the market's largest trades carry, so one trade is one mark. */
export const tradeMarkId = (trade: Pick<TokenTrade, 'signature' | 'side'>): string => `trade:${trade.signature}:${trade.side}`;

/**
 * The person's own trades, the creator's trades and the coin's move to a DEX, oldest first. `owner` — the wallet on
 * the page, or none; `engine` — the engine's marks of the coin (the creator's trades past the tape, the DEX moment).
 */
export function coinMarks(
  input: Readonly<{
    trades: readonly TokenTrade[];
    owner: string | null;
    engine: readonly TokenMark[];
    phone: boolean;
    words: CoinMarkWords;
    usd: (value: number) => string;
  }>,
): ChartMark[] {
  const { words, usd } = input;
  const out: ChartMark[] = [];
  const marked = new Set<string>();
  const timed = (trade: TokenTrade) => Date.parse(trade.at);
  const newestFirst = [...input.trades].filter((trade) => Number.isFinite(timed(trade))).sort((a, b) => timed(b) - timed(a));
  const price = (trade: TokenTrade) => (input.phone ? null : plain(trade.priceUsd));
  const sum = (trade: TokenTrade) => (trade.usd !== null && Number.isFinite(trade.usd) && trade.usd > 0 ? usd(trade.usd) : '');
  const mark = (trade: TokenTrade, own: boolean, label: string) => {
    const id = tradeMarkId(trade);
    if (marked.has(id)) return;
    marked.add(id);
    out.push({ id, kind: 'trade', t: timed(trade), price: price(trade), side: trade.side, label, own });
  };

  if (input.owner) {
    const mine = newestFirst.filter((trade) => trade.wallet === input.owner).slice(0, OWN_MOST);
    for (const trade of mine) mark(trade, true, trade.side === 'buy' ? words.youBought(sum(trade)).trim() : words.youSold(sum(trade)).trim());
  }

  /* The creator's trades the tape holds, at their prices; the engine's past the tape, on their time alone. */
  const creatorSeconds = new Set<number>();
  const creators = newestFirst.filter((trade) => trade.labels?.includes('creator') && trade.wallet !== input.owner).slice(0, CREATOR_MOST);
  for (const trade of creators) {
    creatorSeconds.add(Math.floor(timed(trade) / 1000));
    mark(trade, false, trade.side === 'buy' ? words.creatorBought(sum(trade)).trim() : words.creatorSold(sum(trade)).trim());
  }
  let more = CREATOR_MOST - creators.length;
  const engine = [...input.engine].filter((one) => Number.isFinite(one.t) && one.t > 0).sort((a, b) => b.t - a.t);
  for (const one of engine) {
    if (one.kind !== 'creator-buy' && one.kind !== 'creator-sell') continue;
    if (more <= 0 || creatorSeconds.has(one.t)) continue;
    more -= 1;
    const dollars = one.usd !== null && Number.isFinite(one.usd) && one.usd > 0 ? usd(one.usd) : '';
    out.push({ id: `creator:${one.kind}:${one.t}`, kind: 'trade', t: one.t * 1000, price: null, side: one.kind === 'creator-buy' ? 'buy' : 'sell', label: (one.kind === 'creator-buy' ? words.creatorBought(dollars) : words.creatorSold(dollars)).trim(), own: false });
  }

  const dex = engine.find((one) => one.kind === 'dex');
  if (dex) out.push({ id: `dex:${dex.t}`, kind: 'event', t: dex.t * 1000, price: null, side: null, label: words.listed, own: false });

  return out.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}

/** Two lists of marks as one: the first list's marks stand, the second adds only marks of other ids; oldest first. */
export function mergeMarks(first: readonly ChartMark[], then: readonly ChartMark[]): ChartMark[] {
  const ids = new Set(first.map((one) => one.id));
  return [...first, ...then.filter((one) => !ids.has(one.id))].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}

/** The same marks keep the same list: a chart is not handed its marks again for nothing. */
export function sameMarks(a: readonly ChartMark[], b: readonly ChartMark[]): boolean {
  return a.length === b.length && a.every((one, i) => one.id === b[i]!.id && one.label === b[i]!.label && one.price === b[i]!.price);
}
