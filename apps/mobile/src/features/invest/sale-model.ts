import { USDC_MINT } from '../../lib/api.ts'
import type { SwapCheck } from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { DASH } from '../../utils/format.ts'
import type { TradeContext } from '../trade/trade-model.ts'

import {
  approxUsd,
  dollarsText,
  feePercentText,
  formatShareUnits,
  keepTogether,
  MIN_BUY_USD,
  unitsFromRaw,
  unitsPhrase,
  type BuyOrderFigures,
  type BuyRow,
  type BuyUnit,
  type IssuerFee,
} from './buy-model.ts'

/**
 * Selling a company from a position — the web's sale from a position, on the
 * phone. The sum is dollars or a share of what the wallet holds; the order
 * sells the company's token into USDC on Trade's own path. Everything here is
 * pure: the sheet and its hook draw what it decides.
 */

/** The least a sale is — a dollar, as a purchase; the whole position may be less. */
export const MIN_SALE_USD = MIN_BUY_USD
/** The quick choices: a quarter, a half, three quarters, the whole position. */
export const SALE_SHARE_PRESETS_PCT = [25, 50, 75, 100] as const
/** The sum the sheet opens on, when the position is worth that much; a smaller position opens empty. */
export const DEFAULT_SALE_USD = 10
/** Half a cent: a sum within it of the position's worth is the whole position. */
export const WHOLE_TOLERANCE_USD = 0.005

export type SalePct = (typeof SALE_SHARE_PRESETS_PCT)[number]

/** A company as its sale needs it — named, drawn and counted as its page reads it. */
export type SaleCompany = Readonly<{
  mint: string
  /** The token's symbol, the venue's key. */
  ticker: string
  /** The company, as a person names it. */
  name: string
  icon: string | null
  decimals: number | null
  /** The Scaled UI Amount multiplier in force; null where the mint carries none. */
  multiplier: number | null
  unit: BuyUnit
  preIpo: boolean
  /** The one line of truth about what the token is; null when no issuer document was read. */
  truth: string | null
  issuerFee: IssuerFee | null
  /** The price of one unit as the wallet shows it; null while it is not read. */
  priceUsd: number | null
  /** Not halted by its issuer and priced. */
  sellable: boolean
}>

const positiveMultiplier = (multiplier: number | null | undefined): number =>
  typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1

const usablePrice = (price: number | null | undefined): price is number =>
  typeof price === 'number' && Number.isFinite(price) && price > 0

const usableDecimals = (decimals: number | null | undefined): decimals is number =>
  typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 30

/** What a raw amount is worth in dollars at the price of one shown unit; null without a price or decimals. */
export function positionUsd(
  raw: bigint | null,
  decimals: number | null,
  multiplier: number | null,
  price: number | null,
): number | null {
  if (raw === null || !usableDecimals(decimals) || !usablePrice(price)) return null
  const units = unitsFromRaw(raw.toString(), decimals, multiplier)
  return units === null ? null : units * price
}

/** A share of the position, raw and never rounded up; 100 % is exactly what the wallet holds. */
export function saleShareRaw(held: bigint, pct: number): bigint {
  if (held <= 0n || !Number.isFinite(pct) || pct <= 0) return 0n
  if (pct >= 100) return held
  return (held * BigInt(Math.round(pct * 100))) / 10_000n
}

/** Whether a sum is the whole position — within half a cent of its worth, or over it by no more. */
export function isWholePosition(usd: number, value: number): boolean {
  return usd >= value - WHOLE_TOLERANCE_USD
}

/** Whether a sum is more than the position is worth. */
export function isOverPosition(usd: number, value: number): boolean {
  return usd > value + WHOLE_TOLERANCE_USD
}

/**
 * The raw amount a sum in dollars sells — the whole position when the sum is
 * its worth, otherwise the sum at the price through the multiplier, floored and
 * never more than is held; null when anything it needs is not known.
 */
