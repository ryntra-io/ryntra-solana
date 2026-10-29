/**
 * Phoenix orders on the phone as values — pure (C4b, the web's B6b). The phone builds nothing: the server's routes
 * (`/api/solana/futures/orders/*`, line A's `lib/phoenix/orders*.ts`) decide whether a wallet may place orders, plan
 * the order from Phoenix's own facts, build it with Phoenix's SDK, check every instruction byte for byte, simulate it
 * and seal the bytes in a ticket. What the phone holds here is the order as the route takes it — the size in Phoenix's
 * base lots and the prices in its ticks, as digits, never a float — and the server's answers read again rather than
 * trusted: a figure that is missing or not a number is a dash on the screen, never a zero.
 *
 * Units (the web's `orders-model.ts`, SDK `units.ts`): the quote is USDC with six decimals, so a quote lot is a
 * millionth of a dollar; a price in ticks is ticks × `tickSize` × 10^`baseLotsDecimals` / 10^6 dollars; a base lot is
 * 10^−`baseLotsDecimals` of the asset (`baseLotsDecimals` may be negative — PUMP is −2).
 */

export type PerpSide = 'long' | 'short'
export type PerpOrderType = 'market' | 'limit'
export type PerpOrderKind = 'open' | 'reduce' | 'protect' | 'cancel'
export type PerpUnits = Readonly<{ tickSize: number; baseLotsDecimals: number }>

/** The price tolerance a market order goes with, bps: 0.5 %, the web ticket's default. */
export const DEFAULT_PERP_SLIPPAGE_BPS = 50
/** How far a stop loss may fill from its trigger once it fires, bps: the SDK's own ceiling (10 %), said in Review. */
export const STOP_SLIPPAGE_BPS = 1_000
/** The least one order opens or adds: one dollar of notional (the operator's minimum for every money action). */
export const MIN_ORDER_NOTIONAL_USD = 1
/** The shares of a position a cut offers. */
export const CUT_SHARES = [25, 50, 75] as const

/* ------------------------------------------------------------------ units */

const DECIMAL = /^(\d{1,15})(?:[.,](\d{0,18}))?$/

/** A plain decimal typed by a person («12.5», «0,25», «1 250») as an exact fraction; null for anything else. */
export function fractionOf(text: string): Readonly<{ num: bigint; den: bigint }> | null {
  const clean = text.trim().replace(/[\s  ]/g, '')
  const match = DECIMAL.exec(clean)
  if (!match) return null
  const fraction = match[2] ?? ''
  return { num: BigInt(`${match[1]}${fraction}` || '0'), den: 10n ** BigInt(fraction.length) }
}

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent)

/** The market's units when Phoenix sent them whole and sane; null — no order on this market from the phone. */
export function unitsOf(
  market: Readonly<{ tickSize: number | null; baseLotsDecimals: number | null }>,
): PerpUnits | null {
  const { tickSize, baseLotsDecimals } = market
  if (tickSize === null || baseLotsDecimals === null) return null
  if (!Number.isSafeInteger(tickSize) || tickSize <= 0) return null
  if (!Number.isInteger(baseLotsDecimals) || Math.abs(baseLotsDecimals) > 12) return null
  return { tickSize, baseLotsDecimals }
}

/**
 * Dollars per one base unit in whole ticks, rounded the way that keeps the person's limit: down (`floor`) for a price
 * that must not be paid above, up (`ceil`) for one that must not be sold under. Null for text that is not a price.
 */
export function ticksFromUsd(text: string, units: PerpUnits, rounding: 'floor' | 'ceil'): bigint | null {
  const value = fractionOf(text)
  if (!value || value.num === 0n) return null
  const d = units.baseLotsDecimals
  const num = value.num * 1_000_000n * (d < 0 ? pow10(-d) : 1n)
  const den = value.den * BigInt(units.tickSize) * (d > 0 ? pow10(d) : 1n)
  const ticks = rounding === 'floor' ? num / den : (num + den - 1n) / den
  return ticks > 0n ? ticks : null
}

/** Ticks as dollars per one base unit — a float for the screen only, never sent back. */
export function usdFromTicks(ticks: bigint, units: PerpUnits): number {
  return (Number(ticks) * units.tickSize * 10 ** units.baseLotsDecimals) / 1_000_000
}

