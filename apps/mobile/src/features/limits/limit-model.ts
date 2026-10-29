/**
 * Spot limits on the phone (C3) — the web's B3, through the same server:
 * the routes under `/api/solana/limits/*` build, read, simulate, record and
 * relay; the phone shows what they answer and the wallet signs the exact
 * bytes the Review showed. The shapes here are the routes' own
 * (`lib/solana/limits/*` on line A); the arithmetic is only for what the
 * ticket shows before the Review — the price's distance from the market and
 * the amount it would get — never for what is signed. Pure.
 */

import { SOL_MINT, USDC_MINT, USDT_MINT } from '../../lib/api.ts'

export const LIMIT_SIDES = ['buy', 'sell'] as const
export type LimitSide = (typeof LIMIT_SIDES)[number]
export const LIMIT_VENUES = ['trigger', 'dlmm'] as const
export type LimitVenue = (typeof LIMIT_VENUES)[number]

export const LIMIT_STATES = ['PLACING', 'OPEN', 'PARTIAL', 'FILLED', 'CANCELLING', 'CANCELLED', 'EXPIRED', 'FAILED'] as const
export type LimitState = (typeof LIMIT_STATES)[number]

export const VENUE_NAME: Readonly<Record<LimitVenue, string>> = { trigger: 'Jupiter', dlmm: 'Meteora DLMM' }

/** What a limit is priced in, in the order a pair picks its quote: a dollar before SOL — the web's `SPOT_QUOTE_ASSETS`. */
export const LIMIT_QUOTES: readonly Readonly<{ mint: string; symbol: string; decimals: number }>[] = [
  { mint: USDC_MINT, symbol: 'USDC', decimals: 6 },
  { mint: USDT_MINT, symbol: 'USDT', decimals: 6 },
  { mint: SOL_MINT, symbol: 'SOL', decimals: 9 },
]

const KNOWN: Readonly<Record<string, Readonly<{ symbol: string; decimals: number }>>> = Object.fromEntries(
  LIMIT_QUOTES.map((quote) => [quote.mint, { symbol: quote.symbol, decimals: quote.decimals }]),
)

/** The quote a ticket on this token prices in: the one chosen, unless it is the token itself. */
export function quoteFor(baseMint: string, chosen: string): (typeof LIMIT_QUOTES)[number] {
  const picked = LIMIT_QUOTES.find((quote) => quote.mint === chosen) ?? LIMIT_QUOTES[0]!
  return picked.mint !== baseMint ? picked : (LIMIT_QUOTES.find((quote) => quote.mint !== baseMint) ?? LIMIT_QUOTES[0]!)
}

/**
 * The market ticket's sum carried into the limit (ST-5), only where it is in the limit amount's own units: a sale's
 * sum is the token's on both; a purchase's is the quote it is paid with, kept as the limit's quote when the limit
 * prices in it (USDC, USDT, SOL). Anything else starts empty — never a sum read in another token's units.
 */
export function carriedAmount(
  input: Readonly<{ side: LimitSide; assetMint: string; typed: Readonly<{ mint: string; text: string }> | null }>,
): Readonly<{ text: string; quoteMint: string | null }> | null {
  const { side, assetMint, typed } = input
  if (!typed || !/[1-9]/.test(typed.text)) return null
  if (side === 'sell') return typed.mint === assetMint ? { text: typed.text, quoteMint: null } : null
  const quote = LIMIT_QUOTES.find((entry) => entry.mint === typed.mint)
  return quote && quote.mint !== assetMint ? { text: typed.text, quoteMint: quote.mint } : null
}

export type LimitMarket = Readonly<{
  price: number | null
  baseUsd: number | null
  quoteUsd: number | null
  dlmm:
    | Readonly<{ available: true; pool: string; name: string; activePrice: number; binStep: number }>
    | Readonly<{ available: false; code: string }>
  observedAt?: string
}>

export type LimitPair = Readonly<{ baseMint: string; baseDecimals: number; quoteMint: string; quoteDecimals: number }>

export type LimitReview = Readonly<{
  venue: LimitVenue
  side: LimitSide
  order: string
  requestId: string | null
  pool: string | null
  transactionBase64: string
  pair: LimitPair
  inputMint: string
  outputMint: string
  makingRaw: string
  takingRaw: string
  price: string
  fillPrice: number
  fee: Readonly<{
    ryntraBps: number
    venueBps: number
    ryntraFeeRaw: string
    venueFeeRaw: string
    reason: string
    account: string | null
  }>
  networkFeeLamports: number
  depositLamports: number | null
  makerFeeShare: boolean
  builtAt: string
}>