export function rawForUsd(
  usd: number | null,
  held: bigint | null,
  decimals: number | null,
  multiplier: number | null,
  price: number | null,
): bigint | null {
  if (usd === null || !Number.isFinite(usd) || usd <= 0) return null
  if (held === null || held <= 0n || !usableDecimals(decimals) || !usablePrice(price)) return null
  const value = positionUsd(held, decimals, multiplier, price)
  if (value !== null && isWholePosition(usd, value)) return held
  const units = usd / price / positiveMultiplier(multiplier)
  const raw = BigInt(Math.floor(units * 10 ** decimals))
  if (raw <= 0n) return null
  return raw > held ? held : raw
}

/** What a share of the position is worth, to the cent and never rounded up; null without a price. */
export function shareUsd(
  held: bigint | null,
  decimals: number | null,
  multiplier: number | null,
  price: number | null,
  pct: number,
): number | null {
  if (held === null) return null
  const value = positionUsd(saleShareRaw(held, pct), decimals, multiplier, price)
  return value === null ? null : Math.floor(value * 100 + 1e-6) / 100
}

/** The sum the sheet opens on: $10 when the position is worth that much; none otherwise, never the whole position. */
export function openingSaleUsd(value: number | null): number | null {
  return value !== null && value >= DEFAULT_SALE_USD ? DEFAULT_SALE_USD : null
}

export type SaleShare = Readonly<{ pct: SalePct; usd: number | null; offered: boolean }>

/** The quick shares of the position: each drawn; a part under $1 not offered, the whole position always. */
export function saleShares(
  held: bigint | null,
  decimals: number | null,
  multiplier: number | null,
  price: number | null,
): readonly SaleShare[] {
  if (held === null || held <= 0n) return []
  return SALE_SHARE_PRESETS_PCT.map((pct) => {
    const usd = shareUsd(held, decimals, multiplier, price, pct)
    const offered = pct === 100 ? true : usd !== null && usd >= MIN_SALE_USD && saleShareRaw(held, pct) > 0n
    return { pct, usd, offered }
  })
}

/** A raw amount as the exact decimal text Trade's amount takes — every place kept, so it reads back to the same raw. */
export function saleAmountText(raw: bigint | null, decimals: number | null): string {
  if (raw === null || raw <= 0n || !usableDecimals(decimals)) return ''
  if (decimals === 0) return raw.toString()
  const digits = raw.toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

/* ---- the sheet's one action ---- */

export type SaleAction =
  /** An open Review nobody signed holds the wallet: release it, then ask again. */
  | Readonly<{ kind: 'release' }>
  | Readonly<{ kind: 'connect' }>
  | Readonly<{ kind: 'sign-in' }>
  /** The wallet or the company is still being read. */
  | Readonly<{ kind: 'reading' }>
  /** None of the company in the wallet now. */
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'unavailable' }>
  /** More than the position: the one action sells all of it. */
  | Readonly<{ kind: 'sell-all'; usd: number }>
  | Readonly<{ kind: 'minimum' }>
  | Readonly<{ kind: 'enter' }>
  | Readonly<{ kind: 'preparing' }>
  | Readonly<{ kind: 'need-sol' }>
  /** The sum on screen is not yet the one an order would be asked for: the button names it and waits. */
  | Readonly<{ kind: 'settling'; usd: number; whole: boolean }>
  | Readonly<{ kind: 'sell'; usd: number; whole: boolean }>

/**
 * The one button of the sale, by what stands between the person and a Review
 * — in the order the web's sheet decides it. Only `sell` asks the server for a
 * Review; `sell-all` puts the whole position in.
 */
