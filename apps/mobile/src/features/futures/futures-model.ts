/**
 * «Торгівля → Ф'ючерси» as values — pure (C4, decision 56). Phoenix's perpetual futures on Solana as the web's B7 reads
 * them: the routes under `/api/solana/futures/*` (line A, `lib/phoenix/market-data.ts`) answer the markets, one
 * market's book and bars, and a wallet's Phoenix account by its public address. Nothing here signs, holds or places
 * anything: the orders are their own module (`orders-model.ts`, C4b), built and checked by the server alone.
 *
 * Every answer is read again here rather than trusted: a field that is missing or not a number is no number on the
 * screen — a dash, never a zero. The funding rate and the open interest are not drawn, as on the web: Phoenix names
 * neither one's unit (B7a §9).
 */

import type { Candle, Timeframe } from '../../lib/api.ts'

/** A market symbol as Phoenix writes it (SOL, BTC, kBONK, TSLA): letters and digits, never a path. */
export const FUTURES_SYMBOL = /^[A-Za-z0-9]{1,20}$/

export const isFuturesSymbol = (value: unknown): value is string =>
  typeof value === 'string' && FUTURES_SYMBOL.test(value)

/** The chart's timeframes on the phone: the asset page's four, which the route serves too. */
export const FUTURES_TIMEFRAMES = ['5m', '1h', '4h', '1d'] as const satisfies readonly Timeframe[]
export type FuturesTimeframe = (typeof FUTURES_TIMEFRAMES)[number]

export type FuturesMarket = Readonly<{
  symbol: string
  /** `active` takes orders; `gated` is listed by Phoenix but not open to orders. */
  status: 'active' | 'gated'
  /** Commodities and stocks trade by a calendar; `session` is Phoenix's word for where it stands. */
  calendar: boolean
  session: string | null
  /** The first tier's leverage — the market's highest; a bigger position gets less. */
  maxLeverage: number | null
  /** Phoenix's leverage by position size, the first tier first: a position up to `maxSizeUnits` gets `maxLeverage` (C4c). */
  leverageTiers: readonly LeverageTier[]
  /** The share of the initial margin a position must keep before Phoenix liquidates it; null when not sent. */
  maintenanceRatio: number | null
  /** What is open on the market, in the asset; null when not sent. */
  openInterestUnits: number | null
  isolatedOnly: boolean
  /** Quote lots per base lot per tick, and the base decimals: the units an order travels in (C4b); null when not sent. */
  tickSize: number | null
  baseLotsDecimals: number | null
  /** Phoenix's fee on the part that takes liquidity and on the part that rests, fractions of the notional; null when not sent. */
  takerRate: number | null
  makerRate: number | null
  markPrice: number | null
  /** The median of the market's oracles — Phoenix's index price. */
  oraclePrice: number | null
  prevDayMarkPrice: number | null
  dayVolumeUsd: number | null
}>

export type LeverageTier = Readonly<{ maxLeverage: number; maxSizeUnits: number | null }>

export type FuturesMarkets = Readonly<{ markets: readonly FuturesMarket[]; observedAt: number }>

export type BookLevel = Readonly<{ price: number; size: number }>

export type FuturesBook = Readonly<{
  symbol: string
  bids: readonly BookLevel[]
  asks: readonly BookLevel[]
  observedAt: number
}>

export type FuturesCandles = Readonly<{
  symbol: string
  timeframe: string
  candles: readonly Candle[]
  observedAt: number
}>

export type FuturesPosition = Readonly<{
  symbol: string
  /** Phoenix's subaccount: 0 is the cross-margin one Ryntra's orders act on; another is isolated, managed on phoenix.trade. */
  subaccount: number | null
  side: 'long' | 'short'
  /** In the base asset, always positive; null when Phoenix's lots could not be read — the position is still shown. */
  size: number | null
  entryPrice: number | null
  /** The position's take profit and stop loss as Phoenix holds them, trigger prices in dollars; null — none. */
  tpPrice: number | null
  slPrice: number | null
}>