export type LimitFill = Readonly<{ signature: string; inputRaw: string; outputRaw: string; feeRaw: string; at: string }>

export type LimitOrder = Readonly<{
  key: string
  venue: LimitVenue
  order: string
  side: LimitSide
  baseMint: string
  quoteMint: string
  inputMint: string
  outputMint: string
  makingRaw: string
  takingRaw: string
  filledInputRaw: string
  filledOutputRaw: string
  ryntraFeeRaw: string
  ryntraBps: number
  fillPrice: number | null
  state: LimitState
  placeSignature: string | null
  cancelSignature: string | null
  fills: readonly LimitFill[]
  createdAt: string
  updatedAt: string
  throughRyntra: boolean
  canCancel: boolean
  canClaim: boolean
  pool: string | null
}>

export type LimitToken = Readonly<{ symbol: string | null; decimals: number | null }>

export type LimitOrders = Readonly<{ orders: readonly LimitOrder[]; tokens: Readonly<Record<string, LimitToken>>; complete: boolean }>

export type LimitSubmitAnswer = Readonly<{ state: string; signature: string; settled: boolean }>

/** Six significant digits, the way a price is typed — never an exponent (the web's `typedPrice`). */
export function typedPrice(value: number): string {
  if (!(value > 0) || !Number.isFinite(value)) return ''
  const digits = Math.min(Math.max(0, 6 - Math.floor(Math.log10(value)) - 1), 18)
  const fixed = value.toFixed(digits)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return trimmed === '0' ? '' : trimmed
}

/** Raw units as a plain decimal string, trailing zeros trimmed. */
export function rawToDecimal(raw: bigint | string, decimals: number): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw)
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals).replace(/0+$/, '') : ''
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/** A typed decimal as the route takes it: digits and one point, the comma read as a point; null when it is not one. */
export function plainDecimal(text: string): string | null {
  const value = text.trim().replace(/,/g, '.')
  if (!/^\d{1,18}(?:\.\d{1,18})?$/.test(value)) return null
  return Number(value) > 0 ? value : null
}

/** Whether a limit price would fill at once against the market — a market order in disguise. */
export function crossesMarket(side: LimitSide, price: number, marketPrice: number): boolean {
  if (!(price > 0) || !(marketPrice > 0)) return false
  return side === 'buy' ? price >= marketPrice : price <= marketPrice
}

/** How far the limit sits from the market, per cent, signed: below the market negative. */
export function distanceFromMarket(price: number, marketPrice: number): number | null {
  if (!(price > 0) || !(marketPrice > 0)) return null
  return ((price - marketPrice) / marketPrice) * 100
}

/** One tap away from the market on the person's side: below it for a buy, above it for a sale. */
export const PRICE_OFFSETS = [1, 2, 5] as const

export function offsetPrice(side: LimitSide, step: number, marketPrice: number): string {
  return typedPrice(marketPrice * (1 + (side === 'buy' ? -step : step) / 100))
}

/** What the ticket would get at its price before the Review — the Review's own figure replaces it. */
export function estimatedOut(side: LimitSide, amount: number, price: number): number | null {
  if (!(amount > 0) || !(price > 0)) return null
  return side === 'buy' ? amount / price : amount * price
}

export type TicketBlock = 'price' | 'amount' | 'crosses' | 'balance' | null

/** Why the ticket cannot be reviewed yet, the first reason only; null when it can. */
export function ticketBlock(input: Readonly<{ side: LimitSide; price: string; amount: string; marketPrice: number | null; spendable: number | null }>): TicketBlock {
  const price = plainDecimal(input.price)
  if (!price) return 'price'
  const amount = plainDecimal(input.amount)
  if (!amount) return 'amount'
  if (input.marketPrice !== null && crossesMarket(input.side, Number(price), input.marketPrice)) return 'crosses'
  if (input.spendable !== null && Number(amount) > input.spendable) return 'balance'
  return null
}

export function decimalsOf(tokens: Readonly<Record<string, LimitToken>>, mint: string): number | null {
  return tokens[mint]?.decimals ?? KNOWN[mint]?.decimals ?? null
}

export function symbolOf(tokens: Readonly<Record<string, LimitToken>>, mint: string): string {
  return tokens[mint]?.symbol ?? KNOWN[mint]?.symbol ?? `${mint.slice(0, 4)}…`
}

/** The orders that can still fill — what the count and «Скасувати» are about. */
export const OPEN_STATES: ReadonlySet<LimitState> = new Set(['PLACING', 'OPEN', 'PARTIAL', 'CANCELLING'])

