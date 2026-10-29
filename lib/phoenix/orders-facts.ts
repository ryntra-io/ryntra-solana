/**
 * Phoenix's public answers as the orders read them (B6b): one market of `GET /v1/view/exchange/markets` with its latest
 * stats, the wallet's position and resting orders on it from `GET /v1/trader/state/{wallet}`, and the fills of one
 * landed signature from `GET /v1/trader/{wallet}/trades-history`. Every field is checked rather than trusted, as
 * `market-data.ts` does for the page: a field that is missing or not a number is a fact not known, never a zero.
 *
 * Pure. The reads are `orders.server.ts`'s.
 */

import type { MarketFacts, TraderFacts } from "./orders-actions.ts";
import type { PerpFill } from "./orders-model.ts";
import type { ConditionalFacts, PositionFacts, RestingFacts } from "./orders.ts";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const symbolKey = (symbol: string): string => symbol.toLowerCase();

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const positive = (value: unknown): number | null => {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

/** Whole digits with a sign, as Phoenix sends lots and ticks; null for anything else. */
function integer(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d{1,30}$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * One market for an order: its configuration (asset id, the book and spline accounts, the units, the fees, the margin
 * mode) and its latest mark and index. Null when the market is not listed or its configuration is not whole — no order
 * is built on a market whose units are guessed.
 */
export function marketFactsFrom(config: unknown, stats: unknown, symbol: string): MarketFacts | null {
  const listed = (Array.isArray(config) ? config : []).find((entry): entry is Json => isObject(entry) && typeof entry.symbol === "string" && symbolKey(entry.symbol) === symbolKey(symbol));
  if (!listed) return null;
  const assetId = num(listed.assetId);
  const tickSize = num(listed.tickSize);
  const decimals = num(listed.baseLotsDecimals);
  if (assetId === null || !Number.isInteger(assetId) || assetId < 0) return null;
  if (tickSize === null || !Number.isSafeInteger(tickSize) || tickSize <= 0 || decimals === null || !Number.isInteger(decimals) || Math.abs(decimals) > 12) return null;
  if (typeof listed.marketPubkey !== "string" || !ADDRESS.test(listed.marketPubkey) || typeof listed.splinePubkey !== "string" || !ADDRESS.test(listed.splinePubkey)) return null;
  const statsList = isObject(stats) && Array.isArray(stats.markets) ? stats.markets : [];
  const stat = statsList.find((entry): entry is Json => isObject(entry) && typeof entry.symbol === "string" && symbolKey(entry.symbol) === symbolKey(symbol));
  const rate = (value: unknown) => {
    const parsed = num(value);
    return parsed !== null && parsed >= 0 && parsed < 0.01 ? parsed : null;
  };
  const interval = num(listed.fundingIntervalSeconds);
  return {
    symbol: listed.symbol as string,
    assetId,
    units: { tickSize, baseLotsDecimals: decimals },
    orderbook: listed.marketPubkey,
    spline: listed.splinePubkey,
    takerRate: rate(listed.takerFee),
    makerRate: rate(listed.makerFee),
    markUsd: positive(stat?.mark_price),
    indexUsd: positive(stat?.oracle_price),
    status: typeof listed.marketStatus === "string" && listed.marketStatus.trim().toLowerCase() === "active" ? "active" : "gated",
    isolatedOnly: listed.isolatedOnly === true,
    fundingIntervalSeconds: interval !== null && interval > 0 ? interval : null,
  };
}

/** `capabilities.capabilities.<name>.immediate` of the trader state's snapshot. */
function capable(snapshot: Json, name: string): boolean {
  const outer = isObject(snapshot.capabilities) ? snapshot.capabilities : {};
  const inner = isObject(outer.capabilities) ? outer.capabilities : outer;
  const entry = inner[name];
  return isObject(entry) && entry.immediate === true;
}

/**
 * The TP/SL a position carries as Phoenix's conditional orders: each one's index in the trader's own TP/SL account
 * (1 … 191) and the triggers it holds — the facts a cancel of one of them names. Phoenix's resting order rows carry no
 * index of their own, so this is the only place an index comes from (PERP-5). A take profit and a stop loss placed
 * together share one index, and both are gathered under it: Phoenix's cancel takes the conditional order whole.
 */
function conditionalsOf(position: Json): ConditionalFacts[] {
  const legs = new Map<number, { tp: bigint | null; sl: bigint | null; order: readonly ("tp" | "sl")[] }>();
  const read = (list: unknown, key: string, leg: "tp" | "sl") => {
    for (const entry of Array.isArray(list) ? list : []) {
      if (!isObject(entry)) continue;
      const status = typeof entry.status === "string" ? entry.status.toLowerCase() : "active";
      if (status !== "active" && status !== "pending" && status !== "open") continue;
      const id = num(entry[key]);
      if (id === null || !Number.isInteger(id) || id < 1 || id > 191) continue;
      const trigger = isObject(entry.trigger) ? integer(entry.trigger.triggerPriceTicks) : null;
      const held = legs.get(id) ?? { tp: null, sl: null, order: [] };
      legs.set(id, {
        tp: leg === "tp" ? (held.tp ?? (trigger !== null && trigger > 0n ? trigger : null)) : held.tp,
        sl: leg === "sl" ? (held.sl ?? (trigger !== null && trigger > 0n ? trigger : null)) : held.sl,
        order: held.order.includes(leg) ? held.order : [...held.order, leg],
      });
    }
  };
  read(position.conditionalTakeProfitTriggers, "conditionalTakeProfitId", "tp");
  read(position.conditionalStopLossTriggers, "conditionalStopLossId", "sl");
  return [...legs.entries()]
    .map(([index, held]) => ({ index, legs: held.order, tpTicks: held.tp, slTicks: held.sl }))
    .sort((a, b) => a.index - b.index);
}

/**
 * The wallet's trader account on one market: whether Phoenix lets it trade, its position at subaccount 0 with the TP/SL
 * indexes to lift, its plain resting orders there (a TP/SL is not cancelled by its order id) and every order it has
 * resting in this market's book — the plain ones and the ones a TP/SL placed, which is the set Phoenix's own
 * `CancelAll` removes. Not an account at all when the state has no subaccount and no capabilities.
 */
export function traderFactsFrom(raw: unknown, symbol: string): TraderFacts {
  const body = isObject(raw) ? raw : {};
  const snapshot = isObject(body.snapshot) ? body.snapshot : {};
  const subaccounts = Array.isArray(snapshot.subaccounts) ? snapshot.subaccounts.filter(isObject) : [];
  const state = isObject(snapshot.capabilities) && typeof snapshot.capabilities.state === "string" ? snapshot.capabilities.state : null;
  if (subaccounts.length === 0 && (state === null || state === "uninitialized")) return { found: false };
  const first = subaccounts.find((sub) => (num(sub.subaccountIndex) ?? 0) === 0);
  let position: PositionFacts | null = null;
  const orders: RestingFacts[] = [];
  const resting: RestingFacts[] = [];
  let conditionals: readonly ConditionalFacts[] = [];
  if (first) {
    for (const entry of Array.isArray(first.positions) ? first.positions : []) {
      if (!isObject(entry) || typeof entry.symbol !== "string" || symbolKey(entry.symbol) !== symbolKey(symbol)) continue;
      const lots = integer(entry.basePositionLots);
      if (lots === null) continue;
      conditionals = conditionalsOf(entry);
      position = { lots, conditionalIndexes: conditionals.map((leg) => leg.index) };
    }
    for (const group of Array.isArray(first.orders) ? first.orders : []) {
      if (!isObject(group) || typeof group.symbol !== "string" || symbolKey(group.symbol) !== symbolKey(symbol) || !Array.isArray(group.orders)) continue;
      for (const order of group.orders) {
        if (!isObject(order) || order.change === "closed") continue;
        const sequence = integer(order.orderSequenceNumber);
        const price = integer(order.priceTicks);
        if (sequence === null || sequence <= 0n || price === null || price <= 0n) continue;
        const left = integer(order.sizeRemainingLots);
        /* Nothing left is nothing resting — the same reading as the page's own account read (`market-data.ts`), so the
           count under «cancel all» and the count in its Review are of one set. */
        if (left !== null && left === 0n) continue;
        const row: RestingFacts = { orderSequenceNumber: sequence, priceTicks: price, side: order.side === "ask" ? "sell" : "buy", sizeLots: left === null ? null : left < 0n ? -left : left };
        resting.push(row);
        /* A conditional order is not cancelled by its order id: it has none of its own to name (see `conditionalsOf`). */
        if (order.isStopLoss !== true && order.isConditionalOrder !== true) orders.push(row);
      }
    }
  }
  return { found: true, canAddRisk: capable(snapshot, "riskIncreasingTrade"), canReduceRisk: capable(snapshot, "riskReducingTrade"), position, orders, resting, conditionals };
}

/**
 * The fills of one signature from Phoenix's trade history: the size from the lots (Phoenix's own count, exact), the price
 * and the fee as Phoenix writes them. A price far from the market's mark, or a fee far from Phoenix's rate, is a unit
 * this page does not know: such a fill keeps its size and drops the figure rather than print one a million times off.
 */
export function fillsFrom(raw: unknown, signature: string, units: Readonly<{ baseLotsDecimals: number }>, markUsd: number | null, takerRate: number | null): PerpFill[] {
  const items = isObject(raw) && Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const out: PerpFill[] = [];
  for (const item of items) {
    if (!isObject(item) || item.signature !== signature) continue;
    const delta = integer(item.baseLotsDelta);
    if (delta === null || delta === 0n) continue;
    const size = Number(delta) / 10 ** units.baseLotsDecimals;
    const price = positive(item.price);
    if (price === null || (markUsd !== null && (price < markUsd * 0.75 || price > markUsd * 1.25))) continue;
    const notional = Math.abs(size) * price;
    const fee = num(item.fees);
    /* A fee is Phoenix's rate at most twice over (a builder's share rides on it), never a rebate this page cannot place. */
    const feeOk = fee !== null && fee >= 0 && (takerRate === null ? fee <= notional * 0.01 : fee <= notional * Math.max(takerRate * 3, 0.002));
    const pnl = num(item.realizedPnl);
    /* Phoenix's own reader defaults an unrecognised word to `maker` (SDK `api/trades/types.ts`): the same here, so a
       fee split never charges a taker's rate and a builder's bps on a fill whose side this reader did not recognise. */
    out.push({ sizeUnits: size, priceUsd: price, feeUsd: feeOk ? fee : null, realizedPnlUsd: pnl !== null && Math.abs(pnl) <= notional * 2 + 1 ? pnl : null, liquidity: item.liquidity === "taker" ? "taker" : "maker" });
  }
  return out;
}