export function saleAction(
  input: Readonly<{
    lockedReview: boolean
    connected: boolean
    signedIn: boolean
    /** What the wallet holds, raw; null while it is not read. */
    heldRaw: bigint | null
    /** The company's price, decimals and availability are read. */
    companyRead: boolean
    sellable: boolean
    /** The position's worth; null without a price. */
    valueUsd: number | null
    amountUsd: number | null
    /** The sum is a quick share — the whole position when it is 100 %. */
    pickedPct: number | null
    preparing: boolean
    needsSol: boolean
    unavailable: boolean
    /** The debounced amount an order would be asked for equals the one on screen. */
    priced: boolean
  }>,
): SaleAction {
  if (input.lockedReview) return { kind: 'release' }
  if (!input.connected) return { kind: 'connect' }
  if (!input.signedIn) return { kind: 'sign-in' }
  if (input.heldRaw === null || !input.companyRead) return { kind: 'reading' }
  if (input.heldRaw <= 0n) return { kind: 'none' }
  if (!input.sellable || input.valueUsd === null) return { kind: 'unavailable' }
  const value = input.valueUsd
  const usd = input.pickedPct === 100 ? value : input.amountUsd
  if (usd !== null && input.pickedPct !== 100 && isOverPosition(usd, value)) return { kind: 'sell-all', usd: value }
  const whole = input.pickedPct === 100 || (usd !== null && isWholePosition(usd, value))
  if (usd === null) return { kind: 'enter' }
  if (usd < MIN_SALE_USD && !whole) return { kind: 'minimum' }
  if (input.preparing) return { kind: 'preparing' }
  if (input.needsSol) return { kind: 'need-sol' }
  if (input.unavailable) return { kind: 'unavailable' }
  const sum = whole ? value : usd
  if (!input.priced) return { kind: 'settling', usd: sum, whole }
  return { kind: 'sell', usd: sum, whole }
}

/* ---- «Перевірка» ---- */

export type SaleRowWords = Readonly<{
  atLeast: string
  reserve: (usd: string) => string
  issuerFee: (pct: string, usd: string | null) => string
  /** «з них комісія Ryntra 0,50% · ≈ 0,05 USDC» — beside the issuer's, inside «Усі витрати». */
  ryntraFee: (figures: string) => string
  truthUnknown: string
  /** «Продати може не вийти…» — said under a private company's truth. */
  mayFail: string
}>

/**
 * «Перевірка» of a sale as the server counts it — **Спишеться · Отримаєш ·
 * Усі витрати · Що це**: the company's units that leave the wallet and their
 * worth, the dollars that arrive and the least that may, everything it costs
 * with the issuer's fee on a line of its own and the account's reserve apart,
 * and what the token is with the issuer's caution. Drawn, never counted here;
 * a figure the server could not count is a dash.
 */
export function saleCheckRows(
  check: SwapCheck,
  input: Readonly<{
    unit: BuyUnit
    company: string
    locale: Locale
    words: SaleRowWords
    /** Ryntra's fee on the order, as `ryntraFeeFigures` says it; null when none. */
    ryntraFee?: string | null
  }>,
): readonly [BuyRow, BuyRow, BuyRow, BuyRow] {
  const { locale, words } = input
  const spend = check.spend
  const get = check.get
  const issuerFee = check.costs?.issuerFee ?? null
  const note = check.what.note
  return [
    {
      key: 'spend',
      value: spend.amount === null ? DASH : unitsPhrase(spend.amount, input.unit, input.company, locale),
      fee: null,
      sub: spend.usd === null ? null : approxUsd(spend.usd, locale),
      caution: false,
    },
    {
      key: 'get',
      value: get.amount === null ? DASH : `≈ ${dollarsText(get.amount, locale)} USDC`,
      fee: null,
      sub: get.atLeast === null ? null : `${words.atLeast} ${dollarsText(get.atLeast, locale)}`,
      caution: false,
    },
    {
      key: 'costs',
      value: check.costs ? approxUsd(check.costs.usd, locale) : DASH,
      fee: saleFeeLines(
        issuerFee
          ? words.issuerFee(feePercentText(issuerFee.basisPoints, locale), keepTogether(approxUsd(issuerFee.usd, locale)))
          : null,
        input.ryntraFee ?? null,
        words,
      ),
      sub: check.reserve?.usd ? words.reserve(approxUsd(check.reserve.usd, locale)) : null,
      caution: false,
    },
    {
      key: 'what',
      value: check.what.truth[locale] || words.truthUnknown,
      fee: null,
      sub: note ? note[locale] : null,
      caution: check.what.caution,
    },
  ]
}