export function isOpen(order: Pick<LimitOrder, 'state'>): boolean {
  return OPEN_STATES.has(order.state)
}

export function openCount(orders: readonly LimitOrder[], baseMint?: string | null): number {
  return orders.filter((order) => isOpen(order) && (baseMint == null || order.baseMint === baseMint)).length
}

/** Quote per base the order fills at: the reviewed one when Ryntra placed it, else the two amounts' ratio. */
export function orderPrice(order: LimitOrder, tokens: Readonly<Record<string, LimitToken>>): number | null {
  if (order.fillPrice !== null && Number.isFinite(order.fillPrice) && order.fillPrice > 0) return order.fillPrice
  const base = decimalsOf(tokens, order.baseMint)
  const quote = decimalsOf(tokens, order.quoteMint)
  if (base == null || quote == null) return null
  const making = Number(order.makingRaw)
  const taking = Number(order.takingRaw)
  if (!(making > 0) || !(taking > 0)) return null
  const price = order.side === 'buy' ? making / 10 ** quote / (taking / 10 ** base) : taking / 10 ** quote / (making / 10 ** base)
  return Number.isFinite(price) && price > 0 ? price : null
}

/** A raw amount of a token as a number, or null when its scale is not known — a dash, never a guess. */
export function amountOf(raw: string, mint: string, tokens: Readonly<Record<string, LimitToken>>): number | null {
  const decimals = decimalsOf(tokens, mint)
  if (decimals == null) return null
  const value = Number(rawToDecimal(raw, decimals))
  return Number.isFinite(value) ? value : null
}

/** The order list as the web sorts it: waiting first, this market's before others', newest first within each. */
export function sortOrders(orders: readonly LimitOrder[], marketMint: string | null = null): LimitOrder[] {
  return [...orders].sort((a, b) => {
    const open = Number(isOpen(b)) - Number(isOpen(a))
    if (open !== 0) return open
    const here = Number(b.baseMint === marketMint) - Number(a.baseMint === marketMint)
    if (here !== 0) return here
    return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
  })
}

export type StateTone = 'live' | 'done' | 'quiet' | 'bad'

/** The tone each state reads in: a fill is a success, a failure the one red, waiting the live one. */
export const STATE_TONE: Readonly<Record<LimitState, StateTone>> = {
  PLACING: 'live',
  OPEN: 'live',
  PARTIAL: 'live',
  CANCELLING: 'live',
  FILLED: 'done',
  CANCELLED: 'quiet',
  EXPIRED: 'quiet',
  FAILED: 'bad',
}

/** The transaction an order's row opens: its last fill, else its cancellation, else its placement. */
export function orderSignature(order: LimitOrder): string | null {
  return order.fills.at(-1)?.signature ?? order.cancelSignature ?? order.placeSignature
}

export type LimitFailureKey =
  | 'walletRefused'
  | 'walletTimeout'
  | 'walletCancelled'
  | 'walletSilent'
  | 'reviewClosed'
  | 'bytesRebuilt'
  | 'deviceConfirm'
  | 'walletCannotSign'
  | 'ledgerBlind'
  | 'txVersion'
  | 'rateLimited'
  | 'paused'
  | 'belowMinimum'
  | 'crosses'
  | 'noPool'
  | 'simulation'
  | 'notCancellable'
  | 'network'
  | 'signIn'
  | 'notPlaced'
  | 'notCancelled'
  | 'general'

/** A refusal by its code — the routes answer in English for logs; the screen speaks by the code, as the web's `limitFailureText`. */
export function limitFailureKey(code: string | null | undefined): LimitFailureKey {
  switch (code) {
    case 'WALLET_REFUSED':
      return 'walletRefused'
    case 'RATE_LIMITED':
      return 'rateLimited'
    case 'SWAP_PAUSED':
      return 'paused'
    case 'BELOW_MINIMUM':
      return 'belowMinimum'
    case 'CROSSES_MARKET':
      return 'crosses'
    case 'NO_LIMIT_POOL':
    case 'NO_POOL':
      return 'noPool'
    case 'SIMULATION_FAILED':
      return 'simulation'
    case 'NOT_CANCELLABLE':
      return 'notCancellable'
    case 'NETWORK':
      return 'network'
    // The bearer is dead on the server (`needsSignIn`): only a new signature brings one back.
    case 'UNAUTHORIZED':
    case 'SESSION_EXPIRED':
    case 'SESSION_REVOKED':
      return 'signIn'
    default:
      return 'general'
  }
}