/** A size in the asset typed by a person, in whole base lots, rounded down: never more than typed. */
export function lotsFromUnits(text: string, baseLotsDecimals: number): bigint | null {
  const value = fractionOf(text)
  if (!value) return null
  const num = value.num * (baseLotsDecimals > 0 ? pow10(baseLotsDecimals) : 1n)
  const den = value.den * (baseLotsDecimals < 0 ? pow10(-baseLotsDecimals) : 1n)
  return num / den
}

/** Base lots as an exact decimal string of the asset. */
export function unitsTextFromLots(lots: bigint, baseLotsDecimals: number): string {
  if (baseLotsDecimals <= 0) return (lots * pow10(-baseLotsDecimals)).toString()
  return decimalText(lots, baseLotsDecimals)
}

/** `value / 10^scale` as a plain decimal without trailing zeros, sign kept. */
export function decimalText(value: bigint, scale: number): string {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const unit = pow10(scale)
  const whole = magnitude / unit
  const rest = scale > 0 ? (magnitude % unit).toString().padStart(scale, '0').replace(/0+$/, '') : ''
  return `${negative ? '-' : ''}${whole}${rest ? `.${rest}` : ''}`
}

/** A positive float as a plain decimal string a field and `ticksFromUsd` read (never «1e-7»). */
export function plainUsd(value: number | null | undefined, digits = 12): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  const text = value.toFixed(digits).replace(/\.?0+$/, '')
  return text === '0' ? null : text
}

/* ------------------------------------------------------------- the ticket */

/** What the ticket holds as the person typed it. `amount`: the position's notional in USD. */
export type TicketInput = Readonly<{
  side: PerpSide
  type: PerpOrderType
  amountUsd: string
  limitUsd: string
  tpUsd: string
  slUsd: string
  markUsd: number | null
  units: PerpUnits
  slippageBps?: number
}>

/** Why the ticket cannot ask for a Review yet — each a line of its own under the field it names. */
export type TicketBlock = 'amount' | 'belowMinimum' | 'price' | 'mark' | 'tp' | 'sl' | 'tpSide' | 'slSide'

/** The order the route builds from a ticket: lots and ticks as digits. */
export type OpenOrder = Readonly<{
  side: PerpSide
  type: PerpOrderType
  size: string
  price?: string
  slippageBps?: number
  tp?: string | null
  sl?: string | null
}>

export type TicketOrder =
  | Readonly<{ ok: true; order: OpenOrder; sizeUnits: string; notionalUsd: number; priceUsd: number }>
  | Readonly<{ ok: false; block: TicketBlock }>

/** Which side a position's take profit and stop loss sit on: above the mark for a long's take profit, below for its stop. */
export function legsSideOk(
  side: PerpSide,
  markUsd: number,
  tpUsd: number | null,
  slUsd: number | null,
): 'tpSide' | 'slSide' | null {
  if (tpUsd !== null && (side === 'long' ? !(tpUsd > markUsd) : !(tpUsd < markUsd))) return 'tpSide'
  if (slUsd !== null && (side === 'long' ? !(slUsd < markUsd) : !(slUsd > markUsd))) return 'slSide'
  return null
}

/**
 * A position's TP and SL in ticks, rounded toward the side each guards — a long's TP down and SL up, a short's the
 * other way: never past what was typed by more than a tick. Empty text is «none»; text that is not a price is undefined.
 */
export function legTicks(
  side: PerpSide,
  tpText: string,
  slText: string,
  units: PerpUnits,
): Readonly<{ tp: bigint | null | undefined; sl: bigint | null | undefined }> {
  const long = side === 'long'
  const read = (text: string, rounding: 'floor' | 'ceil') =>
    text.trim() === '' ? null : (ticksFromUsd(text, units, rounding) ?? undefined)
  return { tp: read(tpText, long ? 'floor' : 'ceil'), sl: read(slText, long ? 'ceil' : 'floor') }
}

/**
 * The ticket as the order the route builds. The amount is the position's notional in dollars; the size is that
 * notional at the order's price — the limit's, or for a market order the mark rounded up — down to the lot: never more
 * than typed. TP/SL ride with a market order only: a limit rests, and its legs are set on the position once it fills.
 */
