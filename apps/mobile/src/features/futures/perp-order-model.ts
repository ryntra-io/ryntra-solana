/**
 * The perpetual's order as the phone's ticket sets it (C4c, the web's PERP-2 `perp-order-model.ts` ported with the
 * same math and the same names): the leverage the person picks, the size in USD or in the asset, the share of what the
 * collateral allows, reduce-only, TP/SL — and what the ticket shows before «Перевірка»: the order's value, the margin
 * it takes at that leverage, the fees, and an estimate of the liquidation price by Phoenix's own risk figures. Then the
 * order the route builds, in lots and ticks.
 *
 * Cross margin (Phoenix's subaccount 0, the one Ryntra trades): every position stands on the whole account, and Phoenix
 * holds the initial margin of each by its tier's leverage. The leverage picked here is the size's measure — how much of
 * the free collateral the order puts to work — never more than the market's tier allows; the route takes no leverage.
 * «Перевірка» — Phoenix's own view of the account after the order — is the figure that counts; the estimate says «≈».
 *
 * Amounts reach the order exactly: what is typed becomes lots and ticks through the decimal helpers, never a float.
 * Pure.
 */

import type { FuturesAccount, FuturesMarket } from './futures-model.ts'
import {
  lotsFromUnits,
  MIN_ORDER_NOTIONAL_USD,
  ticksFromUsd,
  usdFromTicks,
  type OrderBody,
  type PerpSide,
  type PerpUnits,
} from './orders-model.ts'

export type PerpOrderType = 'market' | 'limit'
export type SizeUnit = 'usd' | 'coin'

/** What the person sets in the ticket. Typed text stays text: the order is made from it exactly. */
export type PerpDraft = Readonly<{
  side: PerpSide
  type: PerpOrderType
  /** A limit's price in USD, as typed. */
  price: string
  /** The size as typed, in `unit`. */
  size: string
  unit: SizeUnit
  /** The share of the most the collateral allows, when the slider set the size; null once a size is typed. */
  percent: number | null
  reduceOnly: boolean
  tpsl: boolean
  tp: string
  sl: string
  slippageBps: number
}>

export const newPerpDraft = (slippageBps: number, unit: SizeUnit = 'usd'): PerpDraft => ({
  side: 'long',
  type: 'market',
  price: '',
  size: '',
  unit,
  percent: null,
  reduceOnly: false,
  tpsl: false,
  tp: '',
  sl: '',
  slippageBps,
})

/** The tolerances a market order offers, bps — the web ticket's four, inside the route's 10…500. */
export const PERP_SLIPPAGES = [10, 50, 100, 200] as const
/** The shares of the most the size chips set; 100 is «Max». */
export const PERP_SHARES = [25, 50, 75, 100] as const
/** The leverage a market opens with before the person picks one: ten times, or the market's highest when lower. */
export const DEFAULT_LEVERAGE = 10
/** How old a book may be to count a market order's fill from: three of the phone's polls, a clock's skew aside. */
export const BOOK_FRESH_MS = 15_000

/** A decimal as people type it — a comma or a point, spaces between thousands — as plain text; null for anything else. */
export function decimalInput(text: string): string | null {
  const plain = text.replace(/[\s  ]/g, '').replace(',', '.')
  return /^\d+(\.\d+)?$|^\d+\.$|^\.\d+$/.test(plain) ? plain.replace(/\.$/, '').replace(/^\./, '0.') : null
}

type TierMarket = Readonly<{
  maxLeverage: number | null
  leverageTiers?: readonly Readonly<{ maxLeverage: number; maxSizeUnits: number | null }>[]
}>

/** The leverage tier a position of this size falls in: its leverage, and the market's highest when no tier was sent. */
export function tierLeverage(market: TierMarket, sizeUnits: number): number | null {
  const tiers = market.leverageTiers ?? []
  if (tiers.length === 0) return market.maxLeverage
  const size = Math.abs(sizeUnits)
  return (tiers.find((tier) => tier.maxSizeUnits === null || size <= tier.maxSizeUnits) ?? tiers[tiers.length - 1]!)
    .maxLeverage
}

