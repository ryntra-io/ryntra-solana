import type { FuturesMarket } from '../../../lib/phoenix/market-data.ts';
import {
  DEFAULT_LIMIT_TIF,
  DEFAULT_MARKET_TIF,
  DEFAULT_PERP_SLIPPAGE_BPS,
  fractionOf,
  legsSideOk,
  ticksFromUsd,
  worstPriceUsd,
  type PerpSide,
  type PerpUnits,
} from '../../../lib/phoenix/orders-model.ts';
import type { OrderRow } from './account.ts';
import type { OrderBody, TicketQuery } from './engine.ts';
import { CAREFUL_LEVERAGE, clampLeverage, unitsOf } from './markets.ts';

/**
 * The Exchange's ticket: long or short, market or limit, the leverage, the size, TP/SL — what the person sets, and how
 * it becomes the order the engine's routes take. Nothing here is a figure for the screen: the margin, the fees, the
 * most, the liquidation estimate come from the engine's ticket read (`/api/solana/futures/ticket`, Phoenix's SDK), and
 * the Review is Phoenix's own view of the account after the order.
 *
 * What is typed reaches the order exactly, through the engine's own unit helpers (`lib/phoenix/orders-model.ts`):
 * dollars become base lots at the engine's mark in whole ticks, never more than typed; prices become ticks rounded
 * the way that keeps the person's limit. Pure.
 */

export type SizeInput = Readonly<{ kind: 'usd'; text: string }> | Readonly<{ kind: 'share'; percent: number }>;

export type Draft = Readonly<{
  /** Long or short — none until the person chooses: no side is imposed on an order. */
  side: PerpSide | null;
  type: 'market' | 'limit';
  leverage: number;
  size: SizeInput;
  /** A limit's price in USD, as typed. */
  price: string;
  /** TP/SL go with a market order only: a limit rests, and its TP/SL is set on the position once it fills. */
  tpsl: boolean;
  tp: string;
  sl: string;
  slippageBps: number;
}>;

export const SHARES = [25, 50, 75, 100] as const;

export const newDraft = (leverage = CAREFUL_LEVERAGE): Draft => ({
  side: null,
  type: 'market',
  leverage,
  size: { kind: 'usd', text: '' },
  price: '',
  tpsl: false,
  tp: '',
  sl: '',
  slippageBps: DEFAULT_PERP_SLIPPAGE_BPS,
});

/** The draft carried to another market: the side, type and wish for TP/SL stay; prices and the leverage start again. */
export function draftFor(market: Pick<FuturesMarket, 'maxLeverage'>, before: Draft | null): Draft {
  const fresh = newDraft(clampLeverage(CAREFUL_LEVERAGE, market.maxLeverage));
  if (!before) return fresh;
  return { ...fresh, side: before.side, type: before.type, size: before.size.kind === 'share' ? before.size : fresh.size, tpsl: before.tpsl };
}

/**
 * A decimal as people type it — a point, or a comma as the decimal mark («0,5»), spaces between thousands — as plain
 * text; null for anything else. A comma that groups thousands («1,000», «12,500.5») is refused rather than guessed:
 * read as a decimal mark it would make a $1,000 stop a $1 one.
 */
export function decimalText(text: string): string | null {
  const bare = text.replace(/[\s\u00a0\u202f]/g, '');
  if (bare.includes(',') && (bare.includes('.') || /^\d{1,3}(,\d{3})+$/.test(bare) || bare.split(',').length > 2)) return null;
  const plain = bare.replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\d+\.$|^\.\d+$/.test(plain)) return null;
  return plain.replace(/\.$/, '').replace(/^\./, '0.');
}

/** Typed dollars as micro-dollars, rounded down; null for anything that is not a plain positive amount. */
export function microOf(text: string): bigint | null {
  const plain = decimalText(text);
  const fraction = plain === null ? null : fractionOf(plain);
  if (!fraction) return null;
  const micro = (fraction.num * 1_000_000n) / fraction.den;
  return micro > 0n ? micro : null;
}

