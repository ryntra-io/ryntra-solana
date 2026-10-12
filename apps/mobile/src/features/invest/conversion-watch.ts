/**
 * The IPO and conversion watch on the phone — Ryntra does not let a token burn
 * (as the web app does it).
 *
 * When a private company goes public, its PreStocks token must be swapped
 * before the issuer's cut-off, or it expires worthless. The server states the
 * window on the token's own row: `lifecycle` (`conversion-open`, the issuer's
 * deadline and its notice) and `companyPath.swap` (the listed token the issuer
 * points the swap to, 1.17.0). This module turns that into what a person
 * reads — the line before any figure, the holder's one action «Обміняти на
 * SpaceX (SPCXx)» and the quiet «Продати за USDC» — and into the swap's own
 * figures: how much of what the wallet holds, the four rows of «Перевірка»,
 * the rate the live quote gives against the company's price. The swap is an
 * ordinary swap at the live quote — the issuer's own word: «conversion happens
 * through normal trading» — so no ratio is promised, only the one the quote
 * gives is said.
 *
 * The words are the web's own (`lib/stocks/conversion-watch.ts`), so the phone
 * and ryntra.io say the same thing. The date is the deadline's own day in UTC
 * — never later than the cut-off wherever it is read; the issuer's minute
 * stands only under «Деталі». Pure: no fetch, no clock of its own, no React.
 */

import type { StockRow } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'
import { DASH, formatPrice } from '../../utils/format.ts'
import type { TradeContext } from '../trade/trade-model.ts'
import {
  approxUsd,
  buyCosts,
  dollarsText,
  feePercentText,
  formatShareUnits,
  NO_FEE_CAP_RAW,
  unitsFromRaw,
  type BuyOrderFigures,
  type IssuerFee,
} from './buy-model.ts'

const numberTag = (locale: Locale): string => (locale === 'uk' ? 'uk-UA' : 'en-US')

/* ---- the event, from the token's row ---- */

/** A token the issuer points the swap to, or the one being swapped: its address, its symbol, the company. */
export type EventToken = Readonly<{ mint: string; symbol: string; company: string }>

/**
 * An issuer's window to swap a token before its cut-off, as the phone reads it
 * from the stock routes — today PreStocks' SPACEX, until 23:59 UTC on 12 March
 * 2027, into xStocks' SPCXx.
 */
export type IssuerEvent = Readonly<{
  /** The token to swap, by its address and its symbol as the issuer names it («SPACEX»). */
  mint: string
  symbol: string
  /** The company, as a person names it («SpaceX»). */
  company: string
  /** Why the window opened: the company went public; null where the answer does not say. */
  cause: 'ipo' | null
  /** The listed token the issuer points the swap to — the one action's target; null where the answer names none. */
  into: EventToken | null
  /** The issuer's own cut-off, ISO. */
  deadline: string
  /** The server's word when it answered: the window was open. The clock decides after that (`windowOpen`). */
  open: boolean
  /** The issuer's own notice; null where the answer gives none. */
  noticeUrl: string | null
}>

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const SYMBOL = /^[A-Za-z0-9._-]{1,32}$/

const isInstant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

function isPathToken(value: unknown): value is Readonly<{ mint: string; symbol: string }> {
  if (!value || typeof value !== 'object') return false
  const token = value as Record<string, unknown>
  return (
    typeof token.mint === 'string' &&
    MINT.test(token.mint) &&
    typeof token.symbol === 'string' &&
    SYMBOL.test(token.symbol)
  )
}

/**
 * The event a stock row states about its own token, or null: the private
 * token's swap from `companyPath.swap` (its target, its cut-off, the IPO it
 * followed), else a window `lifecycle` states with a cut-off and no target.
 * The listed token the swap goes into carries the same path, but the swap is
 * not its own — it has no event. `company` is the name the page already says.
 */
export function eventOfRow(row: StockRow, company: string): IssuerEvent | null {
  const mint = row.representation.mint
  const lifecycle = row.lifecycle ?? null
  const url = lifecycle?.url
  const noticeUrl = typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url) ? url : null
  const swap = row.companyPath?.swap ?? null
  if (swap && isPathToken(swap.from) && swap.from.mint === mint && isPathToken(swap.into) && isInstant(swap.deadline)) {
    const ipo = (row.companyPath?.steps ?? []).some((step) => step.step === 'ipo' && step.state === 'passed')
    return {
      mint,
      symbol: swap.from.symbol,
      company,
      cause: ipo ? 'ipo' : null,
      into: { mint: swap.into.mint, symbol: swap.into.symbol, company },
      deadline: swap.deadline,
      open: swap.open === true && lifecycle?.state !== 'expired',
      noticeUrl,
    }
  }
  if (
    lifecycle &&
    (lifecycle.state === 'conversion-open' || lifecycle.state === 'expired') &&
    isInstant(lifecycle.deadline)
  )
    return {
      mint,
      symbol: row.representation.symbol,
      company,
      cause: null,
      into: null,
      deadline: lifecycle.deadline,
      open: lifecycle.state === 'conversion-open',
      noticeUrl,
    }
  return null
}