/** The leverages the picker offers up to the market's highest: the usual steps and the highest itself. */
export function leverageSteps(max: number | null): number[] {
  if (max === null || !(max >= 1)) return [1]
  const top = Math.floor(max)
  return [...new Set([1, 2, 3, 5, 10, 20, 25, 50, 100].filter((step) => step < top).concat(top))]
}

/** A picked leverage inside the market's range: a whole number from one to its highest. */
export function clampLeverage(value: number, max: number | null): number {
  const top = max !== null && max >= 1 ? Math.floor(max) : 1
  if (!Number.isFinite(value)) return Math.min(top, DEFAULT_LEVERAGE)
  return Math.min(top, Math.max(1, Math.round(value)))
}

/** Where the phone keeps a market's picked leverage, and the values it may hold there: one to the market's highest. */
export const leverageKey = (symbol: string) => `futures.leverage.${symbol.toLowerCase()}`
export const leverageChoices = (max: number | null): string[] =>
  Array.from({ length: max !== null && max >= 1 ? Math.floor(max) : 1 }, (_, index) => String(index + 1))

/** The collateral free for new positions: Phoenix's account value less the margin its positions and orders hold. */
export function freeCollateralUsd(
  margin: Readonly<{ portfolioUsd: number | null; initialMarginUsd: number | null }> | null | undefined,
): number | null {
  if (!margin || margin.portfolioUsd === null || margin.initialMarginUsd === null) return null
  return Math.max(0, margin.portfolioUsd - margin.initialMarginUsd)
}

/** The share of the free collateral the most leaves untouched: a price that moves between the ticket and the chain. */
export const MARGIN_ROOM = 0.01

/**
 * The most an order may be worth at the picked leverage, by Phoenix's own check after the fill (its program's log on
 * the operator's SPCX order, 23.10): the initial margin of everything held must stay within the account's value, and the
 * fill itself lowers that value by the fees and by what the fill pays over the mark — up to the whole tolerance, on the
 * order's full size, not on its margin. So the free collateral carries the margin at the leverage, the fees (Phoenix's
 * and Ryntra's) and the tolerance on the notional, with a percent of room — «Max» is an order Phoenix takes, not one a
 * cent over. Under the first check's ceiling when there is one. Null without the figures.
 */
export function maxOrderUsd(
  free: number | null,
  leverage: number,
  ceilingUsd: number | null,
  slippageBps: number,
  feeRate = 0,
): number | null {
  if (free === null) return null
  const most = (free * (1 - MARGIN_ROOM)) / (1 / leverage + slippageBps / 10_000 + Math.max(0, feeRate))
  return ceilingUsd === null ? most : Math.min(most, ceilingUsd / (1 + slippageBps / 10_000))
}

/**
 * Whether the free collateral carries the order, as Phoenix checks it after the fill: the margin it holds for what the
 * order adds, the fees, and the tolerance on the order's notional. A cut never needs any.
 */
export function marginCarried(
  free: number | null,
  marginUsd: number | null,
  feesUsd: number | null,
  slippageBps: number,
  notionalUsd: number | null = null,
): boolean {
  if (free === null || marginUsd === null) return true
  return marginUsd + (feesUsd ?? 0) + (notionalUsd ?? 0) * (slippageBps / 10_000) <= free
}

export type BookLevels = Readonly<{
  bids: readonly Readonly<{ price: number; size: number }>[]
  asks: readonly Readonly<{ price: number; size: number }>[]
}>

/**
 * What a market order of this size would fill at, walking the book on its side — the asks for a long, the bids for a
 * short — as the page last read it. `thin` when the book cannot fill it; null without a book.
 */
export function bookFill(
  side: PerpSide,
  sizeUnits: number,
  book: BookLevels | null,
): Readonly<{ averageUsd: number; worstUsd: number }> | 'thin' | null {
  if (!book) return null
  const levels = side === 'long' ? book.asks : book.bids
  if (levels.length === 0 || !(sizeUnits > 0)) return levels.length === 0 ? 'thin' : null
  let left = sizeUnits
  let quote = 0
  let worst = levels[0]!.price
  for (const level of levels) {
    if (left <= 0) break
    const take = Math.min(left, level.size)
    quote += take * level.price
    left -= take
    worst = level.price
  }
  if (left > sizeUnits * 1e-9) return 'thin'
  return { averageUsd: quote / sizeUnits, worstUsd: worst }
}