/** A price typed in USD as whole ticks, rounded the way given; null when it is not a price. */
export function ticksOfText(text: string, units: PerpUnits, rounding: 'floor' | 'ceil'): bigint | null {
  const plain = decimalText(text);
  return plain === null ? null : ticksFromUsd(plain, units, rounding);
}

/** The mark in whole ticks, rounded up as the engine counts it; null without a mark. */
export function markTicksOf(market: Pick<FuturesMarket, 'markPrice'>, units: PerpUnits): bigint | null {
  const mark = market.markPrice;
  if (mark === null || !(mark > 0)) return null;
  return ticksFromUsd(mark.toFixed(12), units, 'ceil');
}

/** A limit's price: down for a long (never paid above), up for a short (never sold under). */
export function limitTicksOf(draft: Pick<Draft, 'type' | 'price' | 'side'>, units: PerpUnits): bigint | null {
  if (draft.type !== 'limit') return null;
  return ticksOfText(draft.price, units, draft.side === 'short' ? 'ceil' : 'floor');
}

/**
 * The price the engine counts an open's notional at (`reviewOrder` in `lib/phoenix/orders-actions.ts`): a market order
 * at its worst price — the mark moved by the tolerance, rounded as the engine's `worstTicksOf` rounds it — and a limit
 * at its own price; a sell fills at the book, which may stand above a low limit, so a short is never counted under the
 * mark. A draft with no side yet is counted as a long: the higher price, the smaller size.
 */
export function countTicksOf(draft: Pick<Draft, 'type' | 'price' | 'side' | 'slippageBps'>, market: Pick<FuturesMarket, 'markPrice'>, units: PerpUnits): bigint | null {
  const mark = markTicksOf(market, units);
  const short = draft.side === 'short';
  if (draft.type === 'limit') {
    const limit = limitTicksOf(draft, units);
    if (limit === null) return null;
    return short && mark !== null && mark > limit ? mark : limit;
  }
  if (mark === null || market.markPrice === null) return null;
  const worst = ticksFromUsd(worstPriceUsd(short ? 'short' : 'long', market.markPrice, draft.slippageBps).toFixed(12), units, short ? 'ceil' : 'floor');
  if (worst === null) return null;
  return short ? (mark > worst ? mark : worst) : worst;
}

/**
 * The order's size in base lots. Dollars become lots at the price the engine counts the order at (`countTicksOf`)
 * with the engine's own notional (`lots × ticks × tickSize` quote lots), rounded down: the Review's position value is
 * never more than typed, and typing the first check's ceiling stays under it. A share takes that part of the engine's
 * most at this leverage (`maxLots`).
 */
export function sizeLotsOf(draft: Pick<Draft, 'size' | 'type' | 'price' | 'side' | 'slippageBps'>, market: FuturesMarket, maxLots: string | null): bigint | null {
  const units = unitsOf(market);
  if (!units) return null;
  if (draft.size.kind === 'share') {
    if (maxLots === null || !/^\d{1,20}$/.test(maxLots)) return null;
    const lots = (BigInt(maxLots) * BigInt(Math.round(draft.size.percent))) / 100n;
    return lots > 0n ? lots : null;
  }
  const micro = microOf(draft.size.text);
  const ticks = countTicksOf(draft, market, units);
  if (micro === null || ticks === null || ticks <= 0n) return null;
  const lots = micro / (ticks * BigInt(units.tickSize));
  return lots > 0n ? lots : null;
}

/**
 * A take profit and a stop loss as ticks, each rounded towards the mark — a take profit a hair nearer, a stop that fires
 * a hair sooner: the old terminal's rule, so one person sees one trigger on both screens.
 */
export function legTicksOf(side: PerpSide, tpText: string, slText: string, units: PerpUnits): Readonly<{ tp: bigint | null; sl: bigint | null; bad: 'tp' | 'sl' | null }> {
  const long = side === 'long';
  const tp = tpText.trim() ? ticksOfText(tpText, units, long ? 'floor' : 'ceil') : null;
  const sl = slText.trim() ? ticksOfText(slText, units, long ? 'ceil' : 'floor') : null;
  const bad = tpText.trim() && tp === null ? 'tp' : slText.trim() && sl === null ? 'sl' : null;
  return { tp, sl, bad };
}