/** Whether the window is open now: the server said so, and the cut-off has not passed on this clock. */
export function windowOpen(event: IssuerEvent, nowMs: number): boolean {
  return event.open && Date.parse(event.deadline) > nowMs
}

/** The event about one token, among those a read found — by its address. */
export function eventFor(events: readonly IssuerEvent[] | null | undefined, mint: string): IssuerEvent | null {
  return events?.find((event) => event.mint === mint) ?? null
}

/** An event kept on the device, read back defensively: anything else is none. */
export function isIssuerEvent(value: unknown): value is IssuerEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  const into = event.into
  return (
    typeof event.mint === 'string' &&
    MINT.test(event.mint) &&
    typeof event.symbol === 'string' &&
    SYMBOL.test(event.symbol) &&
    typeof event.company === 'string' &&
    event.company.length > 0 &&
    (event.cause === 'ipo' || event.cause === null) &&
    (into === null || (isPathToken(into) && typeof (into as Record<string, unknown>).company === 'string')) &&
    isInstant(event.deadline) &&
    typeof event.open === 'boolean' &&
    (event.noticeUrl === null || (typeof event.noticeUrl === 'string' && /^https:\/\//.test(event.noticeUrl)))
  )
}

/* ---- the words ---- */

const UK_MONTHS = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
] as const
const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** «12 березня 2027» · «March 12, 2027» — the deadline's own day in UTC. */
export function deadlineDay(deadlineIso: string, locale: Locale): string {
  const at = new Date(deadlineIso)
  const day = at.getUTCDate()
  const month = at.getUTCMonth()
  const year = at.getUTCFullYear()
  return locale === 'uk' ? `${day} ${UK_MONTHS[month]} ${year}` : `${EN_MONTHS[month]} ${day}, ${year}`
}

/** «23:59 UTC, 12 березня 2027» — the issuer's minute, for «Деталі» only. */
export function deadlineExact(deadlineIso: string, locale: Locale): string {
  const at = new Date(deadlineIso)
  const time = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')} UTC`
  return `${time}, ${deadlineDay(deadlineIso, locale)}`
}

/** «SpaceX вийшла на біржу.» — why the window opened; null where the answer does not say. */
export function causeLine(event: IssuerEvent, locale: Locale): string | null {
  if (event.cause !== 'ipo') return null
  return locale === 'uk' ? `${event.company} вийшла на біржу.` : `${event.company} has gone public.`
}

export type EventAudience = 'holder' | 'everyone' | 'buyer'

/**
 * The event's one line: a holder is told to swap — «SpaceX
 * вийшла на біржу. Обміняй SPACEX до 12 березня 2027 — після строку токен
 * згорить.» — everyone else reads that the token must be swapped, and a
 * buyer, before a purchase, that the token bought must be. A closed window
 * says so: the deadline passed, the issuer no longer supports the token.
 */
export function eventLine(event: IssuerEvent, audience: EventAudience, locale: Locale, nowMs: number): string {
  const cause = causeLine(event, locale)
  const lead = cause ? `${cause} ` : ''
  const day = deadlineDay(event.deadline, locale)
  const { symbol } = event
  if (!windowOpen(event, nowMs))
    return locale === 'uk'
      ? `${lead}Строк обміну ${symbol} минув ${day} — емітент більше не підтримує токен.`
      : `${lead}The swap deadline for ${symbol} passed on ${day} — the issuer no longer supports the token.`
  if (locale === 'uk') {
    const ask =
      audience === 'holder'
        ? `Обміняй ${symbol} до ${day}`
        : audience === 'buyer'
          ? `Куплений ${symbol} треба обміняти до ${day}`
          : `${symbol} треба обміняти до ${day}`
    return `${lead}${ask} — після строку токен згорить.`
  }
  const ask =
    audience === 'holder'
      ? `Swap ${symbol} by ${day}`
      : audience === 'buyer'
        ? `${symbol} you buy must be swapped by ${day}`
        : `${symbol} must be swapped by ${day}`
  return `${lead}${ask} — after the deadline the token expires worthless.`
}