export function ticketOrder(input: TicketInput): TicketOrder {
  const { units } = input
  const amount = fractionOf(input.amountUsd)
  if (!amount || amount.num === 0n) return { ok: false, block: 'amount' }
  let priceTicks: bigint | null
  if (input.type === 'limit') {
    /* A long's limit must not be paid above, a short's must not be sold under. */
    priceTicks = ticksFromUsd(input.limitUsd, units, input.side === 'long' ? 'floor' : 'ceil')
    if (priceTicks === null) return { ok: false, block: 'price' }
  } else {
    const mark = plainUsd(input.markUsd)
    priceTicks = mark === null ? null : ticksFromUsd(mark, units, 'ceil')
    if (priceTicks === null) return { ok: false, block: 'mark' }
  }
  /* lots = notional micro-dollars / (ticks × tickSize quote lots per lot), down. */
  const notionalMicro = (amount.num * 1_000_000n) / amount.den
  const lots = notionalMicro / (priceTicks * BigInt(units.tickSize))
  const priceUsd = usdFromTicks(priceTicks, units)
  if (lots <= 0n) return { ok: false, block: 'belowMinimum' }
  const notionalUsd = Number(lots * priceTicks * BigInt(units.tickSize)) / 1_000_000
  if (notionalUsd < MIN_ORDER_NOTIONAL_USD) return { ok: false, block: 'belowMinimum' }
  const sizeUnits = unitsTextFromLots(lots, units.baseLotsDecimals)
  if (input.type === 'limit') {
    return {
      ok: true,
      order: { side: input.side, type: 'limit', size: lots.toString(), price: priceTicks.toString() },
      sizeUnits,
      notionalUsd,
      priceUsd,
    }
  }
  const legs = legTicks(input.side, input.tpUsd, input.slUsd, units)
  if (legs.tp === undefined) return { ok: false, block: 'tp' }
  if (legs.sl === undefined) return { ok: false, block: 'sl' }
  if (input.markUsd !== null) {
    const wrong = legsSideOk(
      input.side,
      input.markUsd,
      legs.tp === null ? null : usdFromTicks(legs.tp, units),
      legs.sl === null ? null : usdFromTicks(legs.sl, units),
    )
    if (wrong) return { ok: false, block: wrong }
  }
  return {
    ok: true,
    order: {
      side: input.side,
      type: 'market',
      size: lots.toString(),
      slippageBps: input.slippageBps ?? DEFAULT_PERP_SLIPPAGE_BPS,
      tp: legs.tp === null ? null : legs.tp.toString(),
      sl: legs.sl === null ? null : legs.sl.toString(),
    },
    sizeUnits,
    notionalUsd,
    priceUsd,
  }
}

/** A share of a position, in whole lots, down to the lot; null when the share is less than one lot — never rounded up. */
export function shareLots(sizeUnits: number, percent: number, units: PerpUnits): bigint | null {
  if (!Number.isFinite(sizeUnits) || sizeUnits <= 0) return null
  const lots = lotsFromUnits(((sizeUnits * percent) / 100).toFixed(12), units.baseLotsDecimals) ?? 0n
  return lots > 0n ? lots : null
}

/** The order as the route takes it — the web's `OrderBody` (`orders-api.ts` on line A). */
export type OrderBody =
  | Readonly<{ kind: 'open'; owner: string; symbol: string } & OpenOrder>
  | Readonly<{ kind: 'reduce'; owner: string; symbol: string; size: string; close?: boolean; slippageBps?: number }>
  | Readonly<{ kind: 'protect'; owner: string; symbol: string; tp: string | null; sl: string | null }>
  | Readonly<{ kind: 'cancel'; owner: string; symbol: string; order: string }>

/* ------------------------------------------------------------ the margin */

/**
 * What the account may open now, in USD: the collateral free for new risk — Phoenix's account value less the margin its
 * positions and orders hold — times the market's first-tier leverage, under the first check's ceiling when there is
 * one. Null when a figure is missing: then no «Доступно» is said rather than guessed.
 */