export type DraftIssue = 'UNITS' | 'MARK' | 'SIDE' | 'SIZE' | 'PRICE' | 'TP_TEXT' | 'SL_TEXT' | 'TP_SIDE' | 'SL_SIDE';

export const ISSUE_WORDS: Readonly<Record<DraftIssue, string>> = {
  UNITS: 'Market not ready',
  MARK: 'Waiting for the price',
  SIDE: 'Choose long or short',
  SIZE: 'Choose a size',
  PRICE: 'Type a limit price',
  TP_TEXT: 'Check the take profit',
  SL_TEXT: 'Check the stop loss',
  TP_SIDE: 'Take profit on the wrong side',
  SL_SIDE: 'Stop loss on the wrong side',
};

/**
 * What still stands between the draft and a Review, before the engine is asked: the side, a size, a limit's price, and
 * TP/SL on the side they guard by the engine's own rule (`legsSideOk`, the Review's check). Null — ready to review.
 */
export function draftIssue(draft: Draft, market: FuturesMarket, sizeLots: bigint | null): DraftIssue | null {
  const units = unitsOf(market);
  if (!units) return 'UNITS';
  if (draft.side === null) return 'SIDE';
  if (draft.type === 'limit' && limitTicksOf(draft, units) === null) return 'PRICE';
  if (draft.type === 'market' && market.markPrice === null) return 'MARK';
  if (sizeLots === null) return 'SIZE';
  if (draft.type === 'market' && draft.tpsl) {
    const legs = legTicksOf(draft.side, draft.tp, draft.sl, units);
    if (legs.bad === 'tp') return 'TP_TEXT';
    if (legs.bad === 'sl') return 'SL_TEXT';
    const tpUsd = draft.tp.trim() ? Number(decimalText(draft.tp)) : null;
    const slUsd = draft.sl.trim() ? Number(decimalText(draft.sl)) : null;
    const wrong = legsSideOk(draft.side, market.markPrice!, tpUsd, slUsd);
    if (wrong) return wrong;
  }
  return null;
}

/** The ticket's question to the engine's margin calculator; null without a wallet, a side or the market's units. */
export function ticketQuery(owner: string | null, market: FuturesMarket, draft: Draft, sizeLots: bigint | null, feeBps: number): TicketQuery | null {
  const units = unitsOf(market);
  if (!owner || !units || draft.side === null) return null;
  const limit = limitTicksOf(draft, units);
  if (draft.type === 'limit' && limit === null) return null;
  return {
    wallet: owner,
    symbol: market.symbol,
    side: draft.side,
    type: draft.type,
    leverage: clampLeverage(draft.leverage, market.maxLeverage),
    slippageBps: draft.slippageBps,
    feeBps,
    sizeLots: sizeLots === null ? null : sizeLots.toString(),
    limitTicks: limit === null ? null : limit.toString(),
    reduceOnly: false,
  };
}

/** The same question without its size: what the engine's most is keyed by. */
export const maxKeyOf = (query: TicketQuery): string => [query.wallet, query.symbol, query.side, query.type, query.leverage, query.limitTicks ?? '', query.feeBps].join('|');
export const figuresKeyOf = (query: TicketQuery): string => `${maxKeyOf(query)}|${query.sizeLots ?? ''}`;

/** The fee rate the engine's estimate takes out of the collateral: Phoenix's taker rate and Ryntra's builder bps. */
export function feeBpsOf(market: Pick<FuturesMarket, 'takerRate'>, builderBps: number | null | undefined): number {
  const taker = market.takerRate ?? 0;
  return Math.max(0, Math.min(100, taker * 10_000 + (builderBps ?? 0)));
}

/** The v1 transaction format for a wallet that signs it (SIMD-0385); legacy bytes for every other. */
export const formatOf = (v1: boolean): Readonly<{ format?: 'v1' }> => (v1 ? { format: 'v1' } : {});