/** The event in a few words, for a row that has room for a label only: «Обміняй до 12 березня 2027» · «Строк обміну минув». */
export function shortEventLine(event: IssuerEvent, locale: Locale, nowMs: number): string {
  if (!windowOpen(event, nowMs)) return locale === 'uk' ? 'Строк обміну минув' : 'Swap deadline passed'
  const day = deadlineDay(event.deadline, locale)
  return locale === 'uk' ? `Обміняй до ${day}` : `Swap by ${day}`
}

/** «Обміняти на SpaceX (SPCXx)» — the one action; null when the issuer names no target Ryntra offers. */
export function swapActionWord(event: IssuerEvent, locale: Locale): string | null {
  if (!event.into) return null
  return locale === 'uk'
    ? `Обміняти на ${event.into.company} (${event.into.symbol})`
    : `Swap for ${event.into.company} (${event.into.symbol})`
}

/** «Продати за USDC» — the quiet second action. */
export const SELL_FOR_USDC: Readonly<Record<Locale, string>> = { en: 'Sell for USDC', uk: 'Продати за USDC' }

/* ---- how much of what the wallet holds ---- */

/** The swap takes all, half or a quarter of what the wallet holds (the web's own three). */
export const CONVERT_SHARES_PCT = [100, 50, 25] as const
export type ConvertShare = (typeof CONVERT_SHARES_PCT)[number]

/** A share of a balance, raw — never rounded up; null when it is nothing. */
export function shareRaw(heldRaw: bigint | null, pct: number): bigint | null {
  if (heldRaw === null || heldRaw <= 0n || !Number.isInteger(pct) || pct <= 0 || pct > 100) return null
  const part = (heldRaw * BigInt(pct)) / 100n
  return part > 0n ? part : null
}

/** A raw amount as the exact decimal text Trade's amount takes — every place kept, so it reads back to the same raw. */
export function rawDecimalText(raw: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals <= 0) return raw.toString()
  const digits = raw.toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

/* ---- the swap's figures ---- */

export type ConvertMode = 'swap' | 'sell'

/**
 * The company's price the rate is said against: its share on the exchange, as
 * the listed token's issuer states it — or, while that is unread, the listed
 * token's own price, named as that.
 */
export type ListedPrice = Readonly<{ usd: number; basis: 'exchange' | 'token'; symbol: string }>

/**
 * The listed price from the target's own figures: the issuer's reference per
 * share first, then the listed token's price — each carrying the listed
 * token's symbol, so a sale into dollars names it too.
 */
export function listedPriceOf(
  referencePerShare: number | null | undefined,
  tokenPriceUsd: number | null | undefined,
  symbol: string,
): ListedPrice | null {
  if (typeof referencePerShare === 'number' && Number.isFinite(referencePerShare) && referencePerShare > 0)
    return { usd: referencePerShare, basis: 'exchange', symbol }
  if (typeof tokenPriceUsd === 'number' && Number.isFinite(tokenPriceUsd) && tokenPriceUsd > 0)
    return { usd: tokenPriceUsd, basis: 'token', symbol }
  return null
}

/**
 * What one token brings, and how far that is from the company's price: a swap
 * gives so many of the listed token for one private token — against one share
 * at the listed price — and a sale so many dollars. Null without both legs.
 */
export function convertRate(
  input: Readonly<{ mode: ConvertMode; inUnits: number | null; outUnits: number | null; listed: ListedPrice | null }>,
): Readonly<{ perToken: number; gapPct: number | null }> | null {
  const { inUnits, outUnits, listed } = input
  if (inUnits === null || outUnits === null || !(inUnits > 0) || !(outUnits >= 0)) return null
  const perToken = outUnits / inUnits
  const perTokenUsd = input.mode === 'swap' ? (listed ? perToken * listed.usd : null) : perToken
  const gapPct = perTokenUsd !== null && listed ? (perTokenUsd / listed.usd - 1) * 100 : null
  return { perToken, gapPct }
}