/**
 * The size in the asset for what is typed: the asset's own amount, or USD at the price the order is counted at (a
 * limit's price, else the mark). Null when it is not a positive number or there is no price.
 */
export function sizeUnitsOf(draft: Pick<PerpDraft, 'size' | 'unit'>, priceUsd: number | null): number | null {
  const typed = decimalInput(draft.size)
  if (typed === null) return null
  const value = Number(typed)
  if (!(value > 0)) return null
  if (draft.unit === 'coin') return value
  return priceUsd !== null && priceUsd > 0 ? value / priceUsd : null
}

/**
 * The size in lots, down to a whole lot; null under one lot. The amount is read at 15 significant digits first, so a
 * float a hair under a whole lot (a most of 57 lots divided back by its price) is that lot, not one fewer (C4f).
 */
export function lotsOfUnits(sizeUnits: number, units: PerpUnits): bigint | null {
  if (!Number.isFinite(sizeUnits)) return null
  const lots = lotsFromUnits(Number(sizeUnits.toPrecision(15)).toFixed(12), units.baseLotsDecimals)
  return lots !== null && lots > 0n ? lots : null
}

/**
 * A size typed in USD, in lots (C4f). A dollar figure is said to the cent: «Макс», a share and the unit switch write the
 * lots' dollars down to the cent, so the lots read back are the fewest whose dollars round down to those cents — never a
 * lot fewer. Without it «Макс» on NEAR (one lot is one NEAR, ≈ $4.36) wrote $26.14 for six lots, which read back as
 * 5.9995 NEAR and ordered five: a whole lot lost on the operator's Seeker, 2026-10-24. A size typed by hand is read the same
 * way: what it orders is within the cent typed.
 */
export function lotsOfUsdSize(sizeUnits: number, priceUsd: number, units: PerpUnits): bigint | null {
  const lot = 10 ** -units.baseLotsDecimals
  const typedUsd = sizeUnits * priceUsd
  const perLot = lot * priceUsd
  const fewest = Math.ceil(Number((typedUsd / perLot).toPrecision(15)))
  const lots = fewest * perLot < typedUsd + 0.01 - 1e-9 ? BigInt(fewest) : (lotsOfUnits(sizeUnits, units) ?? 0n)
  return lots > 0n ? lots : null
}

/** The most that can be ordered in whole lots at the price, USD — what «Макс» and the slider's 100 % stand for. */
export function orderableUsd(maxUsd: number | null, priceUsd: number | null, units: PerpUnits): number | null {
  if (maxUsd === null || priceUsd === null || !(priceUsd > 0)) return maxUsd
  const lots = lotsOfUnits(maxUsd / priceUsd, units)
  return lots === null ? 0 : unitsOfLots(lots, units) * priceUsd
}

/** The asset's amount of a number of lots, as a number for the screen. */
export const unitsOfLots = (lots: bigint, units: PerpUnits): number => Number(lots) * 10 ** -units.baseLotsDecimals

/** The account as the estimate needs it, by Phoenix's own figures for subaccount 0. */
export type AccountRisk = Readonly<{
  /** The account's value now (collateral and unrealised result). */
  valueUsd: number
  /** The margin its positions must keep now. */
  maintenanceUsd: number
  /** The position already held on this market, signed: positive long, negative short. */
  heldUnits: number
}>

/**
 * Where the position would be liquidated after this order — an estimate by Phoenix's risk figures, not its program:
 * the price at which the account's value falls to the margin it must keep, everything else held still.
 *
 *   value after the fill: V' = V − fees + q · (mark − fill)
 *   at a mark P:          V' + Q · (P − mark) = M_other + |Q| · P · m,   m = maintenance share / the tier's leverage
 *   so                    P = (M_other − V' + Q · mark) / (Q − |Q| · m)
 *
 * with Q the position after the order (signed) and M_other the margin the account keeps for everything else.
 */
export type LiquidationEstimate =
  Readonly<{ kind: 'price'; priceUsd: number }> | Readonly<{ kind: 'none' }> | Readonly<{ kind: 'unknown' }>