/** The open order as the review route takes it; null while the draft has an issue. */
export function openBody(owner: string, market: FuturesMarket, draft: Draft, sizeLots: bigint | null, v1 = false): OrderBody | null {
  const units = unitsOf(market);
  if (!units || draftIssue(draft, market, sizeLots) !== null || draft.side === null || sizeLots === null) return null;
  const legs = draft.type === 'market' && draft.tpsl ? legTicksOf(draft.side, draft.tp, draft.sl, units) : { tp: null, sl: null };
  const limit = limitTicksOf(draft, units);
  return {
    kind: 'open',
    owner,
    symbol: market.symbol,
    side: draft.side,
    type: draft.type,
    tif: draft.type === 'market' ? DEFAULT_MARKET_TIF : DEFAULT_LIMIT_TIF,
    size: sizeLots.toString(),
    ...(draft.type === 'limit' && limit !== null ? { price: limit.toString() } : { slippageBps: draft.slippageBps }),
    ...(legs.tp !== null ? { tp: legs.tp.toString() } : {}),
    ...(legs.sl !== null ? { sl: legs.sl.toString() } : {}),
    ...formatOf(v1),
  };
}

/**
 * A whole position closed. The engine closes what Phoenix holds, read at the Review, never a size from the page; the
 * route still asks for a size of digits, so one lot stands in for it, as the old terminal sends.
 */
export const closeBody = (owner: string, symbol: string, slippageBps = DEFAULT_PERP_SLIPPAGE_BPS, v1 = false): OrderBody => ({ kind: 'reduce', owner, symbol, size: '1', close: true, slippageBps, ...formatOf(v1) });

/** A position's TP/SL set anew (both empty lifts them); null for text that is not a price. */
export function protectBody(owner: string, market: FuturesMarket, side: PerpSide, tpText: string, slText: string, v1 = false): OrderBody | null {
  const units = unitsOf(market);
  if (!units) return null;
  const legs = legTicksOf(side, tpText, slText, units);
  if (legs.bad) return null;
  return { kind: 'protect', owner, symbol: market.symbol, tp: legs.tp === null ? null : legs.tp.toString(), sl: legs.sl === null ? null : legs.sl.toString(), ...formatOf(v1) };
}

/**
 * One resting order lifted: a plain one by its sequence number, a TP/SL leg by its position's conditional index — the pair
 * placed together goes together. Null for a row that cannot be named alone (another subaccount's, or a conditional
 * without its index): «Cancel all» of its market still takes it.
 */
export function cancelBody(owner: string, row: Pick<OrderRow, 'symbol' | 'cancel'>, v1 = false): OrderBody | null {
  if (!row.cancel) return null;
  return row.cancel.kind === 'order'
    ? { kind: 'cancel', owner, symbol: row.symbol, order: row.cancel.sequence, ...formatOf(v1) }
    : { kind: 'cancelConditional', owner, symbol: row.symbol, index: row.cancel.index, ...formatOf(v1) };
}

/** Every order of a market lifted at once, as the engine lists them at the Review. */
export const cancelAllBody = (owner: string, symbol: string, v1 = false): OrderBody => ({ kind: 'cancelAll', owner, symbol, ...formatOf(v1) });

/** Whether a position's new TP/SL sit on the side they guard, by the engine's rule; the issue's code when not. */
export function protectIssue(side: PerpSide, market: FuturesMarket, tpText: string, slText: string): DraftIssue | null {
  const units = unitsOf(market);
  if (!units) return 'UNITS';
  const legs = legTicksOf(side, tpText, slText, units);
  if (legs.bad === 'tp') return 'TP_TEXT';
  if (legs.bad === 'sl') return 'SL_TEXT';
  if (market.markPrice === null) return legs.tp === null && legs.sl === null ? null : 'MARK';
  return legsSideOk(side, market.markPrice, tpText.trim() ? Number(decimalText(tpText)) : null, slText.trim() ? Number(decimalText(slText)) : null);
}