export function buyingPowerUsd(
  margin: Readonly<{ portfolioUsd: number | null; initialMarginUsd: number | null }> | null | undefined,
  maxLeverage: number | null,
  ceilingUsd: number | null = null,
): number | null {
  if (!margin || margin.portfolioUsd === null || margin.initialMarginUsd === null) return null
  if (maxLeverage === null || !(maxLeverage > 0)) return null
  const free = margin.portfolioUsd - margin.initialMarginUsd
  const power = free > 0 ? free * maxLeverage : 0
  return ceilingUsd === null ? power : Math.min(power, ceilingUsd)
}

/**
 * How far the mark may move against a position before Phoenix liquidates it, in per cent of the mark: down for a long,
 * up for a short. 0 once the mark has crossed it; null without both prices.
 */
export function liquidationDistancePercent(
  side: PerpSide,
  markUsd: number | null,
  liquidationUsd: number | null,
): number | null {
  if (markUsd === null || liquidationUsd === null || !(markUsd > 0) || !(liquidationUsd > 0)) return null
  const room = side === 'long' ? markUsd - liquidationUsd : liquidationUsd - markUsd
  return Math.max(0, (room / markUsd) * 100)
}

/* -------------------------------------------------------- server answers */

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const positive = (value: unknown): number | null => {
  const parsed = finite(value)
  return parsed !== null && parsed > 0 ? parsed : null
}
const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
const DIGITS = /^\d{1,24}$/
const SIGNED_DECIMAL = /^-?\d{1,24}(\.\d{1,24})?$/

/**
 * What a wallet may do with orders now: closed, a canary with its notional ceiling, or open — and Ryntra's builder fee
 * in bps as the chain holds it (null — no builder, or the chain was not read: the ticket says «у Перевірці», never 0;
 * the Review reads it again and is the figure that counts).
 */
export type OrderStates = Readonly<{
  open: boolean
  maxNotionalUsd: number | null
  builder: boolean
  builderBps: number | null
}>

export const ORDERS_CLOSED_STATES: OrderStates = { open: false, maxNotionalUsd: null, builder: false, builderBps: null }

/** The gate's answer; anything but a plain «open: true» is closed. */
export function parseOrderStates(raw: unknown): OrderStates {
  if (!isObject(raw) || raw.open !== true) return ORDERS_CLOSED_STATES
  const builder = raw.builder === true
  const bps = finite(raw.builderBps)
  return {
    open: true,
    maxNotionalUsd: positive(raw.maxNotionalUsd),
    builder,
    builderBps: builder && bps !== null && Number.isInteger(bps) && bps >= 0 ? bps : null,
  }
}

export type PerpAfter = Readonly<{
  /** The position in the asset, signed: positive long, negative short, "0" flat. */
  positionUnits: string
  entryUsd: number | null
  positionValueUsd: number | null
  liquidationUsd: number | null
  leverage: number | null
  collateralUsd: number | null
  accountValueUsd: number | null
  collateralChangeUsd: number | null
  freeCollateralUsd: number | null
  initialMarginUsd: number | null
}>

export type OrderReview = Readonly<{
  kind: PerpOrderKind
  symbol: string
  side: PerpSide
  type: PerpOrderType
  sizeLots: string
  sizeUnits: string
  priceUsd: number | null
  markUsd: number | null
  slippageBps: number | null
  notionalUsd: number | null
  before: Readonly<{ liquidationUsd: number | null; initialMarginUsd: number | null }> | null
  after: PerpAfter | null
  fees: Readonly<{
    takerRate: number | null
    makerRate: number | null
    venueUsd: number | null
    builderBps: number
    builderUsd: number | null
  }>
  funding: Readonly<{ ratePercent: number; payer: PerpSide | null }> | null
  tpUsd: number | null
  slUsd: number | null
  clearsLegs: boolean
  order: Readonly<{ side: 'buy' | 'sell'; priceUsd: number | null; sizeUnits: string | null }> | null
  rentLamports: bigint
  networkFeeLamports: bigint
  traderAccount: string
  wireBase64: string
  ticket: string
  signableMs: number | null
}>

const KINDS: readonly PerpOrderKind[] = ['open', 'reduce', 'protect', 'cancel']
const lamports = (value: unknown): bigint | null =>
  typeof value === 'string' && DIGITS.test(value) ? BigInt(value) : null