export function liquidationEstimate(
  input: Readonly<{
    account: AccountRisk
    /** The order's signed size: positive buys, negative sells. */
    orderUnits: number
    fillUsd: number
    markUsd: number
    feesUsd: number
    maintenanceRatio: number | null | undefined
    tierLeverage: number | null
  }>,
): LiquidationEstimate {
  const { account, orderUnits, fillUsd, markUsd, feesUsd, maintenanceRatio, tierLeverage: leverage } = input
  const after = account.heldUnits + orderUnits
  if (Math.abs(after) < 1e-12) return { kind: 'none' }
  if (!maintenanceRatio || !leverage || !(leverage > 0) || !(markUsd > 0)) return { kind: 'unknown' }
  const share = maintenanceRatio / leverage
  const valueAfter = account.valueUsd - feesUsd + orderUnits * (markUsd - fillUsd)
  const keptOther = Math.max(0, account.maintenanceUsd - Math.abs(account.heldUnits) * markUsd * share)
  const price = (keptOther - valueAfter + after * markUsd) / (after - Math.abs(after) * share)
  if (!Number.isFinite(price)) return { kind: 'unknown' }
  /* A price on the wrong side of the mark is a position already past its margin: not a price to show — not known here. */
  if (after > 0 ? price >= markUsd : price <= markUsd) return { kind: 'unknown' }
  if (price > 0) return { kind: 'price', priceUsd: price }
  /* A long the account covers to a price of nothing is never liquidated; a short with no price above nothing is past it. */
  return after > 0 ? { kind: 'none' } : { kind: 'unknown' }
}

/**
 * The account's leverage after the order: every position's value over the account's, by the marks — this market's
 * position as it stands after the order, whichever way it went (a sell larger than a long turns it short).
 */
export function accountLeverageAfter(
  positionsValueUsd: number,
  heldUnits: number,
  orderUnits: number,
  markUsd: number,
  accountValueUsd: number | null,
): number | null {
  if (accountValueUsd === null || !(accountValueUsd > 0) || !(markUsd > 0)) return null
  const total =
    Math.max(0, positionsValueUsd - Math.abs(heldUnits) * markUsd) + Math.abs(heldUnits + orderUnits) * markUsd
  return total / accountValueUsd
}

/** Whether the order only makes this market's position smaller: no new margin. */
export const onlyReduces = (heldUnits: number, orderUnits: number): boolean =>
  heldUnits !== 0 && Math.abs(heldUnits + orderUnits) <= Math.abs(heldUnits) + 1e-12

/**
 * The leverage the order is sized at: the one picked, never above the tier a position of that size falls in — the
 * most at the picked leverage, then at the tier's when that is lower.
 */
export function sizingLeverage(
  market: TierMarket,
  picked: number,
  free: number | null,
  priceUsd: number | null,
  heldUnits: number,
): number {
  if (free === null || priceUsd === null || !(priceUsd > 0)) return picked
  const tier = tierLeverage(market, Math.abs(heldUnits) + (free * picked) / priceUsd)
  return tier === null ? picked : Math.min(picked, tier)
}

/** A take profit's or a stop loss's result on the position at its price, in USD and as a share of the margin put in. */
export function legResult(
  side: PerpSide,
  entryUsd: number,
  legUsd: number,
  sizeUnits: number,
  leverage: number,
): Readonly<{ usd: number; percent: number }> {
  const move = side === 'long' ? legUsd - entryUsd : entryUsd - legUsd
  return { usd: move * sizeUnits, percent: (move / entryUsd) * leverage * 100 }
}

/** The order the route builds from the ticket, or why there is none yet. */
export type PerpOrder =
  | Readonly<{
      kind: 'open'
      side: PerpSide
      type: 'market'
      size: string
      slippageBps: number
      tp: string | null
      sl: string | null
    }>
  | Readonly<{ kind: 'open'; side: PerpSide; type: 'limit'; size: string; price: string }>
  | Readonly<{ kind: 'reduce'; size: string; slippageBps: number }>

export type PerpBlock =
  | 'SIZE'
  | 'PRICE'
  | 'MINIMUM'
  | 'LOT'
  | 'OVER_MAX'
  | 'CEILING'
  | 'MARGIN'
  | 'TP'
  | 'SL'
  | 'TP_SIDE'
  | 'SL_SIDE'
  | 'REDUCE_LIMIT'
  | 'REDUCE_SIDE'
  | 'REDUCE_NONE'
  | 'REDUCE_OVER'

