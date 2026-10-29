/**
 * A wallet's own history on Phoenix's perpetuals (PERP-5, spec §11.1–§11.2, §18 «HistoryAdapter»): the fills it made,
 * the orders it placed and what became of them, and the funding it paid or received — each from Phoenix's own public
 * read (`/v1/trader/{wallet}/trades-history`, `…/order-history`, `…/funding-history`), parsed the way the rest of this
 * folder parses Phoenix: a field that is missing or not a number is a fact not known, never a zero.
 *
 * Pure. The reads are `read.server.ts`'s; the page's own reads are `use-futures-data.ts`'s.
 */

import { num, symbolKey } from "./market-data.ts";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** The three histories one route serves. */
export const HISTORY_KINDS = Object.freeze(["trades", "orders", "funding"] as const);
export type HistoryKind = (typeof HISTORY_KINDS)[number];
export const isHistoryKind = (value: unknown): value is HistoryKind => typeof value === "string" && (HISTORY_KINDS as readonly string[]).includes(value);

/** How many rows one read asks Phoenix for: a table's page, and the most a person reads at once. */
export const HISTORY_LIMIT = 50;

const positive = (value: unknown): number | null => {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

/** A time Phoenix sends as ms, s, or an ISO string; null for anything else. */
function msOf(value: unknown): number | null {
  const parsed = num(value);
  if (parsed !== null && parsed > 0) return parsed > 1e12 ? parsed : parsed * 1000;
  if (typeof value === "string") {
    const date = Date.parse(value);
    return Number.isFinite(date) && date > 0 ? date : null;
  }
  return null;
}

const text = (value: unknown, fallback = ""): string => (typeof value === "string" && value.trim() !== "" ? value : fallback);

/* ---------------------------------------------------------------- trades */

export type FuturesTrade = Readonly<{
  id: string;
  at: number;
  symbol: string;
  /** Which way the fill moved the position: a buy added to a long, a sell took from it. */
  side: "buy" | "sell";
  sizeUnits: number | null;
  priceUsd: number | null;
  /** The fee Phoenix wrote on this fill — one figure, Phoenix's and Ryntra's together until a live check tells them apart. */
  feeUsd: number | null;
  realizedPnlUsd: number | null;
  liquidity: "maker" | "taker";
  /** Phoenix's own word for what made the fill: `limit`, `market`, `liquidation`, `adl`. */
  kind: string;
  signature: string | null;
}>;

export type FuturesTrades = Readonly<{
  wallet: string;
  symbol: string | null;
  trades: readonly FuturesTrade[];
  /** What the fills read add up to: the result taken, and the fees paid on them. */
  realizedPnlUsd: number | null;
  feesUsd: number | null;
  observedAt: number;
}>;

/**
 * One trader's fills (`GET /v1/trader/{wallet}/trades-history`), newest first; a row without a size or a price is left
 * out. The record states the size in base lots (`baseLotsDelta`), so the asset's amount needs the market's own
 * decimals: `decimalsOf` gives them per symbol, and a market whose decimals did not come keeps the fill without a size
 * rather than printing lots as if they were coins.
 */
export function tradesFrom(raw: unknown, wallet: string, symbol: string | null, observedAt: number, decimalsOf: (symbol: string) => number | null = () => null): FuturesTrades {
  const items = isObject(raw) && Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const trades: FuturesTrade[] = [];
  let pnl: number | null = 0;
  let fees: number | null = 0;
  for (const item of items) {
    if (!isObject(item) || typeof item.marketSymbol !== "string") continue;
    if (symbol !== null && symbolKey(item.marketSymbol) !== symbolKey(symbol)) continue;
    const at = msOf(item.timestamp);
    const delta = num(item.baseLotsDelta);
    const price = positive(item.price);
    if (at === null || delta === null || delta === 0) continue;
    const decimals = decimalsOf(item.marketSymbol);
    const units = decimals === null ? null : Math.abs(delta) / 10 ** decimals;
    const fee = num(item.fees);
    const realized = num(item.realizedPnl);
    trades.push({
      id: text(item.fillId, `${text(item.signature, "fill")}:${text(item.eventIndex, String(trades.length))}`),
      at,
      symbol: item.marketSymbol,
      side: delta > 0 ? "buy" : "sell",
      sizeUnits: units !== null && units > 0 ? units : null,
      priceUsd: price,
      feeUsd: fee !== null && fee >= 0 ? fee : null,
      realizedPnlUsd: realized,
      /* Phoenix's own reader defaults an unrecognised word to `maker` (SDK `api/trades/types.ts`): the same here. */
      liquidity: item.liquidity === "taker" ? "taker" : "maker",
      kind: text(item.tradeType, "market"),
      signature: typeof item.signature === "string" ? item.signature : null,
    });
    pnl = pnl === null || realized === null ? null : pnl + realized;
    fees = fees === null || fee === null || fee < 0 ? null : fees + fee;
  }
  trades.sort((a, b) => b.at - a.at);
  return { wallet, symbol, trades, realizedPnlUsd: trades.length ? pnl : null, feesUsd: trades.length ? fees : null, observedAt };
}

/* ---------------------------------------------------------------- orders */

export type FuturesOrderRecord = Readonly<{
  id: string;
  symbol: string;
  /** Phoenix's own word: `active`, `filled`, `cancelled`, `expired`. */
  status: string;
  side: "buy" | "sell";
  priceUsd: number | null;
  sizeUnits: number | null;
  filledUnits: number | null;
  leftUnits: number | null;
  reduceOnly: boolean;
  stop: boolean;
  placedAt: number | null;
  endedAt: number | null;
}>;

export type FuturesOrdersHistory = Readonly<{ wallet: string; symbol: string | null; orders: readonly FuturesOrderRecord[]; observedAt: number }>;

const side = (value: unknown): "buy" | "sell" => {
  const word = typeof value === "string" ? value.toLowerCase() : "";
  if (word === "ask" || word === "sell" || value === 1) return "sell";
  return "buy";
};

/** One trader's orders and what became of each (`GET /v1/trader/{wallet}/order-history`), newest first. */
export function orderHistoryFrom(raw: unknown, wallet: string, symbol: string | null, observedAt: number): FuturesOrdersHistory {
  const items = isObject(raw) && Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const orders: FuturesOrderRecord[] = [];
  for (const item of items) {
    if (!isObject(item) || typeof item.marketSymbol !== "string" || typeof item.orderSequenceNumber !== "string") continue;
    if (symbol !== null && symbolKey(item.marketSymbol) !== symbolKey(symbol)) continue;
    const size = num(item.baseQty);
    const filled = num(item.filledBaseQty);
    const left = num(item.remainingBaseQty);
    orders.push({
      id: `${item.marketSymbol}:${item.orderSequenceNumber}`,
      symbol: item.marketSymbol,
      status: text(item.status, "active").toLowerCase(),
      side: side(item.side),
      priceUsd: positive(item.price),
      sizeUnits: size !== null && size >= 0 ? size : null,
      filledUnits: filled !== null && filled >= 0 ? filled : null,
      leftUnits: left !== null && left >= 0 ? left : null,
      reduceOnly: item.isReduceOnly === true,
      stop: item.isStopLoss === true,
      placedAt: msOf(item.placedAt),
      endedAt: msOf(item.completedAt),
    });
  }
  orders.sort((a, b) => (b.endedAt ?? b.placedAt ?? 0) - (a.endedAt ?? a.placedAt ?? 0));
  return { wallet, symbol, orders, observedAt };
}

/* --------------------------------------------------------------- funding */

export type FuturesFundingEvent = Readonly<{
  at: number;
  symbol: string;
  /**
   * What the settlement did to the collateral, dollars, with Phoenix's own sign: Phoenix adds funding to the account's
   * effective collateral, so a positive figure is funding received and a negative one funding paid. The figure itself
   * is Phoenix's, unchanged; the two sums below only split it by that sign, and PERP-G1 checks the sign on the chain.
   */
  amountUsd: number;
  ratePercent: number | null;
  positionUnits: number | null;
  side: string | null;
}>;

export type FuturesFundingHistory = Readonly<{
  wallet: string;
  symbol: string | null;
  events: readonly FuturesFundingEvent[];
  /** The two directions as separate figures (spec §11.2), both positive; null when nothing was read. */
  paidUsd: number | null;
  receivedUsd: number | null;
  observedAt: number;
}>;

/** One trader's funding settlements (`GET /v1/trader/{wallet}/funding-history`), newest first. */
export function fundingHistoryFrom(raw: unknown, wallet: string, symbol: string | null, observedAt: number): FuturesFundingHistory {
  const items = isObject(raw) && Array.isArray(raw.events) ? raw.events : Array.isArray(raw) ? raw : [];
  const events: FuturesFundingEvent[] = [];
  let paid = 0;
  let received = 0;
  for (const item of items) {
    if (!isObject(item) || typeof item.symbol !== "string") continue;
    if (symbol !== null && symbolKey(item.symbol) !== symbolKey(symbol)) continue;
    const at = msOf(item.timestamp);
    const amount = num(item.fundingPayment);
    if (at === null || amount === null || amount === 0) continue;
    const rate = num(item.fundingRatePercentage);
    const size = num(item.positionSize);
    events.push({
      at,
      symbol: item.symbol,
      amountUsd: amount,
      /* Five per cent a period is no rate Phoenix pays: a unit misread, never shown (as `market-data.ts` does). */
      ratePercent: rate !== null && Math.abs(rate) < 5 ? rate : null,
      positionUnits: size,
      side: typeof item.positionSide === "string" ? item.positionSide : null,
    });
    if (amount < 0) paid += -amount;
    else received += amount;
  }
  events.sort((a, b) => b.at - a.at);
  return { wallet, symbol, events, paidUsd: events.length ? paid : null, receivedUsd: events.length ? received : null, observedAt };
}