function parseAfter(raw: unknown): PerpAfter | null {
  if (!isObject(raw) || typeof raw.positionUnits !== 'string' || !SIGNED_DECIMAL.test(raw.positionUnits)) return null
  return {
    positionUnits: raw.positionUnits,
    entryUsd: positive(raw.entryUsd),
    positionValueUsd: finite(raw.positionValueUsd),
    liquidationUsd: positive(raw.liquidationUsd),
    leverage: finite(raw.leverage),
    collateralUsd: finite(raw.collateralUsd),
    accountValueUsd: finite(raw.accountValueUsd),
    collateralChangeUsd: finite(raw.collateralChangeUsd),
    freeCollateralUsd: finite(raw.freeCollateralUsd),
    initialMarginUsd: finite(raw.initialMarginUsd),
  }
}

/**
 * The server's Review, read again: an answer without its bytes, its ticket or its kind is no Review at all (null — the
 * general refusal); a figure that is not a number is a dash. What is signed is the server's bytes, never rebuilt here.
 */
export function parseOrderReview(raw: unknown): OrderReview | null {
  if (!isObject(raw)) return null
  const kind = raw.kind as PerpOrderKind
  if (!KINDS.includes(kind)) return null
  if (raw.side !== 'long' && raw.side !== 'short') return null
  if (raw.type !== 'market' && raw.type !== 'limit') return null
  const symbol = text(raw.symbol)
  const transaction = isObject(raw.transaction) ? text(raw.transaction.wireBase64) : null
  const ticket = text(raw.ticket)
  const network = lamports(raw.networkFeeLamports)
  const rent = lamports(raw.rentLamports)
  if (!symbol || !transaction || !ticket || network === null || rent === null) return null
  /* The size the bytes trade is never guessed: an answer without it is no Review. */
  if (typeof raw.sizeUnits !== 'string' || !SIGNED_DECIMAL.test(raw.sizeUnits)) return null
  if (typeof raw.sizeLots !== 'string' || !DIGITS.test(raw.sizeLots)) return null
  const sizeUnits = raw.sizeUnits
  const fees = isObject(raw.fees) ? raw.fees : {}
  const builderBps = finite(fees.builderBps)
  const funding = isObject(raw.funding) ? raw.funding : null
  const fundingRate = funding ? finite(funding.ratePercent) : null
  const before = isObject(raw.before) ? raw.before : null
  const order = isObject(raw.order) && (raw.order.side === 'buy' || raw.order.side === 'sell') ? raw.order : null
  return {
    kind,
    symbol,
    side: raw.side,
    type: raw.type,
    sizeLots: raw.sizeLots,
    sizeUnits,
    priceUsd: positive(raw.priceUsd),
    markUsd: positive(raw.markUsd),
    slippageBps: finite(raw.slippageBps),
    notionalUsd: finite(raw.notionalUsd),
    before: before
      ? { liquidationUsd: positive(before.liquidationUsd), initialMarginUsd: finite(before.initialMarginUsd) }
      : null,
    after: parseAfter(raw.after),
    fees: {
      takerRate: finite(fees.takerRate),
      makerRate: finite(fees.makerRate),
      venueUsd: finite(fees.venueUsd),
      builderBps: builderBps !== null && builderBps > 0 ? builderBps : 0,
      builderUsd: finite(fees.builderUsd),
    },
    funding:
      fundingRate === null
        ? null
        : {
            ratePercent: fundingRate,
            payer: funding!.payer === 'long' || funding!.payer === 'short' ? funding!.payer : null,
          },
    tpUsd: positive(raw.tpUsd),
    slUsd: positive(raw.slUsd),
    clearsLegs: raw.clearsLegs === true,
    order: order
      ? {
          side: order.side as 'buy' | 'sell',
          priceUsd: positive(order.priceUsd),
          sizeUnits:
            typeof order.sizeUnits === 'string' && SIGNED_DECIMAL.test(order.sizeUnits) ? order.sizeUnits : null,
        }
      : null,
    rentLamports: rent,
    networkFeeLamports: network,
    traderAccount: text(raw.traderAccount) ?? '',
    wireBase64: transaction,
    ticket,
    signableMs: finite(raw.signableMs),
  }
}