/**
 * The ticket's draft as the order the route builds: the side, the size in lots, a limit's price and the legs in ticks,
 * or a reduce-only market order — rounded toward the side each guards. A block word while the draft is not one.
 */
export function perpOrderOf(
  input: Readonly<{
    draft: PerpDraft
    units: PerpUnits
    markUsd: number | null
    /** The most the order may be worth now, when known. */
    maxUsd: number | null
    /** The position held on this market, signed; 0 for none. */
    heldUnits: number
    /** The first check's ceiling on a new position's value, when the gate is a canary. */
    ceilingUsd?: number | null
  }>,
): Readonly<{ order: PerpOrder; sizeUnits: number; priceUsd: number }> | Readonly<{ block: PerpBlock }> | null {
  const { draft, units, markUsd, maxUsd, heldUnits, ceilingUsd } = input
  const limit = draft.type === 'limit'
  const typedPrice = limit ? decimalInput(draft.price) : null
  if (limit && typedPrice === null) return draft.price.trim() === '' ? null : { block: 'PRICE' }
  const priceUsd = limit ? Number(typedPrice) : markUsd
  if (priceUsd === null || !(priceUsd > 0)) return limit ? { block: 'PRICE' } : null
  if (draft.size.trim() === '') return null
  const sizeUnits = sizeUnitsOf(draft, priceUsd)
  if (sizeUnits === null) return { block: 'SIZE' }
  /* The asset as typed goes to lots exactly; USD goes through the price to the lot, a cent's rounding kept (C4f). */
  const typedCoins = draft.unit === 'coin' ? decimalInput(draft.size) : null
  const typedLots = typedCoins === null ? null : lotsFromUnits(typedCoins, units.baseLotsDecimals)
  const lots =
    typedCoins !== null
      ? typedLots !== null && typedLots > 0n
        ? typedLots
        : null
      : lotsOfUsdSize(sizeUnits, priceUsd, units)
  if (lots === null) return { block: draft.reduceOnly ? 'LOT' : 'MINIMUM' }
  const exact = unitsOfLots(lots, units)

  if (draft.reduceOnly) {
    if (limit) return { block: 'REDUCE_LIMIT' }
    if (heldUnits === 0) return { block: 'REDUCE_NONE' }
    if (heldUnits > 0 !== (draft.side === 'short')) return { block: 'REDUCE_SIDE' }
    if (exact > Math.abs(heldUnits) + 1e-12) return { block: 'REDUCE_OVER' }
    return {
      order: { kind: 'reduce', size: lots.toString(), slippageBps: draft.slippageBps },
      sizeUnits: exact,
      priceUsd,
    }
  }

  if (exact * priceUsd < MIN_ORDER_NOTIONAL_USD) return { block: 'MINIMUM' }
  /* The first check's ceiling counts as the server does: a sell at the mark when that is above its limit. */
  const countUsd = draft.side === 'short' && limit && markUsd !== null ? Math.max(priceUsd, markUsd) : priceUsd
  if (ceilingUsd != null && exact * countUsd > ceilingUsd / (1 + (limit ? 0 : draft.slippageBps / 10_000)) + 0.01)
    return { block: 'CEILING' }
  /* A cent of rounding is not over the most: the slider's «Max» rounds the size down to a lot already. */
  if (maxUsd !== null && exact * priceUsd > maxUsd + 0.01) return { block: 'OVER_MAX' }
  if (limit) {
    const ticks = ticksFromUsd(typedPrice!, units, draft.side === 'long' ? 'floor' : 'ceil')
    if (ticks === null) return { block: 'PRICE' }
    return {
      order: { kind: 'open', side: draft.side, type: 'limit', size: lots.toString(), price: ticks.toString() },
      sizeUnits: exact,
      priceUsd,
    }
  }
  let tp: bigint | null = null
  let sl: bigint | null = null
  if (draft.tpsl) {
    const long = draft.side === 'long'
    const tpText = draft.tp.trim() === '' ? null : decimalInput(draft.tp)
    const slText = draft.sl.trim() === '' ? null : decimalInput(draft.sl)
    if (draft.tp.trim() !== '' && tpText === null) return { block: 'TP' }
    if (draft.sl.trim() !== '' && slText === null) return { block: 'SL' }
    /* A long's take profit down to the tick and its stop up — never past what was typed; a short's the other way. */
    tp = tpText === null ? null : ticksFromUsd(tpText, units, long ? 'floor' : 'ceil')
    sl = slText === null ? null : ticksFromUsd(slText, units, long ? 'ceil' : 'floor')
    if (tpText !== null && tp === null) return { block: 'TP' }
    if (slText !== null && sl === null) return { block: 'SL' }
    /* The side is checked on the price as it will be sent — on the tick — not as typed. */
    const tpUsd = tp === null ? null : usdFromTicks(tp, units)
    const slUsd = sl === null ? null : usdFromTicks(sl, units)
    if (tpUsd !== null && (long ? !(tpUsd > priceUsd) : !(tpUsd < priceUsd))) return { block: 'TP_SIDE' }
    if (slUsd !== null && (long ? !(slUsd < priceUsd) : !(slUsd > priceUsd))) return { block: 'SL_SIDE' }
  }
  return {
    order: {
      kind: 'open',
      side: draft.side,
      type: 'market',
      size: lots.toString(),
      slippageBps: draft.slippageBps,
      tp: tp === null ? null : tp.toString(),
      sl: sl === null ? null : sl.toString(),
    },
    sizeUnits: exact,
    priceUsd,
  }
}

