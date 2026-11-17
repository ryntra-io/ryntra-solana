import type { LadderAction, Market, Order, Quote } from '../../../city/lib/trade/pro-ladder.ts';
import { inChart, type LayerLine } from '../chart-layer.ts';

/**
 * The ticket's Limit tab, read for the screen: one price or a ladder, the distance from the price as a per cent, the
 * ladder's lines over the chart and the person's orders as rows. Every figure is the engine's — its market, its quote,
 * its orders (`city/lib/trade/pro-store.ts`); here they are only put the way the screen says them.
 *
 * Pure: no store, no wallet, no network.
 */

/** One price, or a ladder of several. */
export type Shape = 'one' | 'ladder';

/** How many prices a ladder starts with, and the fewest a ladder has — one is «One price». */
export const LADDER_START_RUNGS = 8;
export const LADDER_MIN_RUNGS = 2;

/**
 * Where the distance starts on the ticket: near enough that the ladder stands inside the chart the person looks at —
 * 5 % under the price, 20 % over it. A sentence's own distance is kept.
 */
export const TICKET_START_BPS: Readonly<Record<LadderAction, number>> = { buy: 500, sell: 2_000 };

export const shapeOf = (rungs: number | null): Shape => (rungs === 1 ? 'one' : 'ladder');

const trim = (value: number) => String(Math.round(value * 100) / 100);

/** The distance as the field writes it: a plain number of per cent, at most two decimals. */
export function percentField(bps: number): string {
  return trim(bps / 100);
}

/** The distance as the screen says it beside its field: below the price for a buy, above it for a sale. */
export function signedPercent(bps: number, action: LadderAction): string {
  return `${action === 'buy' ? '−' : '+'}${trim(bps / 100)}%`;
}

/** A typed per cent as basis points; a comma or a point for decimals, a sign is ignored. Null — not a distance. */
export function bpsOfPercent(text: string): number | null {
  const match = /^[-−+]?\s*(\d+)(?:[.,](\d{0,2}))?\s*%?$/u.exec(text.trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps > 0 ? bps : null;
}

/** The coin's price, in the quote coin, at a distance from the price now: what the farthest price is before a quote says it. */
export function priceAt(market: Pick<Market, 'price'>, bps: number, action: LadderAction): number {
  return market.price * (action === 'buy' ? 1 - bps / 10_000 : 1 + bps / 10_000);
}

/** The farthest price of a quote, in the quote coin. */
export function farPrice(quote: Pick<Quote, 'rungs'>): number | null {
  return quote.rungs[quote.rungs.length - 1]?.price ?? null;
}

/**
 * A quote's ladder as lines over the chart: each price in the chart's dollars, against the coin's price on both sides
 * now. The nearest and the farthest carry their tag; one price carries its own.
 */
export function ladderLines(quote: Pick<Quote, 'rungs' | 'market'>, coinUsd: number | null, tag: (usd: number) => string): readonly LayerLine[] {
  const last = quote.rungs.length - 1;
  const lines: LayerLine[] = [];
  quote.rungs.forEach((rung, at) => {
    const usd = inChart(rung.price, quote.market.price, coinUsd);
    if (usd === null) return;
    lines.push({ id: `ladder:${at}`, price: usd, tone: 'draft', tag: at === 0 || at === last ? tag(usd) : null });
  });
  return lines;
}

/** The order's deposit in SOL before a Review says it to the lamport: what the program keeps for an order and each of its prices. */
export function depositSol(prices: number): number {
  return (6_157_000 + 935_000 * prices) / 1e9;
}

/** What a row of «Orders» shows of one of the person's orders, and what can be done with it. */
export type OrderRow = Readonly<{
  key: string;
  kind: Shape;
  side: LadderAction | null;
  filled: number;
  of: number;
  /** The nearest and the farthest price left, in the quote coin. */
  from: number | null;
  to: number | null;
  /** What rests in the order: its smallest units, and whether it is the quote coin (else the coin). */
  restsRaw: string;
  inQuote: boolean;
  agent: 'collects' | 'paused' | null;
  taken: boolean;
  actions: readonly OrderAct[];
}>;

/** «Take» what filled, «Deposit back» once everything is taken, «Cancel», and «Resume agent» where it stopped collecting. */
export type OrderAct = 'take' | 'deposit' | 'cancel' | 'resume';

/** `collector` — whether the pool offers an agent to collect at all: without one, «Resume agent» is not offered. */
export function orderRow(order: Order, collector = true): OrderRow {
  const taken = order.state === 'taken';
  const buy = order.action === 'buy';
  const actions: OrderAct[] = taken ? ['deposit'] : order.filledPrices > 0 ? ['take', 'cancel'] : ['cancel'];
  if (!taken && collector && order.agent && !order.agentReady && order.agentOffered) actions.push('resume');
  return {
    key: order.nftMint,
    kind: order.prices === 1 ? 'one' : 'ladder',
    side: order.action,
    filled: order.filledPrices,
    of: order.prices,
    // A buy reaches down from the price, a sale up: «from» is the price nearest the market.
    from: buy ? order.highPrice : order.lowPrice,
    to: buy ? order.lowPrice : order.highPrice,
    restsRaw: order.restsRaw,
    inQuote: order.restsIn === order.quote.mint,
    agent: taken || !order.agent ? null : order.agentReady ? 'collects' : 'paused',
    taken,
    actions,
  };
}