export type FuturesOrder = Readonly<{
  id: string
  symbol: string
  subaccount: number | null
  side: 'buy' | 'sell'
  type: string
  price: number | null
  size: number | null
  reduceOnly: boolean
  stop: boolean
  /** Phoenix's sequence number of the order, the id a cancel names (C4b); null when Phoenix sent none — no cancel then. */
  sequence: string | null
}>

/**
 * The account's state in Phoenix's words: `active` trades; `cold` is an account Phoenix holds but has not made active —
 * it may well hold collateral (a live account read on 2026-10-20: `cold` with $30 211 of USDC), so it is never said as
 * «no collateral»; `none` was never opened.
 */
export const ACCOUNT_STATES = ['none', 'uninitialized', 'cold', 'active', 'reduceOnly', 'frozen', 'unknown'] as const
export type FuturesAccountState = (typeof ACCOUNT_STATES)[number]

export type FuturesAccount = Readonly<{
  wallet: string
  state: FuturesAccountState
  collateralUsd: number | null
  /** SOL posted as collateral, in SOL — counted by Phoenix at a discount, never added to the dollars. */
  collateralSol: number | null
  positions: readonly FuturesPosition[]
  orders: readonly FuturesOrder[]
  /** The cross-margin account's figures by Phoenix's own view (B6); null when not read or there is no account. */
  margin: FuturesMargin | null
  observedAt: number
}>