/**
 * The size the slider's share sets, as the ticket's text in its unit: the share of the most, in USD, or in the asset at
 * the price counted — down to the lot, so «Max» is never over the most.
 */
export function sizeAtPercent(
  percent: number,
  maxUsd: number | null,
  priceUsd: number | null,
  unit: SizeUnit,
  units: PerpUnits,
): string {
  if (maxUsd === null || priceUsd === null || !(priceUsd > 0) || !(percent > 0)) return ''
  const lots = lotsOfUnits((maxUsd * Math.min(100, percent)) / 100 / priceUsd, units)
  if (lots === null) return ''
  const coins = unitsOfLots(lots, units)
  if (unit === 'coin') return coinText(coins, units.baseLotsDecimals)
  return trimZeros(centsDown(coins * priceUsd).toFixed(2))
}

/** Dollars down to the cent, a float a hair under a whole cent counted as that cent ($149.57999… is $149.58). */
const centsDown = (usd: number) => Math.floor(Number((usd * 100).toPrecision(12))) / 100

const trimZeros = (text: string) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text)

/** The asset's amount as the ticket's text: its lot's digits, trailing zeros only after a point — 1200 stays 1200. */
export const coinText = (units: number, decimals: number) => trimZeros(units.toFixed(Math.max(0, decimals)))

/**
 * Another unit keeps the size: what was typed in USD becomes the asset at the counted price, down to the lot's digits,
 * and the asset becomes USD down to the cent. Empty without a size or a price.
 */
export function sizeInUnit(
  sizeUnits: number | null,
  priceUsd: number | null,
  unit: SizeUnit,
  units: PerpUnits,
): string {
  if (sizeUnits === null || priceUsd === null || !(priceUsd > 0)) return ''
  return unit === 'coin'
    ? coinText(sizeUnits, units.baseLotsDecimals)
    : centsDown(sizeUnits * priceUsd).toFixed(2)
}

/* ------------------------------------------------------- the phone's own */