/**
 * AG-2b, one press: is an order built again — its bytes aged before the wallet opened — the one the person pressed on,
 * and no worse? The same act, side, type and size, the same TP/SL; a limit at the same price; a market order's worst
 * price no further against the person; no higher fee of Ryntra's and no more SOL for the network. Then the wallet opens
 * on the fresh bytes by itself; otherwise the fresh «Перевірка» is shown to be read again.
 */
const noMore = (shown: number | null, fresh: number | null) =>
  shown === null ? fresh === null : fresh !== null && fresh <= shown

export function sameOrderNoWorse(shown: OrderReview, fresh: OrderReview): boolean {
  if (shown.kind !== fresh.kind || shown.side !== fresh.side || shown.type !== fresh.type) return false
  if (shown.symbol !== fresh.symbol || shown.sizeLots !== fresh.sizeLots) return false
  if (shown.tpUsd !== fresh.tpUsd || shown.slUsd !== fresh.slUsd || shown.clearsLegs !== fresh.clearsLegs) return false
  if (fresh.fees.builderBps > shown.fees.builderBps) return false
  if (!noMore(shown.fees.venueUsd, fresh.fees.venueUsd)) return false
  /* An open's or a TP/SL's liquidation no closer to the mark than the one read: no lower for a long, no higher for a short. */
  if (shown.kind === 'open' || shown.kind === 'protect') {
    const was = shown.after?.liquidationUsd ?? null
    const now = fresh.after?.liquidationUsd ?? null
    if ((was === null) !== (now === null)) return false
    if (was !== null && now !== null && (shown.side === 'long' ? now > was : now < was)) return false
  }
  if (fresh.networkFeeLamports + fresh.rentLamports > shown.networkFeeLamports + shown.rentLamports) return false
  if (shown.kind === 'cancel' || shown.kind === 'protect') return true
  if (shown.priceUsd === null || fresh.priceUsd === null) return false
  if (shown.kind === 'open' && shown.type === 'limit') return fresh.priceUsd === shown.priceUsd
  /* A market order buys for a long's open and a short's cut; it sells otherwise. */
  const buys = shown.kind === 'open' ? shown.side === 'long' : shown.side === 'short'
  return buys ? fresh.priceUsd <= shown.priceUsd : fresh.priceUsd >= shown.priceUsd
}

/** One fill of a landed order, by Phoenix's record of the transaction. */
export type PerpFill = Readonly<{
  sizeUnits: number
  priceUsd: number
  feeUsd: number | null
  realizedPnlUsd: number | null
}>

export type OrderRelayState = 'LANDED' | 'FAILED' | 'UNKNOWN' | 'NOT_SENT'

/** Where the one signature stands and — once landed — what Phoenix filled: absent until read, empty when nothing filled. */
export type OrderResult = Readonly<{ signature: string; state: OrderRelayState; fills?: readonly PerpFill[] | null }>

const STATES: readonly OrderRelayState[] = ['LANDED', 'FAILED', 'UNKNOWN', 'NOT_SENT']

function parseFills(raw: unknown): readonly PerpFill[] | null | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return null
  const fills: PerpFill[] = []
  for (const entry of raw) {
    /* One fill that cannot be read makes the sum unknown: never a partial fill said as the whole. */
    if (!isObject(entry)) return null
    const size = finite(entry.sizeUnits)
    const price = positive(entry.priceUsd)
    if (size === null || price === null) return null
    fills.push({
      sizeUnits: size,
      priceUsd: price,
      feeUsd: finite(entry.feeUsd),
      realizedPnlUsd: finite(entry.realizedPnlUsd),
    })
  }
  return fills
}

/** The relay's (or the status route's) first result, read again; null when it names no signature. */
export function parseOrderResult(raw: unknown): OrderResult | null {
  const results = isObject(raw) && Array.isArray(raw.results) ? raw.results : []
  const first = results[0]
  if (!isObject(first) || !text(first.signature)) return null
  const state = STATES.includes(first.state as OrderRelayState) ? (first.state as OrderRelayState) : 'UNKNOWN'
  const fills = parseFills(first.fills)
  return { signature: first.signature as string, state, ...(fills === undefined ? {} : { fills }) }
}