export type FuturesMargin = Readonly<{
  /** Collateral plus the unrealised result, Phoenix's own figure. */
  portfolioUsd: number | null
  /** What open positions and orders hold: below it no new risk is taken. */
  initialMarginUsd: number | null
  /** Below it the account is liquidated. */
  maintenanceMarginUsd: number | null
  riskTier: string | null
  /** What may leave the account now, micro-dollars as digits (C4c); null when not sent. */
  withdrawableMicro: string | null
  /** Phoenix's own word on whether the account takes a deposit and lets collateral leave now; null when not sent. */
  canDeposit: boolean | null
  canWithdraw: boolean | null
}>

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const positive = (value: unknown): number | null => {
  const parsed = finite(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

const nonNegative = (value: unknown): number | null => {
  const parsed = finite(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

/** The read's own time; an answer without one is read as of `fallback` (the moment it arrived). */
const observed = (body: Json, fallback: number): number => positive(body.observedAt) ?? fallback

/** A market's leverage tiers as sent, each with a positive leverage; a tier without one is dropped. */
function tiersOf(raw: unknown): LeverageTier[] {
  if (!Array.isArray(raw)) return []
  const out: LeverageTier[] = []
  for (const tier of raw) {
    if (!isObject(tier)) continue
    const maxLeverage = positive(tier.maxLeverage)
    if (maxLeverage === null) continue
    out.push({ maxLeverage, maxSizeUnits: positive(tier.maxSizeUnits) })
  }
  return out
}

/** The markets as the route answers them, the busiest first as it sorts them; a row without a symbol is dropped. */
export function parseMarkets(raw: unknown, now: number = Date.now()): FuturesMarkets {
  const body = isObject(raw) ? raw : {}
  const list = Array.isArray(body.markets) ? body.markets : []
  const seen = new Set<string>()
  const markets: FuturesMarket[] = []
  for (const entry of list) {
    if (!isObject(entry) || !isFuturesSymbol(entry.symbol)) continue
    const key = entry.symbol.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const calendar = entry.calendar === true
    markets.push({
      symbol: entry.symbol,
      status: entry.status === 'active' ? 'active' : 'gated',
      calendar,
      session: calendar ? text(entry.session) : null,
      maxLeverage: positive(entry.maxLeverage),
      leverageTiers: tiersOf(entry.leverageTiers),
      maintenanceRatio: positive(entry.maintenanceRatio),
      openInterestUnits: nonNegative(entry.openInterestUnits),
      isolatedOnly: entry.isolatedOnly === true,
      tickSize: positive(entry.tickSize),
      baseLotsDecimals:
        typeof entry.baseLotsDecimals === 'number' && Number.isInteger(entry.baseLotsDecimals)
          ? entry.baseLotsDecimals
          : null,
      takerRate: nonNegative(entry.takerRate),
      makerRate: finite(entry.makerRate),
      markPrice: positive(entry.markPrice),
      oraclePrice: positive(entry.oraclePrice),
      prevDayMarkPrice: positive(entry.prevDayMarkPrice),
      dayVolumeUsd: nonNegative(entry.dayVolumeUsd),
    })
  }
  return { markets, observedAt: observed(body, now) }
}

function levels(raw: unknown, side: 'bid' | 'ask'): BookLevel[] {
  if (!Array.isArray(raw)) return []
  const out: BookLevel[] = []
  for (const level of raw) {
    if (!isObject(level)) continue
    const price = positive(level.price)
    const size = positive(level.size)
    if (price !== null && size !== null) out.push({ price, size })
  }
  // Bids from the best (highest) down, asks from the best (lowest) up.
  return out.sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price))
}

export function parseBook(raw: unknown, symbol: string, now: number = Date.now()): FuturesBook {
  const body = isObject(raw) ? raw : {}
  return { symbol, bids: levels(body.bids, 'bid'), asks: levels(body.asks, 'ask'), observedAt: observed(body, now) }
}

/**
 * The traded price's bars as the phone's chart draws them: seconds, not milliseconds, oldest first, one bar per open,
 * a bar turned inside out by a broken print righted (the high the highest of the four, the low the lowest).
 */
export function parseCandles(raw: unknown, symbol: string, now: number = Date.now()): FuturesCandles {
  const body = isObject(raw) ? raw : {}
  const list = Array.isArray(body.last) ? body.last : []
  const byTime = new Map<number, Candle>()
  for (const bar of list) {
    if (!isObject(bar)) continue
    const t = positive(bar.t)
    const [o, h, l, c] = [bar.o, bar.h, bar.l, bar.c].map(positive)
    if (t === null || o == null || h == null || l == null || c == null) continue
    const time = Math.floor(t / 1000)
    const volume = nonNegative(bar.v)
    byTime.set(time, {
      time,
      open: o,
      high: Math.max(o, h, l, c),
      low: Math.min(o, h, l, c),
      close: c,
      ...(volume === null ? {} : { volume }),
    })
  }
  const candles = [...byTime.values()].sort((a, b) => a.time - b.time)
  return { symbol, timeframe: text(body.timeframe) ?? '', candles, observedAt: observed(body, now) }
}

export function parseAccount(raw: unknown, wallet: string, now: number = Date.now()): FuturesAccount {
  const body = isObject(raw) ? raw : {}
  const state = (ACCOUNT_STATES as readonly unknown[]).includes(body.state)
    ? (body.state as FuturesAccountState)
    : 'unknown'
  const positions: FuturesPosition[] = []
  for (const entry of Array.isArray(body.positions) ? body.positions : []) {
    if (!isObject(entry) || !isFuturesSymbol(entry.symbol)) continue
    if (entry.side !== 'long' && entry.side !== 'short') continue
    positions.push({
      symbol: entry.symbol,
      subaccount: subaccountOf(entry.subaccount),
      side: entry.side,
      size: positive(entry.size),
      entryPrice: positive(entry.entryPrice),
      tpPrice: positive(entry.tpPrice),
      slPrice: positive(entry.slPrice),
    })
  }
  const orders: FuturesOrder[] = []
  for (const entry of Array.isArray(body.orders) ? body.orders : []) {
    if (!isObject(entry) || !isFuturesSymbol(entry.symbol)) continue
    if (entry.side !== 'buy' && entry.side !== 'sell') continue
    orders.push({
      id: text(entry.id) ?? `${entry.symbol}-${orders.length}`,
      symbol: entry.symbol,
      subaccount: subaccountOf(entry.subaccount),
      side: entry.side,
      type: text(entry.type) ?? '',
      price: positive(entry.price),
      size: positive(entry.size),
      reduceOnly: entry.reduceOnly === true,
      stop: entry.stop === true,
      sequence: typeof entry.sequence === 'string' && /^\d{1,20}$/.test(entry.sequence) ? entry.sequence : null,
    })
  }
  return {
    wallet,
    state,
    collateralUsd: nonNegative(body.collateralUsd),
    collateralSol: nonNegative(body.collateralSol),
    positions,
    orders,
    margin: parseMargin(body.margin),
    observedAt: observed(body, now),
  }
}

const subaccountOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null

function parseMargin(raw: unknown): FuturesMargin | null {
  if (!isObject(raw)) return null
  return {
    portfolioUsd: finite(raw.portfolioUsd),
    initialMarginUsd: nonNegative(raw.initialMarginUsd),
    maintenanceMarginUsd: nonNegative(raw.maintenanceMarginUsd),
    riskTier: text(raw.riskTier),
    withdrawableMicro:
      typeof raw.withdrawableMicro === 'string' && /^\d{1,20}$/.test(raw.withdrawableMicro)
        ? raw.withdrawableMicro
        : null,
    canDeposit: typeof raw.canDeposit === 'boolean' ? raw.canDeposit : null,
    canWithdraw: typeof raw.canWithdraw === 'boolean' ? raw.canWithdraw : null,
  }
}

/** The day's move of the mark price, in percent; null without both prices. */
export function dayChangePct(market: Pick<FuturesMarket, 'markPrice' | 'prevDayMarkPrice'>): number | null {
  const { markPrice, prevDayMarkPrice } = market
  if (markPrice === null || prevDayMarkPrice === null) return null
  return (markPrice / prevDayMarkPrice - 1) * 100
}

/** The market a symbol names, case-blind as Phoenix's own lookups are; null when the list has none. */
export function marketOf(markets: readonly FuturesMarket[], symbol: string): FuturesMarket | null {
  const key = symbol.toLowerCase()
  return markets.find((market) => market.symbol.toLowerCase() === key) ?? null
}

/** How many levels a side of the book shows on a phone: enough to see the depth, few enough to fit. */
export const BOOK_DEPTH = 8

/**
 * The book as the phone draws it: the asks above, the best one last, so the two best prices meet at the spread; the
 * bids below, the best first; each level's share of the deepest level shown, for its bar. The spread in dollars and
 * as a share of the middle; null when a side is empty.
 */
export function bookView(book: FuturesBook, depth: number = BOOK_DEPTH) {
  const asks = book.asks.slice(0, depth)
  const bids = book.bids.slice(0, depth)
  const deepest = Math.max(0, ...asks.map((level) => level.size), ...bids.map((level) => level.size))
  const share = (level: BookLevel) => (deepest > 0 ? level.size / deepest : 0)
  const bestAsk = asks[0]
  const bestBid = bids[0]
  const spread =
    bestAsk && bestBid && bestAsk.price >= bestBid.price
      ? {
          usd: bestAsk.price - bestBid.price,
          pct: ((bestAsk.price - bestBid.price) / ((bestAsk.price + bestBid.price) / 2)) * 100,
        }
      : null
  return {
    asks: [...asks].reverse().map((level) => ({ ...level, share: share(level) })),
    bids: bids.map((level) => ({ ...level, share: share(level) })),
    spread,
  }
}

/** The decimals a column of sizes needs: the most any of them has, up to `cap` — so the column's decimals line up. */
export function sizeDecimals(sizes: readonly number[], cap = 4): number {
  let most = 0
  for (const size of sizes) {
    for (let digits = most; digits < cap; digits += 1) {
      const scaled = size * 10 ** digits
      if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, Math.abs(scaled))) break
      most = digits + 1
    }
  }
  return most
}

/** The account's positions and resting orders on one market. */
export function accountOn(account: FuturesAccount, symbol: string) {
  const key = symbol.toLowerCase()
  return {
    positions: account.positions.filter((position) => position.symbol.toLowerCase() === key),
    orders: account.orders.filter((order) => order.symbol.toLowerCase() === key),
  }
}

/** Whether Phoenix knows the wallet at all — `none` is a wallet that never had a trader account, as the web says it. */
export const hasAccount = (account: FuturesAccount): boolean => account.state !== 'none'