/** «на 21% менше, ніж ціна SpaceX на біржі ($148,57)» — the gap as a person reads it; null without a listed price. */
export function gapLine(
  gapPct: number | null,
  listed: ListedPrice | null,
  company: string,
  locale: Locale,
): string | null {
  if (gapPct === null || !listed || !Number.isFinite(gapPct)) return null
  const size = Math.abs(gapPct)
  const pct = `${new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: size >= 10 ? 0 : 1 }).format(size)}%`
  const price = formatPrice(listed.usd, locale)
  const exchange = listed.basis === 'exchange'
  if (locale === 'uk') {
    const of = exchange ? `ціна ${company} на біржі` : `ціна ${listed.symbol}`
    if (size < 0.5) return `≈ як ${of} (${price})`
    return `на ${pct} ${gapPct < 0 ? 'менше' : 'більше'}, ніж ${of} (${price})`
  }
  const of = exchange ? `${company}’s price on the exchange` : `the price of ${listed.symbol}`
  if (size < 0.5) return `≈ ${of} (${price})`
  return `${pct} ${gapPct < 0 ? 'below' : 'above'} ${of} (${price})`
}

/**
 * The issuer's fee on a swap or a sale, in dollars: the mint withholds it from
 * the token that leaves the wallet — its share of what the route values the
 * input at, under the mint's cap where it has one.
 */
export function saleIssuerFeeUsd(
  input: Readonly<{ fee: IssuerFee | null; inUsd: number | null; inAmountRaw: string | null }>,
): number | null {
  const { fee, inUsd } = input
  if (!fee || inUsd === null || !Number.isFinite(inUsd) || inUsd <= 0) return null
  let usd = (inUsd * fee.basisPoints) / 10_000
  const cap = fee.maximumFeeRaw
  const leaves = input.inAmountRaw && /^\d+$/.test(input.inAmountRaw) ? Number(input.inAmountRaw) : 0
  if (cap && /^\d+$/.test(cap) && cap !== NO_FEE_CAP_RAW && leaves > 0)
    usd = Math.min(usd, (inUsd * Number(cap)) / leaves)
  return usd
}

const numeric = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/* ---- «Перевірка» — four rows ---- */

export type ConvertRowKey = 'give' | 'get' | 'costs' | 'rate'

export type ConvertRow = Readonly<{
  key: ConvertRowKey
  value: string
  /** The issuer's own fee inside «Усі витрати», a line of its own; null on every other row. */
  fee: string | null
  /** A quieter line: what leaves in dollars, the least that arrives, the account's reserve, the gap to the company's price. */
  sub: string | null
}>

export type ConvertRowWords = Readonly<{
  atLeast: string
  reserve: (usd: string) => string
  issuerFee: (pct: string, usd: string | null) => string
}>

/** The swap's target as the Review names it: the listed token, the company, its multiplier. */
export type ConvertTarget = Readonly<{ mint: string; symbol: string; company: string; multiplier: number | null }>

/**
 * «Перевірка» of a swap or a sale — **Віддаєш · Отримаєш · Усі витрати ·
 * Курс** — from the exact order the server built: what leaves the wallet in
 * the unit the wallet shows (through the token's multiplier) with its dollar
 * value, what arrives and the least that may, everything it costs with the
 * issuer's fee on its own line and the account's one-time reserve apart, and
 * the rate the live quote gives against the company's price ( * «ціну обміну показує чесно»). Always four, in that order; unknown is a dash.
 */