/** A market's or a position's symbol, compared case-blind: the trader state and the market list may spell it differently. */
const sameSymbol = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The position the ticket adds to or reduces: subaccount 0 on this market, signed — positive long, negative short; 0
 * for none (a size Phoenix's lots could not be read counts as none, as on the web).
 */
export function heldUnitsOf(account: FuturesAccount | null, symbol: string): number {
  const own = account?.positions.find((position) => position.subaccount === 0 && sameSymbol(position.symbol, symbol))
  if (!own || own.size === null) return 0
  return own.side === 'long' ? own.size : -own.size
}

/**
 * Every position of subaccount 0 at its market's mark, for the account's leverage after. Null when a position's size or
 * its market's mark is not known: then the leverage after is a dash, never an undercount.
 */
export function positionsValueUsdOf(
  account: FuturesAccount | null,
  markets: readonly Pick<FuturesMarket, 'symbol' | 'markPrice'>[],
): number | null {
  if (!account) return 0
  let sum = 0
  for (const position of account.positions) {
    if (position.subaccount !== 0) continue
    const mark = markets.find((market) => sameSymbol(market.symbol, position.symbol))?.markPrice ?? null
    if (position.size === null || mark === null) return null
    sum += Math.abs(position.size) * mark
  }
  return sum
}

/** The ticket's order as the route's body (`parseOrderRequest` on line A): no leverage — it only sized the order. */
export function perpOrderBody(order: PerpOrder, owner: string, symbol: string): OrderBody {
  if (order.kind === 'reduce')
    return { kind: 'reduce', owner, symbol, size: order.size, slippageBps: order.slippageBps }
  if (order.type === 'limit')
    return { kind: 'open', owner, symbol, side: order.side, type: 'limit', size: order.size, price: order.price }
  return {
    kind: 'open',
    owner,
    symbol,
    side: order.side,
    type: 'market',
    size: order.size,
    slippageBps: order.slippageBps,
    tp: order.tp,
    sl: order.sl,
  }
}

/** The blocks the ticket answers with «Поповнити»: the collateral, not the draft, is what is short. */
export const wantsDeposit = (block: PerpBlock | 'thin' | null): boolean => block === 'OVER_MAX' || block === 'MARGIN'

/* --------------------------------------------------------- the ticket's figures */

export type TicketMarket = TierMarket &
  Readonly<{ markPrice: number | null; takerRate: number | null; maintenanceRatio: number | null }>

/** What the ticket shows before «Перевірка», and the order it would ask for — the web form's figures, in one place. */
export type TicketFigures = Readonly<{
  /** The price the size is counted at: a limit's, else the mark. */
  countPrice: number | null
  free: number | null
  /** The most the order may be worth at the leverage; null for reduce-only or without the figures. */
  maxUsd: number | null
  sizeUnits: number | null
  /** The order's signed size: positive buys. */
  signed: number | null
  fill: ReturnType<typeof bookFill>
  fillUsd: number | null
  valueUsd: number | null
  reduces: boolean
  /** The tier's leverage Phoenix holds the position's margin at. */
  tier: number | null
  feesUsd: number | null
  /** Ryntra's fee is known: none without a builder, or its rate read — never «0» when it was not. */
  ryntraKnown: boolean
  liquidation: LiquidationEstimate | null
  marginUsd: number | null
  leverageAfter: number | null
  block: PerpBlock | 'thin' | null
  order: PerpOrder | null
  /** The share of the most the size is now, 0…100. */
  share: number
}>

export function perpTicketFigures(
  input: Readonly<{
    market: TicketMarket
    units: PerpUnits
    draft: PerpDraft
    leverage: number
    margin: Readonly<{
      portfolioUsd: number | null
      initialMarginUsd: number | null
      maintenanceMarginUsd: number | null
    }> | null
    /** The wallet has a Phoenix account: its free collateral counts. */
    opened: boolean
    maxNotionalUsd: number | null
    builder: boolean
    builderBps: number | null
    /** The book while it is fresh enough to count a market order's fill from; null otherwise. */
    book: BookLevels | null
    heldUnits: number
    /** Every position's value at its mark; null when one is not known. */
    positionsValueUsd: number | null
  }>,
): TicketFigures {
  const { market, units, draft, leverage, margin, opened, maxNotionalUsd, builder, builderBps, book, heldUnits } = input
  const mark = market.markPrice
  const limit = draft.type === 'limit'
  const typedPrice = limit ? decimalInput(draft.price) : null
  const countPrice = limit ? (typedPrice === null ? null : Number(typedPrice)) : mark
  const free = opened ? freeCollateralUsd(margin) : null
  const sizing = sizingLeverage(market, leverage, free, countPrice, heldUnits)
  /* The fees come out of the same collateral: Phoenix's taker rate and Ryntra's, when it is known. */
  const feeRate = (market.takerRate ?? 0) + (builder && builderBps !== null ? builderBps / 10_000 : 0)
  const maxUsd = draft.reduceOnly
    ? null
    : maxOrderUsd(free, sizing, maxNotionalUsd, limit ? 0 : draft.slippageBps, feeRate)

  /* «Макс» and the slider's 100 % are the most in whole lots (C4f): on a market whose lot is worth dollars the most the
     collateral allows is not orderable to the cent, and «Макс» must read 100 %. */
  const mostUsd = orderableUsd(maxUsd, countPrice, units)
  const made = perpOrderOf({
    draft,
    units,
    markUsd: mark,
    maxUsd,
    heldUnits,
    ceilingUsd: draft.reduceOnly ? null : maxNotionalUsd,
  })
  const sizeUnits = made && 'order' in made ? made.sizeUnits : sizeUnitsOf(draft, countPrice)
  const signed = sizeUnits === null ? null : draft.side === 'long' ? sizeUnits : -sizeUnits
  /* A market order's fill from the book while it is fresh; a book that stopped coming fills nothing here. */
  const fill = !limit && sizeUnits !== null ? bookFill(draft.side, sizeUnits, book) : null
  const fillUsd = fill && fill !== 'thin' ? fill.averageUsd : countPrice
  const valueUsd = sizeUnits !== null && fillUsd !== null ? sizeUnits * fillUsd : null
  const reduces = draft.reduceOnly || (signed !== null && onlyReduces(heldUnits, signed))
  /* The leverage Phoenix holds the position's margin at: its tier's, whatever leverage sized the order. */
  const tier = signed === null ? null : tierLeverage(market, heldUnits + signed)
  const takerRate = market.takerRate
  const ryntraKnown = !builder || builderBps !== null
  const ryntraRate = builder && builderBps !== null && builderBps > 0 ? builderBps / 10_000 : 0
  const feesUsd = !limit && valueUsd !== null && takerRate !== null ? valueUsd * (takerRate + ryntraRate) : null
  const liquidation =
    signed !== null &&
    fillUsd !== null &&
    mark !== null &&
    margin &&
    margin.portfolioUsd !== null &&
    margin.maintenanceMarginUsd !== null
      ? liquidationEstimate({
          account: { valueUsd: margin.portfolioUsd, maintenanceUsd: margin.maintenanceMarginUsd, heldUnits },
          orderUnits: signed,
          /* A limit rests: its position is counted as filled when the mark reaches its price, not as filled now. */
          fillUsd,
          markUsd: limit ? fillUsd : mark,
          feesUsd: feesUsd ?? 0,
          maintenanceRatio: market.maintenanceRatio,
          tierLeverage: tier,
        })
      : null
  /* The margin Phoenix holds for what the order adds — a flip's new side whole — at its tier's leverage. */
  const added =
    signed === null
      ? null
      : Math.abs(heldUnits + signed) -
        (Math.sign(heldUnits + signed) === Math.sign(heldUnits) ? Math.abs(heldUnits) : 0)
  const marginUsd =
    added === null || tier === null || fillUsd === null || !(added > 0) ? null : (added * fillUsd) / tier
  const leverageAfter =
    signed !== null && mark !== null && input.positionsValueUsd !== null
      ? accountLeverageAfter(input.positionsValueUsd, heldUnits, signed, mark, margin?.portfolioUsd ?? null)
      : null
  /* Phoenix refuses an order the collateral cannot carry with its fees: said here, before anything is built. */
  const carried = reduces || limit ? true : marginCarried(free, marginUsd, feesUsd, draft.slippageBps, valueUsd)
  const block = made && 'block' in made ? made.block : fill === 'thin' ? 'thin' : !carried ? 'MARGIN' : null
  const order = made && 'order' in made && fill !== 'thin' && carried ? made.order : null
  /* The slider shows the share the size is of the most now — whatever moved since: the price, the collateral, the leverage. */
  const share =
    valueUsd !== null && mostUsd !== null && mostUsd > 0 ? Math.min(100, Math.max(0, (valueUsd / mostUsd) * 100)) : 0
  return {
    countPrice,
    free,
    maxUsd: mostUsd,
    sizeUnits,
    signed,
    fill,
    fillUsd,
    valueUsd,
    reduces,
    tier,
    feesUsd,
    ryntraKnown,
    liquidation,
    marginUsd,
    leverageAfter,
    block,
    order,
    share,
  }
}