/** The costs row's quieter lines of fees: the issuer's, then Ryntra's — each on its own line; null when neither. */
function saleFeeLines(issuer: string | null, ryntra: string | null, words: SaleRowWords): string | null {
  const lines = [issuer, ryntra ? words.ryntraFee(ryntra) : null].filter((line): line is string => line !== null)
  return lines.length > 0 ? lines.join('\n') : null
}

/**
 * The same four rows from the order's own figures, for an answer that carries
 * no server count: what leaves through the token's multiplier and its worth as
 * the route states it, the dollars that arrive and the least that may, the
 * token's truth. What only the server counts — all the costs — is a dash.
 */
export function saleOrderRows(
  input: Readonly<{
    order: BuyOrderFigures
    payDecimals: number
    receiveDecimals: number
    multiplier: number | null
    unit: BuyUnit
    company: string
    truth: string | null
    preIpo: boolean
    issuerFee: IssuerFee | null
    /** Ryntra's fee on the order, as `ryntraFeeFigures` says it; null when none. */
    ryntraFee?: string | null
    locale: Locale
    words: SaleRowWords
  }>,
): readonly [BuyRow, BuyRow, BuyRow, BuyRow] {
  const { order, locale, words } = input
  const sold = unitsFromRaw(order.inAmountRaw, input.payDecimals, input.multiplier)
  const got = unitsFromRaw(order.outAmountRaw, input.receiveDecimals, null)
  const least = unitsFromRaw(order.minReceivedRaw, input.receiveDecimals, null)
  const inUsd = order.inUsdValue === null ? null : Number(order.inUsdValue)
  return [
    {
      key: 'spend',
      value: sold === null ? DASH : unitsPhrase(sold, input.unit, input.company, locale),
      fee: null,
      sub: inUsd === null || !Number.isFinite(inUsd) ? null : approxUsd(inUsd, locale),
      caution: false,
    },
    {
      key: 'get',
      value: got === null ? DASH : `≈ ${dollarsText(got, locale)} USDC`,
      fee: null,
      sub: least === null ? null : `${words.atLeast} ${dollarsText(least, locale)}`,
      caution: false,
    },
    {
      key: 'costs',
      value: DASH,
      fee: saleFeeLines(
        input.issuerFee ? words.issuerFee(feePercentText(input.issuerFee.basisPoints, locale), null) : null,
        input.ryntraFee ?? null,
        words,
      ),
      sub: null,
      caution: false,
    },
    {
      key: 'what',
      value: input.truth ?? words.truthUnknown,
      fee: null,
      sub: input.preIpo ? words.mayFail : null,
      caution: input.preIpo || input.truth === null,
    },
  ]
}

/** Whether a Review or an attempt is this company's sale into USDC — the one this sheet shows as its own. */
export function isCompanySale(context: TradeContext | null | undefined, mint: string): boolean {
  return Boolean(context && context.mode === 'sell' && context.pay.mint === mint && context.receive.mint === USDC_MINT)
}

/** «0,0787 частки Apple» — what the wallet holds, as the sheet says it under the button. */
export function heldUnitsText(
  held: bigint | null,
  company: Pick<SaleCompany, 'decimals' | 'multiplier' | 'unit' | 'name'>,
  locale: Locale,
): string | null {
  if (held === null || held <= 0n) return null
  const units = unitsFromRaw(held.toString(), company.decimals, company.multiplier)
  return units === null ? null : unitsPhrase(units, company.unit, company.name, locale)
}

/** A figure of units as the receipt says it — four places at most, a tiny one never as zero. */
export function saleUnitsFigure(value: number, locale: Locale): string {
  return formatShareUnits(value, locale)
}