export function convertReviewRows(
  input: Readonly<{
    mode: ConvertMode
    order: BuyOrderFigures
    token: Readonly<{ symbol: string; multiplier: number | null }>
    giveDecimals: number
    getDecimals: number | null
    /** The listed token a swap lands in; null for a sale into USDC. */
    target: ConvertTarget | null
    listed: ListedPrice | null
    /** The company, for the rate's gap. */
    company: string
    issuerFee: IssuerFee | null
    solUsd: number | null
    locale: Locale
    words: ConvertRowWords
  }>,
): readonly [ConvertRow, ConvertRow, ConvertRow, ConvertRow] {
  const { order, locale, words, token, target } = input
  const swap = input.mode === 'swap' && target !== null
  const inUnits = unitsFromRaw(order.inAmountRaw, input.giveDecimals, token.multiplier)
  const outUnits = unitsFromRaw(order.outAmountRaw, input.getDecimals, swap ? target.multiplier : null)
  const least = unitsFromRaw(order.minReceivedRaw, input.getDecimals, swap ? target.multiplier : null)
  const inUsd = numeric(order.inUsdValue)
  const costs =
    inUsd === null
      ? null
      : buyCosts({
          spendUsd: inUsd,
          inUsdValue: order.inUsdValue,
          outUsdValue: order.outUsdValue,
          totalFeeBasisPoints: order.totalFeeBasisPoints,
          issuerFeeBps: input.issuerFee?.basisPoints ?? null,
          priceImpactPct: order.priceImpactPct,
          signatureFeeLamports: order.signatureFeeLamports,
          priorityFeeLamports: order.priorityFeeLamports,
          rentFeeLamports: order.rentFeeLamports,
          solUsd: input.solUsd,
        })
  const feeUsd = saleIssuerFeeUsd({ fee: input.issuerFee, inUsd, inAmountRaw: order.inAmountRaw })
  const rate = convertRate({ mode: input.mode, inUnits, outUnits, listed: input.listed })
  const targetWord = swap ? `${target.company} (${target.symbol})` : 'USDC'
  return [
    {
      key: 'give',
      value: inUnits === null ? DASH : `${formatShareUnits(inUnits, locale)} ${token.symbol}`,
      fee: null,
      sub: inUsd === null ? null : approxUsd(inUsd, locale),
    },
    {
      key: 'get',
      value:
        outUnits === null
          ? DASH
          : swap
            ? `≈ ${formatShareUnits(outUnits, locale)} ${targetWord}`
            : `≈ ${dollarsText(outUnits, locale)} USDC`,
      fee: null,
      sub:
        least === null
          ? null
          : `${words.atLeast} ${swap ? formatShareUnits(least, locale) : dollarsText(least, locale)}`,
    },
    {
      key: 'costs',
      value: costs ? approxUsd(costs.totalUsd, locale) : DASH,
      fee: input.issuerFee
        ? words.issuerFee(
            feePercentText(input.issuerFee.basisPoints, locale),
            feeUsd === null ? null : approxUsd(feeUsd, locale),
          )
        : null,
      // The account the swap opens for the new token: its own line, never a cost — it stays in the wallet.
      sub: costs?.accountUsd ? words.reserve(approxUsd(costs.accountUsd, locale)) : null,
    },
    {
      key: 'rate',
      value: !rate
        ? DASH
        : swap
          ? `1 ${token.symbol} → ${formatShareUnits(rate.perToken, locale)} ${target.symbol}`
          : `1 ${token.symbol} → ${formatPrice(rate.perToken, locale)}`,
      fee: null,
      sub: rate ? gapLine(rate.gapPct, input.listed, input.company, locale) : null,
    },
  ]
}

/* ---- what the server's answer means ---- */

/** Whether a Review or an attempt is this token's swap or sale into this target — the one the sheet shows as its own. */
export function isConvert(context: TradeContext | null | undefined, mint: string, receiveMint: string): boolean {
  return Boolean(
    context && context.mode === 'sell' && context.pay.mint === mint && context.receive.mint === receiveMint,
  )
}

/* ---- the sheet's one action ---- */

export type ConvertAction =
  /** An open Review nobody signed holds the wallet: release it, then ask again. */
  | Readonly<{ kind: 'release' }>
  | Readonly<{ kind: 'connect' }>
  | Readonly<{ kind: 'sign-in' }>
  /** The wallet's balance of the token, or the token's decimals, are not read yet. */
  | Readonly<{ kind: 'reading' }>
  /** The wallet holds none of the token: nothing to swap or sell. */
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'preparing' }>
  | Readonly<{ kind: 'need-sol' }>
  | Readonly<{ kind: 'unavailable' }>
  /** The share on screen is not priced yet: the button names the Review and waits. */
  | Readonly<{ kind: 'pricing' }>
  | Readonly<{ kind: 'review' }>

/**
 * The one orange button of the swap's sheet, by what stands between the
 * person and a Review — in the order a person meets it: a Review held open
 * elsewhere, the wallet, the wallet's read of the token, a wallet that holds
 * none (said before any signature is asked for: there is nothing to sign), the
 * session, the network fee, the route's own availability, the price of the
 * share on screen. Only `review` asks the server for a Review.
 */
export function convertAction(
  input: Readonly<{
    lockedReview: boolean
    connected: boolean
    signedIn: boolean
    /** What the wallet holds of the token, raw; null while it is not read. */
    heldRaw: bigint | null
    decimalsKnown: boolean
    preparing: boolean
    needsSol: boolean
    unavailable: boolean
    /** The share on screen has a live quote. */
    priced: boolean
  }>,
): ConvertAction {
  if (input.lockedReview) return { kind: 'release' }
  if (!input.connected) return { kind: 'connect' }
  if (input.heldRaw === null || !input.decimalsKnown) return { kind: 'reading' }
  if (input.heldRaw <= 0n) return { kind: 'none' }
  if (!input.signedIn) return { kind: 'sign-in' }
  if (input.preparing) return { kind: 'preparing' }
  if (input.needsSol) return { kind: 'need-sol' }
  if (input.unavailable) return { kind: 'unavailable' }
  if (!input.priced) return { kind: 'pricing' }
  return { kind: 'review' }
}
