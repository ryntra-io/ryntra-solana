/**
 * A Phoenix market's page at the web's level (C4c) as values — pure. The core's chart (CH-21's WebView page) fed with
 * Phoenix's bars, the head's open interest in dollars, a level of the book pressed into the ticket's limit, and why
 * the page is view only. Nothing here reads, signs or sends anything.
 */

import type { CandlesMessage, PageCandle, ProTimeframe } from '../pro-chart/bridge.ts'
import type { FuturesCandles, FuturesMarket } from './futures-model.ts'
import { unitsOf, type PerpSide } from './orders-model.ts'

/** One read of one interval as the chart page takes it (the bridge's `candles` message without its envelope). */
export type ChartRead = Omit<CandlesMessage, 'v' | 'type'>

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * The market's name on the chart page. The page takes a market by a Solana address (32–44 base58 characters) and keeps
 * its drawings under it; a Phoenix market has a symbol, so the symbol is written in base58 — two characters a letter,
 * case kept (kBONK is not KBONK) — after «Phx», padded with «1». One symbol, one name; no token's mint is ever named.
 */
export function chartIdOf(symbol: string): string {
  let id = 'Phx'
  for (const char of symbol) {
    const code = char.charCodeAt(0)
    id += BASE58[Math.floor(code / 58) % 58] + BASE58[code % 58]
  }
  return id.padEnd(32, '1').slice(0, 44)
}

/**
 * Phoenix's bars as the chart page draws them. The page counts a bar's `volume` in dollars and gives the chart its
 * base-asset volume as dollars over the bar's typical price, (H + L + C) / 3; Phoenix states the volume in the asset,
 * so it goes in as the asset times that same price — the chart's base volume is Phoenix's own figure, exactly. The
 * source is Phoenix with the market's name; a refresh that failed keeps the last read and says it is stale.
 */
export function chartReadOf(read: FuturesCandles, timeframe: ProTimeframe, refreshFailed: boolean): ChartRead {
  const candles: PageCandle[] = read.candles.map(({ volume, ...bar }) =>
    volume === undefined ? bar : { ...bar, volume: volume * ((bar.high + bar.low + bar.close) / 3) },
  )
  return {
    timeframe,
    candles,
    observedAt: read.observedAt,
    stale: refreshFailed,
    pool: `${read.symbol}-PERP`,
    source: 'Phoenix',
  }
}

/** What is open on the market in dollars: Phoenix's open interest in the asset at the mark; null without either. */
export function openInterestUsd(market: Pick<FuturesMarket, 'openInterestUnits' | 'markPrice'>): number | null {
  const { openInterestUnits, markPrice } = market
  if (openInterestUnits === null || markPrice === null) return null
  return openInterestUnits * markPrice
}

/** A price as plain decimal text — never an exponent («1e-7»), which no price field reads. */
export function plainPrice(price: number): string {
  const text = String(price)
  if (!/e/i.test(text)) return text
  return price
    .toFixed(12)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
}

/**
 * A level of the book pressed: the ticket opens on Limit at its price. An ask is someone selling there — pressed, it
 * buys: a long; a bid is someone buying — pressed, it sells: a short.
 */
export function bookPick(
  side: 'bid' | 'ask',
  price: number,
): Readonly<{ kind: 'open'; side: PerpSide; price: string }> {
  return { kind: 'open', side: side === 'ask' ? 'long' : 'short', price: plainPrice(price) }
}

/** Why the page is view only, the market's own reasons first; null when this wallet can trade here. */
export type ViewOnlyReason = 'gated' | 'isolated' | 'units' | 'wallet' | 'account' | 'gate'

export function viewOnlyReason(
  market: Pick<FuturesMarket, 'status' | 'isolatedOnly' | 'tickSize' | 'baseLotsDecimals'> | null,
  wallet: string | null,
  /** The gate's word for this wallet; null while it is not read — no «view only» on a guess. */
  ordersOpen: boolean | null,
  /** The wallet's Phoenix account as read; `none` or `uninitialized` — Phoenix never opened one (accounts are by invite). */
  accountState: string | null = null,
): ViewOnlyReason | null {
  if (market === null) return null
  if (market.status !== 'active') return 'gated'
  // Ryntra's orders act on the cross-margin account; an isolated-only market is traded on phoenix.trade.
  if (market.isolatedOnly) return 'isolated'
  if (unitsOf(market) === null) return 'units'
  if (wallet === null) return 'wallet'
  if (accountState === 'none' || accountState === 'uninitialized') return 'account'
  return ordersOpen === false ? 'gate' : null
}