/** The fills of one signature summed: the size, the average price, the fees and the realised result. */
export function fillsSummary(
  fills: readonly PerpFill[],
): Readonly<{ sizeUnits: number; averageUsd: number | null; feeUsd: number | null; realizedPnlUsd: number | null }> {
  let size = 0
  let quote = 0
  let fee: number | null = 0
  let pnl: number | null = 0
  for (const fill of fills) {
    size += Math.abs(fill.sizeUnits)
    quote += Math.abs(fill.sizeUnits) * fill.priceUsd
    fee = fee === null || fill.feeUsd === null ? null : fee + fill.feeUsd
    pnl = pnl === null || fill.realizedPnlUsd === null ? null : pnl + fill.realizedPnlUsd
  }
  return {
    sizeUnits: size,
    averageUsd: size > 0 ? quote / size : null,
    feeUsd: fills.length ? fee : null,
    realizedPnlUsd: fills.length ? pnl : null,
  }
}

/** Does this order trade now — a market order, a cut, a close — so its receipt waits for Phoenix's fills too? */
export const tradesNow = (review: Pick<OrderReview, 'kind' | 'type'>): boolean =>
  review.kind === 'reduce' || (review.kind === 'open' && review.type === 'market')

/** Still to read: how it ended, or — landed, for an order that trades now — Phoenix's record of its fills. */
export const unsettled = (result: OrderResult, expectsFills: boolean): boolean =>
  result.state === 'UNKNOWN' || (expectsFills && result.state === 'LANDED' && result.fills == null)

/**
 * The relay's own refusals, every one given before anything was sent (the web's `ORDERS_REFUSED_BEFORE_SENDING`). Any
 * other answer after the wallet signed — no answer, a gateway's page, a code the phone does not know — may come after
 * a send: the outcome is the chain's to say, and the receipt asks it.
 */
export const ORDERS_REFUSED_BEFORE_SENDING: ReadonlySet<string> = new Set([
  'BAD_REQUEST',
  'TICKET_INVALID',
  'TICKET_EXPIRED',
  'ORDERS_CLOSED',
  'CANARY_LIMIT',
  'SIGNED_MISMATCH',
  'NOT_SIGNED',
  'RELAY_REFUSED',
  'UNAVAILABLE',
  'WALLET_MISMATCH',
  'RATE_LIMITED',
  'FORBIDDEN_ORIGIN',
  'UNAUTHORIZED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'BODY_REQUIRED',
  'BODY_TOO_LARGE',
  'INVALID_BODY_STREAM',
  'INVALID_CONTENT_LENGTH',
  'INVALID_JSON',
  'JSON_REQUIRED',
])

/** The refusals the phone says in words of their own; any other code is the general line. */
export const ORDER_FAILURES = [
  'ORDERS_CLOSED',
  'CANARY_LIMIT',
  'BELOW_MINIMUM',
  'LIMIT_FAR',
  'MARKET_GATED',
  'ISOLATED_ONLY',
  'ACCOUNT_NEEDED',
  'TRADING_CLOSED',
  'TP_SIDE',
  'SL_SIDE',
  'LEGS_SIDE',
  'PRICE_UNKNOWN',
  'NOT_FILLABLE',
  'NO_POSITION',
  'OVER_POSITION',
  'NO_ORDER',
  'NOTHING_TO_CHANGE',
  'NEEDS_SOL',
  'MARGIN_SHORT',
  'SIMULATION_FAILED',
  'BUILDER_UNAVAILABLE',
  'PHOENIX_UNAVAILABLE',
  'RELAY_REFUSED',
  'TICKET_EXPIRED',
  'WALLET_MISMATCH',
  'RATE_LIMITED',
] as const

export type OrderFailure =
  | (typeof ORDER_FAILURES)[number]
  | 'signIn'
  | 'network'
  | 'walletRefused'
  | 'walletCancelled'
  | 'walletTimeout'
  | 'walletCannotSign'
  | 'ledgerBlind'
  | 'txVersion'
  | 'reviewAged'
  | 'deviceConfirm'
  | 'outcomeUnknown'
  | 'general'

const KNOWN: ReadonlySet<string> = new Set(ORDER_FAILURES)

/** A route's code as the phone's failure; a code the phone does not know is the general line. */
export function orderFailureOf(code: string | null | undefined): OrderFailure {
  if (code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED' || code === 'SESSION_REVOKED') return 'signIn'
  return code && KNOWN.has(code) ? (code as OrderFailure) : 'general'
}
