/**
 * A company and its purchase in dollars on the beginner's path — the pure half
 * (with the issuer's fee of a private company's token).
 *
 * What a beginner reads about a company and about a purchase is decided here
 * once and tested: the one line of truth about what the token is (from the
 * issuer's own documents — never «акція Apple»), whether the exchange is open,
 * a sum of dollars as it is typed, how much of the company it buys, the four
 * rows of «Перевірка» as the server counts them (contract 1.20.0), what the
 * server's answer after a signature means, and the one action the sheet
 * offers. The rules are the web app's own for the same page and the same
 * sheet, so the phone and ryntra.io say the same thing; every figure is the
 * server's order — built, judged and priced by the Review route — read into the
 * person's words, never a figure of the phone's own. Nothing here reads the
 * network, a clock or a key.
 */

import {
  SOL_MINT,
  USDC_MINT,
  USDT_MINT,
  type SessionPeriod,
  type StockIssuerId,
  type SwapOrderCore,
  type SwapSettlement,
} from '../../lib/api.ts'
import type { SwapCheck } from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'
import { DASH, formatUsd } from '../../utils/format.ts'
import {
  observationFromReceipt,
  settledView,
  USDC_ASSET,
  type TradeAsset,
  type TradeContext,
} from '../trade/trade-model.ts'

const numberTag = (locale: Locale): string => (locale === 'uk' ? 'uk-UA' : 'en-US')

/* ---- the truth ---- */

/**
 * One line, from the issuer's documents, about what the person actually buys.
 * A listed company's token tracks the share's price; a private company's token
 * — PreStocks', the one issuer of private companies — is
 * not a share at all, and its line leads with that: it stands before the
 * figures on the page and in the purchase. An issuer with no documents read is
 * no line: the page and the Review say «не перевірено» instead of a guess.
 */
export function truthLine(
  issuer: StockIssuerId,
  company: string,
  locale: Locale,
  feeBps: number | null = null,
): string | null {
  const uk = locale === 'uk'
  switch (issuer) {
    case 'xstocks':
      return uk
        ? `Токен, що відстежує ціну ${company} · забезпечений 1:1 · без голосу`
        : `A token that tracks the price of ${company} · backed 1:1 · no vote`
    case 'backpack':
      return uk
        ? `Токен, що відстежує ціну ${company} · обмін на акцію через Backpack · голосу поки немає`
        : `A token that tracks the price of ${company} · exchangeable for the share at Backpack · no vote yet`
    case 'ondo':
      return uk
        ? `Токен, що відстежує ціну й дивіденди ${company} · забезпечений · це не акція`
        : `A token that tracks the price and dividends of ${company} · backed · not a share`
    case 'prestocks': {
      // The issuer's fee as the chain states it — the web's line since the chain replaced «1% today» (2026-09-26).
      const fee =
        feeBps !== null && Number.isFinite(feeBps) && feeBps > 0
          ? `${new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 2 }).format(feeBps / 100)}%`
          : null
      return uk
        ? `Це не акція ${company} · комісія емітента ${fee ? `${fee} ` : ''}на кожен переказ · емітент може заморозити чи забрати токен`
        : `Not a share in ${company} · ${fee ? `a ${fee} ` : 'an '}issuer fee on every transfer · the issuer can freeze or take away the token`
    }
    default:
      return null
  }
}

/* ---- the exchange ---- */

export type ExchangeState = 'open' | 'closed'

/**
 * Whether the exchange the share lists on is open now. The issuer's own period
 * decides — its «market» is the exchange's regular session; extended and
 * overnight hours are the token trading while the exchange is shut. Without a
 * period the exchange's own flag decides; with neither, nothing is said.
 */
export function exchangeState(
  session: Readonly<{ period: SessionPeriod; exchangeOpen: boolean | null }>,
): ExchangeState | null {
  switch (session.period) {
    case 'market':
      return 'open'
    case 'extended':
    case 'overnight':
    case 'closed':
      return 'closed'
    default:
      return session.exchangeOpen === true ? 'open' : session.exchangeOpen === false ? 'closed' : null
  }
}

/* ---- the sum ---- */

/**
 * The least a purchase in dollars is — a dollar. It was $10 in an earlier
 * draft, which had copied Jupiter's minimums for its DCA vault, Trigger orders
 * and the gasless swap; a plain swap order has none. The web's own.
 */
export const MIN_BUY_USD = 1
export const MAX_BUY_USD = 1_000_000
/**
 * The sum the sheet opens on — $10 (chosen 2026-09-25: «зроби, щоб
 * було 10»). A default, not advice: every sum from a dollar is the person's
 * own, on their own budget, and nothing on the sheet recommends one.
 */
export const DEFAULT_BUY_USD = 10
/**
 * The quick choices are shares of the dollars the wallet pays with — 25 %,
 * 50 %, 75 % and 100 % (chosen 2026-09-25: «у відсотках: 25, 50,
 * 75 і 100»); the sum itself stays free to type.
 */
export const BUY_SHARE_PRESETS_PCT = [25, 50, 75, 100] as const

/** A share of a balance in dollars and cents, never rounded up — on the raw amount, so 100 % is exactly what the wallet holds. */
export function shareOfRaw(raw: bigint, decimals: number, pct: number): number {
  if (raw <= 0n || !Number.isInteger(decimals) || decimals < 2 || !Number.isFinite(pct) || pct <= 0) return 0
  const cents = (raw * BigInt(Math.round(Math.min(pct, 100) * 100))) / (10_000n * 10n ** BigInt(decimals - 2))
  return Number(cents) / 100
}

export type BuyShare = Readonly<{ pct: number; usd: number; offered: boolean }>

/**
 * The quick shares of what the wallet holds of the paying dollars: none until
 * a wallet's balance is read and holds some (without a wallet — none); a
 * share under the minimum is drawn but not offered. The web's own rule.
 */
export function buyShares(raw: bigint | null, decimals: number): readonly BuyShare[] {
  if (raw === null || raw <= 0n) return []
  return BUY_SHARE_PRESETS_PCT.map((pct) => {
    const usd = shareOfRaw(raw, decimals, pct)
    return { pct, usd, offered: usd >= MIN_BUY_USD }
  })
}

/** The share a sum is, when it is one of the quick shares to the cent; null otherwise. */
export function pickedShare(shares: readonly BuyShare[], amountUsd: number | null): number | null {
  if (amountUsd === null) return null
  return shares.find((share) => share.offered && Math.abs(share.usd - amountUsd) < 0.005)?.pct ?? null
}

/**
 * A sum put into the amount field for the person — a quick share, the
 * company's own minimum — in the field's own language: «2,46» in Ukrainian,
 * «2.46» in English, whole dollars without cents.
 */
export function amountFieldText(usd: number, locale: Locale): string {
  const text = Math.abs(usd - Math.round(usd)) < 0.005 ? String(Math.round(usd)) : usd.toFixed(2)
  return locale === 'uk' ? text.replace('.', ',') : text
}

/** A sum of dollars in a dollar token's own units — its cents and nothing past them. */
export function dollarsRaw(usd: number, decimals: number): string {
  const cents = BigInt(Math.round(usd * 100))
  return decimals >= 2
    ? (cents * 10n ** BigInt(decimals - 2)).toString()
    : (cents / 10n ** BigInt(2 - decimals)).toString()
}

/**
 * A sum of dollars as a person types it: «25», «$25», «25,50», «1 000,50» in
 * Ukrainian, «1,000.50» in English (a lone comma before one or two digits is a
 * decimal comma in either, as a phone's keypad may type it); never more than
 * cents. Anything else is no amount.
 */
export function parseDollars(text: string, locale: Locale): number | null {
  let cleaned = text.replace(/[\s$]/g, '')
  if (locale === 'en') cleaned = cleaned.replace(/,(?=\d{3}(\D|$))/g, '')
  cleaned = cleaned.replace(',', '.')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : null
}

/* ---- no route for the sum: the company's own minimum ---- */

/**
 * Where the live quote gives no route for the sum asked, the company says its
 * own minimum — the least of these sums the same quote routes («мінімум цього
 * активу з котирування, чесно»). Tried in order and only above the sum asked;
 * when none routes, no minimum is claimed. The web's own ladder.
 */
export const ROUTE_MINIMUM_LADDER_USD = [2, 5, 10, 25, 50, 100] as const

/** The sums of the ladder above the one asked, in the order they are tried. */
export function routeMinimumSteps(amountUsd: number): number[] {
  if (!Number.isFinite(amountUsd)) return []
  return ROUTE_MINIMUM_LADDER_USD.filter((step) => step > amountUsd + 1e-9)
}

/** Whether a quote failed because the venue found no route for the sum — the one failure a larger sum can answer. */
export function isNoRoute(code: string | null | undefined): boolean {
  return typeof code === 'string' && /NO_ROUTE/.test(code)
}

/**
 * The pauses before a sum of the ladder is asked again when the answer was
 * held back — a rate limit, or the venue's passing refusal — rather than «no
 * route»: a limit's window resets within seconds.
 */
export const ROUTE_MINIMUM_RETRY_MS = [1_500, 3_000, 6_000] as const

/** What the ladder has read for the sum asked: nothing to look for, looking, the least sum that routes, or none. */
export type RouteMinimum =
  | Readonly<{ state: 'idle' }>
  | Readonly<{ state: 'finding' }>
  | Readonly<{ state: 'found'; minimumUsd: number }>
  | Readonly<{ state: 'none' }>

/** One read-only quote's answer about a sum: it routes, or the refusal's stable code. */
export type QuoteAnswer = Readonly<{ ok: true } | { ok: false; code: string }>

/**
 * The ladder above the sum asked: the first sum the quote routes, or none. Only
 * «no route» moves it up; an answer held back — a rate limit, the venue's
 * passing refusal — is asked again after each pause, and a refusal that
 * outlasts them, like any other, claims no minimum. The quote and the pause
 * are handed in, so the rule is the same on the phone and in its tests.
 */
export async function ladderMinimum(
  input: Readonly<{
    amountUsd: number
    quote: (usd: number) => Promise<QuoteAnswer>
    wait: (ms: number) => Promise<void>
    aborted: () => boolean
  }>,
): Promise<Readonly<{ state: 'found'; minimumUsd: number }> | Readonly<{ state: 'none' }>> {
  for (const step of routeMinimumSteps(input.amountUsd)) {
    let answer = await input.quote(step)
    for (const pause of ROUTE_MINIMUM_RETRY_MS) {
      if (answer.ok || isNoRoute(answer.code) || input.aborted()) break
      await input.wait(pause)
      if (input.aborted()) break
      answer = await input.quote(step)
    }
    if (answer.ok) return { state: 'found', minimumUsd: step }
    if (!isNoRoute(answer.code) || input.aborted()) break
  }
  return { state: 'none' }
}

/** Dollars a wallet holds, in cents and never more than it holds: «13,71». */
export function dollarBalanceText(value: number, locale: Locale): string {
  const cents = Math.floor(value * 100 + 1e-6) / 100
  return new Intl.NumberFormat(numberTag(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents)
}

/** A sum that may be bought: from the minimum up to the ceiling. */
export function isBuyableSum(value: number | null): value is number {
  return value !== null && value >= MIN_BUY_USD && value <= MAX_BUY_USD
}

/** The sum as the order is asked for it, in the dollar token's own units: cents and nothing past them. */
export function sumText(value: number): string {
  return value.toFixed(2)
}

/** «$25» for a whole sum, «$25,50» / «$25.50» with cents — the button's and the receipt's words. */
export function dollarsText(value: number, locale: Locale): string {
  const whole = Math.abs(value - Math.round(value)) < 0.005
  const format = new Intl.NumberFormat(numberTag(locale), {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })
  return `$${format.format(whole ? Math.round(value) : value)}`
}

/* ---- what a sum buys ---- */

function multiplierRatio(multiplier: number): Readonly<{ num: bigint; den: bigint }> {
  const text = multiplier.toPrecision(15)
  const [mantissa = '0', exponent = '0'] = text.toLowerCase().split('e')
  const [whole = '0', fraction = ''] = mantissa.split('.')
  const digits = (whole + fraction).replace(/^0+(?=\d)/, '')
  const shift = Number(exponent) - fraction.length
  const base = BigInt(digits)
  if (shift >= 0) return { num: base * 10n ** BigInt(shift), den: 1n }
  let a = base
  let b = 10n ** BigInt(-shift)
  while (b !== 0n) [a, b] = [b, a % b]
  const gcd = a === 0n ? 1n : a
  return { num: base / gcd, den: 10n ** BigInt(-shift) / gcd }
}

/**
 * The amount a person gets, in the unit the wallet shows — shares for a listed
 * company, tokens for a private one — from the raw amount the order states. A
 * mint with the Scaled UI Amount extension counts its scaled unit, the one
 * priced as a share; the multiplier is applied here once and nowhere else
 * Eight places, truncated: a balance is never rounded up.
 */
export function unitsFromRaw(
  raw: string | null | undefined,
  decimals: number | null | undefined,
  multiplier: number | null | undefined,
): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null
  const scale = typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
  const { num, den } = multiplierRatio(scale)
  const places = 8
  const scaled = (BigInt(raw) * num * 10n ** BigInt(places)) / (den * 10n ** BigInt(decimals))
  const digits = scaled.toString().padStart(places + 1, '0')
  const value = Number(`${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`)
  return Number.isFinite(value) ? value : null
}

/** A count of shares or tokens, four decimals at most; a real but tiny one is never printed as zero. */
export function formatShareUnits(value: number, locale: Locale): string {
  const tag = numberTag(locale)
  if (value > 0 && value < 0.0001) return `< ${new Intl.NumberFormat(tag, { minimumFractionDigits: 4 }).format(0.0001)}`
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 4 }).format(value)
}

/** The Ukrainian plural of a whole count: 1, 21 — one; 2–4, 22–24 — few; the rest — many. */
function ukPlural(count: number): 'one' | 'few' | 'many' {
  const ten = count % 10
  const hundred = count % 100
  if (ten === 1 && hundred !== 11) return 'one'
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'few'
  return 'many'
}

const UK_UNITS = {
  share: { one: 'частка', few: 'частки', many: 'часток', fraction: 'частки' },
  token: { one: 'токен', few: 'токени', many: 'токенів', fraction: 'токена' },
} as const

export type BuyUnit = 'share' | 'token'

/**
 * «0,0787 частки Apple», «2 частки Apple», «1 токен OpenAI» — the Ukrainian
 * noun after a number: a fraction takes the genitive singular, a whole number
 * its plural form. English says «of a share» below one and «shares» from one up.
 */
export function unitsPhrase(value: number, unit: BuyUnit, company: string, locale: Locale): string {
  const figure = formatShareUnits(value, locale)
  if (locale === 'uk') {
    const forms = UK_UNITS[unit]
    const rounded = Number(value.toFixed(4))
    const noun = Number.isInteger(rounded) ? forms[ukPlural(Math.round(rounded))] : forms.fraction
    return `${figure} ${noun} ${company}`
  }
  if (value < 1) return `${figure} of ${unit === 'share' ? 'a share' : 'a token'}`
  return `${figure} ${unit === 'share' ? (value === 1 ? 'share' : 'shares') : value === 1 ? 'token' : 'tokens'}`
}

/* ---- «Усі витрати» ---- */

/** The signature fee of one Solana transaction — the least a purchase costs the network. */
export const BASE_SIGNATURE_LAMPORTS = 5_000n

export type BuyCostInput = Readonly<{
  spendUsd: number
  /** The venue's own dollar value of what leaves and what arrives. */
  inUsdValue: string | null
  outUsdValue: string | null
  /** Every fee inside the route, Ryntra's included, basis points. */
  totalFeeBasisPoints: number | null
  /** The issuer's own fee on every transfer of its token, basis points — PreStocks' 1 %; absent or null for none. */
  issuerFeeBps?: number | null
  /** The venue's stated price impact, a signed fraction of a percent. */
  priceImpactPct: string | null
  signatureFeeLamports: string | null
  priorityFeeLamports: string | null
  /** The reserve a new token account keeps, when the purchase opens one. */
  rentFeeLamports: string | null
  /** SOL's price, for the network fee paid in SOL; unknown makes the whole figure unknown. */
  solUsd: number | null
}>

export type BuyCosts = Readonly<{
  /** Everything the purchase costs beyond what it buys, in dollars. */
  totalUsd: number
  /** The one-time reserve that opens the token's account in the wallet, in dollars; null when there is none. */
  accountUsd: number | null
}>

const numeric = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const lamportsOf = (value: string | null | undefined): bigint => (value && /^\d+$/.test(value) ? BigInt(value) : 0n)

/**
 * «Усі витрати» — what the purchase costs beyond what it buys: the
 * venue's own dollar values of what leaves and what arrives, whose difference
 * already holds every fee inside the route, Ryntra's too, the issuer's fee on
 * the token's transfer (the route quotes what arrives after it) and the price
 * impact — never less than the stated fees, the issuer's among them, and the
 * impact (a price that moved in the person's favour is not a negative cost) —
 * and the network's fee in SOL at SOL's price. The reserve that opens a new
 * token account is said apart: it stays in the wallet's account rather than
 * going to anyone. Without SOL's price the figure is unknown — a dash on the
 * screen, never a smaller number.
 */
export function buyCosts(input: BuyCostInput): BuyCosts | null {
  const solUsd = input.solUsd !== null && Number.isFinite(input.solUsd) && input.solUsd > 0 ? input.solUsd : null
  if (solUsd === null) return null
  const spend = Math.max(0, input.spendUsd)
  const feeBps = Math.max(0, input.totalFeeBasisPoints ?? 0) + Math.max(0, input.issuerFeeBps ?? 0)
  const stated = (spend * feeBps) / 10_000 + (spend * Math.max(0, numeric(input.priceImpactPct) ?? 0)) / 100
  const inUsd = numeric(input.inUsdValue)
  const outUsd = numeric(input.outUsdValue)
  const route = inUsd !== null && outUsd !== null && inUsd > 0 && outUsd >= 0 ? inUsd - outUsd : null
  const trade = route !== null && route > stated ? route : stated
  const networkLamports = lamportsOf(input.signatureFeeLamports) + lamportsOf(input.priorityFeeLamports)
  const fee = networkLamports > 0n ? networkLamports : BASE_SIGNATURE_LAMPORTS
  const network = (Number(fee) / 1e9) * solUsd
  return { totalUsd: trade + network, accountUsd: reserveUsdOf(input.rentFeeLamports, solUsd) }
}

/** The reserve a new token account keeps, in dollars at SOL's price; null when the order opens none. */
function reserveUsdOf(rentFeeLamports: string | null, solUsd: number): number | null {
  const rent = lamportsOf(rentFeeLamports)
  return rent > 0n ? (Number(rent) / 1e9) * solUsd : null
}

/**
 * The line «Перевірка» says before its four rows when the order's one-time
 * reserve is more than the purchase: the reserve and the sum
 * in dollars, as the server counted them on the exact order — `first` is the
 * server's own judgement; null when it said no reserve, no figure, or not more.
 * The reserve stays in the person's wallet; it is never a cost.
 */
export function reserveFirstOf(
  check: SwapCheck | null,
): Readonly<{ reserveUsd: number; spendUsd: number }> | null {
  const reserve = check?.reserve ?? null
  const spendUsd = check?.spend.amount ?? null
  if (!reserve?.first || reserve.usd === null || spendUsd === null) return null
  return { reserveUsd: reserve.usd, spendUsd }
}

/** «≈ $0,06», or «< $0,01» for a real cost too small to print as a cent. */
export function approxUsd(value: number, locale: Locale): string {
  const tag = numberTag(locale)
  if (value < 0.01) return `< $${new Intl.NumberFormat(tag, { minimumFractionDigits: 2 }).format(0.01)}`
  return `≈ $${new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`
}

/* ---- the issuer's fee ---- */

/** `u64::MAX`: the value a mint's fee config stores for «no cap». */
export const NO_FEE_CAP_RAW = '18446744073709551615'

/** The fee a mint withholds on every transfer of its token, as the chain states it — PreStocks' 1 %. */
export type IssuerFee = Readonly<{ basisPoints: number; maximumFeeRaw: string | null }>

/** A mint's fee config as the stock routes answer it, into the fee a purchase pays — none when it charges nothing. */
export function issuerFeeOf(
  config: Readonly<{ basisPoints: number; maximumFeeRaw: string }> | null | undefined,
): IssuerFee | null {
  if (!config || !Number.isFinite(config.basisPoints) || config.basisPoints <= 0 || config.basisPoints >= 10_000)
    return null
  return { basisPoints: config.basisPoints, maximumFeeRaw: config.maximumFeeRaw }
}

/** «1%», «0,5%» — a fee in basis points as a person reads it. */
export function feePercentText(basisPoints: number, locale: Locale): string {
  return `${new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 2 }).format(basisPoints / 100)}%`
}

/* ---- the dollars a purchase is paid with ---- */

export const USDT_ASSET: TradeAsset = {
  mint: USDT_MINT,
  symbol: 'USDT',
  name: 'Tether USD',
  icon: null,
  decimals: 6,
}

export type PayDollar = 'USDC' | 'USDT'

export const PAY_ASSETS: Readonly<Record<PayDollar, TradeAsset>> = { USDC: USDC_ASSET, USDT: USDT_ASSET }

export function isDollarMint(mint: string): boolean {
  return mint === USDC_MINT || mint === USDT_MINT
}

/**
 * Which dollars pay (USDC and USDT in the quick choice): the
 * person's pick; else USDC, unless the wallet is known to hold no USDC and
 * holds some USDT. A balance not read is not a zero.
 */
export function payDollar(
  input: Readonly<{ picked: PayDollar | null; usdcRaw: bigint | null; usdtRaw: bigint | null }>,
): PayDollar {
  if (input.picked) return input.picked
  if (input.usdcRaw === 0n && input.usdtRaw !== null && input.usdtRaw > 0n) return 'USDT'
  return 'USDC'
}

/** The choice is drawn only where it is a choice: the wallet holds some USDT. */
export function offersPayChoice(usdtRaw: bigint | null): boolean {
  return usdtRaw !== null && usdtRaw > 0n
}

/* ---- «Перевірка» — exactly four rows ---- */

export type BuyRowKey = 'spend' | 'get' | 'costs' | 'what'

export type BuyRow = Readonly<{
  key: BuyRowKey
  value: string
  /** The issuer's own fee inside «Усі витрати», a line of its own; null on every other row. */
  fee: string | null
  /**
   * A quieter line under the value: the dollar's name, the least that arrives —
   * and under «Усі витрати» the token account's one-time reserve, a line of its
   * own, never among the costs.
   */
  sub: string | null
  /** Said in amber: a private company's line, or a truth not verified. */
  caution: boolean
}>

export type BuyRowWords = Readonly<{
  atLeast: string
  reserve: (usd: string) => string
  issuerFee: (pct: string, usd: string | null) => string
  /** «з них комісія Ryntra 0,50% · ≈ 0,05 USDC» — beside the issuer's, inside «Усі витрати». */
  ryntraFee: (figures: string) => string
  truthUnknown: string
}>

export type BuyOrderFigures = Pick<
  SwapOrderCore,
  | 'inAmountRaw'
  | 'outAmountRaw'
  | 'minReceivedRaw'
  | 'inUsdValue'
  | 'outUsdValue'
  | 'totalFeeBasisPoints'
  | 'priceImpactPct'
  | 'signatureFeeLamports'
  | 'priorityFeeLamports'
  | 'rentFeeLamports'
>

/** «≈ $0,10», «< $0,01» kept on one line — the sign never ends a line apart from its figure. */
export const keepTogether = (text: string): string => text.replace(/^([≈<]) /, '$1\u00a0')

/* ---- Ryntra's own fee inside «Усі витрати» — the web's one formatter (`serviceFeeReviewText`), on the order's figures ---- */

/** A company is bought with dollars and sold into them; Ryntra's fee is in one of these, or in SOL. */
const FEE_SIDES: Readonly<Record<string, Readonly<{ decimals: number; code: string }>>> = {
  [SOL_MINT]: { decimals: 9, code: 'SOL' },
  [USDC_MINT]: { decimals: 6, code: 'USDC' },
  [USDT_MINT]: { decimals: 6, code: 'USDT' },
}

export type RyntraFeeOrder = Pick<
  SwapOrderCore,
  'ryntraFee' | 'inputMint' | 'outputMint' | 'inAmountRaw' | 'outAmountRaw' | 'inUsdValue' | 'outUsdValue'
>

/**
 * «0,50% · ≈\u00a00,05 USDC» — Ryntra's fee on an order as the web says it inside
 * «Усі витрати»: the rate, and the amount — exact where the provider stated it,
 * else `≈` the rate's share of the side it is taken from — with a dollar
 * anchor when the fee is in SOL. The order's own figures, never a cost counted
 * here; null when the order charges none.
 */
export function ryntraFeeFigures(order: RyntraFeeOrder | null | undefined, locale: Locale): string | null {
  const fee = order?.ryntraFee ?? null
  if (!order || !fee || !(fee.basisPoints > 0)) return null
  const tag = numberTag(locale)
  const fixed = (value: number, digits: number) =>
    new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  const rate = `${fixed(fee.basisPoints / 100, 2)}%`
  const asset = fee.asset
  const side = asset ? (FEE_SIDES[asset] ?? null) : null
  const decimals = fee.decimals ?? side?.decimals ?? null
  const code = fee.symbol ?? side?.code ?? null
  const sideRaw = asset === order.inputMint ? order.inAmountRaw : asset === order.outputMint ? order.outAmountRaw : null
  const estimate =
    fee.amountRaw != null
      ? { raw: fee.amountRaw, exact: true }
      : sideRaw !== null && /^\d+$/.test(sideRaw) && fee.basisPoints < 10_000
        ? { raw: ((BigInt(sideRaw) * BigInt(fee.basisPoints)) / 10_000n).toString(), exact: false }
        : null
  if (!estimate || decimals === null) {
    if (fee.usd != null && fee.usd > 0) return `${rate}\u00a0· ${keepTogether(approxUsd(fee.usd, locale))}`
    return rate
  }
  const figure = new Intl.NumberFormat(tag, { maximumFractionDigits: decimals }).format(Number(estimate.raw) / 10 ** decimals)
  const sideUsd = asset === order.inputMint ? numeric(order.inUsdValue) : asset === order.outputMint ? numeric(order.outUsdValue) : null
  const feeUsd =
    asset && asset !== USDC_MINT && asset !== USDT_MINT && sideUsd !== null && sideUsd > 0 && sideRaw && Number(sideRaw) > 0
      ? (sideUsd * Number(estimate.raw)) / Number(sideRaw)
      : null
  const dollars = feeUsd === null ? null : keepTogether(approxUsd(feeUsd, locale))
  const amount = `${estimate.exact ? '' : '≈\u00a0'}${figure}${code ? `\u00a0${code}` : ''}`
  // One ordinary space, after «·»: a narrow cell wraps there, never inside the rate or the amount.
  return `${rate}\u00a0· ${amount}${dollars ? ` (${dollars})` : ''}`
}

/** The costs row's quieter lines of fees: the issuer's, then Ryntra's — each on its own line; null when neither. */
function feeLines(issuer: string | null, ryntra: string | null, words: BuyRowWords): string | null {
  const lines = [issuer, ryntra ? words.ryntraFee(ryntra) : null].filter((line): line is string => line !== null)
  return lines.length > 0 ? lines.join('\n') : null
}

/**
 * What the sum buys and costs, from the live quote — the server's `check` (1.20.0).
 * A quote the server did not count (paid in USDT, a company it could not read)
 * says what arrives as the order states it and the costs as unknown; a figure
 * that cannot be said is null, and the sheet says nothing in its place.
 */
export function buyEstimate(
  quote: Readonly<{ order: Pick<SwapOrderCore, 'outAmountRaw'>; decimals: Readonly<Record<string, number>>; check?: SwapCheck | null }> | null,
  company: Readonly<{ mint: string; decimals: number | null; multiplier: number | null }>,
): Readonly<{ units: number | null; costsUsd: number | null }> | null {
  if (!quote) return null
  const check = quote.check ?? null
  if (check) return { units: check.get.amount, costsUsd: check.costs?.usd ?? null }
  return {
    units: unitsFromRaw(quote.order.outAmountRaw, quote.decimals[company.mint] ?? company.decimals, company.multiplier),
    costsUsd: null,
  }
}

/**
 * «Перевірка» of a purchase as the server counts it (contract 1.20.0) — the
 * four rows a person reads before the signature, **Спишеться · Отримаєш ·
 * Усі витрати · Що це**: the dollars that leave the wallet, the company's
 * units that arrive and the least that may — in the unit the wallet shows,
 * through the token's multiplier — everything it costs with the issuer's own
 * fee on a line of its own and the account's one-time reserve apart,
 * and what the token is with the issuer's event said to a buyer.
 * The quote's `check` carries no reserve; the order's carries the one its
 * simulation proved. Drawn, never counted here — the web draws the same
 * `check`, so the same sum says the same figures; a figure the server could
 * not count is a dash.
 */
export function buyCheckRows(
  check: SwapCheck,
  input: Readonly<{
    unit: BuyUnit
    company: string
    locale: Locale
    words: BuyRowWords
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
      value: spend.amount === null ? DASH : formatUsd(spend.amount, locale),
      fee: null,
      sub: spend.unit === 'usdc' ? 'USDC' : null,
      caution: false,
    },
    {
      key: 'get',
      value: get.amount === null ? DASH : `≈ ${unitsPhrase(get.amount, input.unit, input.company, locale)}`,
      fee: null,
      sub: get.atLeast === null ? null : `${words.atLeast} ${formatShareUnits(get.atLeast, locale)}`,
      caution: false,
    },
    {
      key: 'costs',
      value: check.costs ? approxUsd(check.costs.usd, locale) : DASH,
      fee: feeLines(
        issuerFee
          ? words.issuerFee(feePercentText(issuerFee.basisPoints, locale), keepTogether(approxUsd(issuerFee.usd, locale)))
          : null,
        input.ryntraFee ?? null,
        words,
      ),
      // The reserve stays in the wallet, on the token's account: said apart, never joined to the costs.
      sub: check.reserve?.usd ? words.reserve(approxUsd(check.reserve.usd, locale)) : null,
      caution: false,
    },
    {
      key: 'what',
      value: check.what.truth[locale] || words.truthUnknown,
      fee: null,
      sub: note?.kind === 'issuer-event' ? note[locale] : null,
      caution: check.what.caution,
    },
  ]
}

/**
 * The same four rows for an order the server answered without its count — a
 * purchase paid in USDT, or a company the server could not read: what leaves
 * and what arrives (and the least that may) as the order states them, through
 * the token's multiplier, the fees the order and the mint state (the issuer's
 * per cent, Ryntra's), and what the token is as the page read it. What only the
 * server counts — all the costs, the issuer's fee in dollars, the reserve — is a
 * dash, never a figure of the phone's own.
 */
export function buyOrderRows(
  input: Readonly<{
    order: BuyOrderFigures
    pay: TradeAsset
    payDecimals: number
    receiveDecimals: number | null
    multiplier: number | null
    unit: BuyUnit
    company: string
    truth: string | null
    preIpo: boolean
    /** The issuer's event said again under «Що це» (the IPO and conversion watch); null for none. */
    eventLine?: string | null
    /** The mint's own fee on the transfer that delivers the token; null when it charges none. */
    issuerFee?: IssuerFee | null
    /** Ryntra's fee on the order, as `ryntraFeeFigures` says it; null when none. */
    ryntraFee?: string | null
    locale: Locale
    words: BuyRowWords
  }>,
): readonly [BuyRow, BuyRow, BuyRow, BuyRow] {
  const { order, locale, words } = input
  const issuerFee = input.issuerFee ?? null
  const spent = unitsFromRaw(order.inAmountRaw, input.payDecimals, null)
  const got = unitsFromRaw(order.outAmountRaw, input.receiveDecimals, input.multiplier)
  const least = unitsFromRaw(order.minReceivedRaw, input.receiveDecimals, input.multiplier)
  return [
    {
      key: 'spend',
      value: spent === null ? DASH : formatUsd(spent, locale),
      fee: null,
      sub: input.pay.symbol,
      caution: false,
    },
    {
      key: 'get',
      value: got === null ? DASH : `≈ ${unitsPhrase(got, input.unit, input.company, locale)}`,
      fee: null,
      sub: least === null ? null : `${words.atLeast} ${formatShareUnits(least, locale)}`,
      caution: false,
    },
    {
      key: 'costs',
      value: DASH,
      fee: feeLines(
        issuerFee ? words.issuerFee(feePercentText(issuerFee.basisPoints, locale), null) : null,
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
      sub: input.eventLine ?? null,
      caution: input.preIpo || input.truth === null,
    },
  ]
}

/* ---- what the server's answer means ---- */

export type BuyOutcome =
  | Readonly<{
      kind: 'filled'
      /** What left the wallet and what arrived, raw — the chain's own figures, or the Review's when the chain's are not stated. */
      spentRaw: string | null
      gotRaw: string | null
      fromReview: boolean
      belowMinimum: boolean
    }>
  | Readonly<{ kind: 'pending' }>
  /** Nothing reached the chain, or what did never landed: the money did not move. */
  | Readonly<{ kind: 'nothing' }>
  /** The chain refused it: only the network fee was spent. */
  | Readonly<{ kind: 'not-filled' }>

const NOTHING_MOVED = new Set(['EXPIRED_BEFORE_SUBMIT', 'UNKNOWN_TO_CHAIN', 'EXPIRED_AFTER_SUBMIT'])

/**
 * A settled answer in the purchase's words — *У тебе є частинка*, *Нічого не
 * сталося*, *Мережа відхилила* — judged by Trade's own rule (the
 * `settledView`), so the receipt on the sheet and the card in Trade never
 * disagree on what happened; the figures are the chain's where the answer
 * carries them.
 */
export function buyOutcome(settlement: SwapSettlement, context: TradeContext | null): BuyOutcome {
  const view = settledView(settlement, context)
  if (view.status === 'pending') return { kind: 'pending' }
  if (view.status === 'failed')
    return NOTHING_MOVED.has(settlement.state) ? { kind: 'nothing' } : { kind: 'not-filled' }
  const actual = settlement.observation ?? observationFromReceipt(settlement.receipt)
  return {
    kind: 'filled',
    spentRaw: actual?.actualInputRaw ?? context?.inAmountRaw ?? null,
    gotRaw: actual?.actualOutputRaw ?? context?.outAmountRaw ?? null,
    fromReview: actual === null,
    belowMinimum: settlement.facts?.reconciliation.minimumMet === false,
  }
}

/** Whether a Review or an attempt is this company's purchase in dollars — the one this sheet shows as its own. */
export function isCompanyBuy(context: TradeContext | null | undefined, mint: string): boolean {
  return Boolean(context && context.mode === 'buy' && context.receive.mint === mint && isDollarMint(context.pay.mint))
}

/**
 * Where a signature whose outcome is not known yet is checked from Home: a
 * company's purchase in dollars on the company's own page with its purchase
 * open (the same words it was made in); anything else — a sale, a swap, a
 * purchase with SOL, an earlier signature this phone never made — in Trade.
 */
export function recoveryDoor(
  context: TradeContext | null | undefined,
  isCompany: (mint: string) => boolean,
): Readonly<{ kind: 'company'; mint: string; symbol: string }> | Readonly<{ kind: 'trade' }> {
  if (context && context.mode === 'buy' && isDollarMint(context.pay.mint) && isCompany(context.receive.mint))
    return { kind: 'company', mint: context.receive.mint, symbol: context.receive.symbol }
  return { kind: 'trade' }
}

/** What left the wallet, as the receipt says it: dollars for a dollar token, else the asset's own units. */
export function spentText(raw: string | null, pay: TradeAsset, payDecimals: number, locale: Locale): string | null {
  const value = unitsFromRaw(raw, payDecimals, null)
  if (value === null) return null
  if (isDollarMint(pay.mint)) return dollarsText(value, locale)
  return `${formatShareUnits(value, locale)} ${pay.symbol}`
}

/* ---- the words for a refusal ---- */

export const BUY_FAILURE_KEYS = [
  'walletDeclined',
  'noWallet',
  'walletTimeout',
  'walletFailed',
  'closedUnderWallet',
  'signatureUnreadable',
  'paused',
  'notOffered',
  'notSetUp',
  'previousStillValid',
  'reviewOpen',
  'checkPrevious',
  'notPassed',
  'routeFailed',
  'buildFailed',
  'providerDown',
  'signIn',
  'otherWallet',
  'bytesChanged',
  'tooLong',
  'offline',
  'noRoute',
  'notEnough',
  'rateLimited',
  'priceExpired',
  'amount',
  'notAccepted',
  'ruleClosed',
  'ruleGone',
  'ruleMismatch',
  'ruleBudget',
  'ruleCondition',
  'failed',
] as const

export type BuyFailureKey = (typeof BUY_FAILURE_KEYS)[number]

/**
 * A refusal's stable code — the server's, the wallet's or Trade's own — into
 * the sentence «Простий» says for it. The same codes Trade reads (the
 * `tradeFailureCopy`), grouped by what the person can do next; the words live
 * in the copy, in both languages.
 */
export function buyFailureKey(code: string): BuyFailureKey {
  // Under an autoinvest reminder (1.12.0–1.18.0): closed, not this wallet's rule, not the rule's purchase, over the month's
  // budget, the price condition not met on the server's own figures.
  if (code === 'RULE_NOT_DUE') return 'ruleClosed'
  if (code === 'RULE_NOT_FOUND') return 'ruleGone'
  if (code === 'RULE_MISMATCH') return 'ruleMismatch'
  if (code === 'RULE_BUDGET_EXHAUSTED') return 'ruleBudget'
  if (code === 'RULE_PRICE_CONDITION') return 'ruleCondition'
  if (code === 'WALLET_REFUSED' || /USER_REJECTED|CANCELLED|DECLINED/.test(code)) return 'walletDeclined'
  if (code === 'WALLET_NOT_FOUND') return 'noWallet'
  if (code === 'WALLET_TIMEOUT') return 'walletTimeout'
  if (code === 'WALLET_FAILED') return 'walletFailed'
  if (code === 'REVIEW_CLOSED_UNDER_WALLET') return 'closedUnderWallet'
  if (code === 'SIGNATURE_UNREADABLE') return 'signatureUnreadable'
  if (/SWAP_PAUSED/.test(code)) return 'paused'
  if (code === 'ASSET_NOT_OFFERED') return 'notOffered'
  if (
    /PROOF_NOT_SIGNED|ISSUER_KEY_MISSING|STORE_NOT_DURABLE|PROVIDER_KEY_MISSING|NO_INDEPENDENT_RPC|PRODUCTION_KEY_REQUIRED|DURABLE_MULTI_WRITER|FORBIDDEN_ORIGIN/.test(
      code,
    )
  )
    return 'notSetUp'
  if (code === 'BLOCKHASH_STILL_VALID') return 'previousStillValid'
  if (code === 'OWNER_SWAP_LOCKED') return 'reviewOpen'
  if (code === 'ATTEMPT_OPEN' || /OWNER.*LOCK|SUBMISSION_UNKNOWN|RECOVERY/.test(code)) return 'checkPrevious'
  if (
    /SWAP_PRE_SIGN_REFUSED|INTENT_REFUSED|SWAP_POLICY_BLOCKED|PREFLIGHT_REFUSED|POLICY_BLOCKED|PASSPORT_REFUSED|MINT_UNREADABLE|DECIMALS_UNKNOWN|IMPLAUSIBLE_QUOTE|SAME_MINT/.test(
      code,
    )
  )
    return 'notPassed'
  if (/SIMULATION|EFFECTS_NOT_VERIFIED/.test(code)) return 'routeFailed'
  if (/ORDER_BUILD_FAILED/.test(code)) return 'buildFailed'
  if (
    /ORDER_UNREACHABLE|ORDER_HTTP_ERROR|EXECUTE_UNREACHABLE|EXECUTE_HTTP_ERROR|ORDER_REFUSED|ORDER_MALFORMED|EXECUTE_REFUSED|EXECUTE_MALFORMED/.test(
      code,
    )
  )
    return 'providerDown'
  if (/^UNAUTHORIZED$|^SESSION_EXPIRED$|^SESSION_REVOKED$/.test(code)) return 'signIn'
  if (code === 'WALLET_MISMATCH') return 'otherWallet'
  if (/TRANSACTION_|REVIEWED_BYTES_MISMATCH|WALLET_MODIFIED_BYTES|WALLET_GUARDS/.test(code)) return 'bytesChanged'
  if (/^HTTP_(502|503|504)$/.test(code) || /TIMEOUT|GATEWAY/.test(code)) return 'tooLong'
  if (code === 'NETWORK') return 'offline'
  if (/NO_ROUTE/.test(code)) return 'noRoute'
  if (/INSUFFICIENT|BALANCE/.test(code)) return 'notEnough'
  if (/RATE_LIMITED/.test(code)) return 'rateLimited'
  if (/EXPIRED|STALE|BLOCKHASH|TOO_SHORT|INVALIDATED/.test(code)) return 'priceExpired'
  if (/AMOUNT/.test(code)) return 'amount'
  if (/VALIDATION/.test(code)) return 'notAccepted'
  return 'failed'
}

/* ---- the sheet's one action ---- */

export type ComposeAction =
  /** An open Review nobody signed holds the wallet: release it, then ask again. */
  | Readonly<{ kind: 'release' }>
  | Readonly<{ kind: 'connect' }>
  | Readonly<{ kind: 'sign-in' }>
  | Readonly<{ kind: 'minimum' }>
  | Readonly<{ kind: 'enter' }>
  /** No route for the sum: the one action puts the company's own minimum in — never a dead button. */
  | Readonly<{ kind: 'use-minimum'; usd: number }>
  /** No route for the sum, and the company's own minimum is being read: the button names the sum and waits. */
  | Readonly<{ kind: 'finding-minimum'; usd: number }>
  | Readonly<{ kind: 'preparing' }>
  | Readonly<{ kind: 'need-sol' }>
  | Readonly<{ kind: 'not-enough' }>
  | Readonly<{ kind: 'unavailable' }>
  /** The sum on screen is not yet the one an order would be asked for: the button names it and waits. */
  | Readonly<{ kind: 'settling'; usd: number }>
  | Readonly<{ kind: 'buy'; usd: number }>

/**
 * The one orange button of the amount sheet, by what stands between the person
 * and a Review — in the order a person meets it: a Review held open elsewhere,
 * the wallet, the session, the sum, a sum with no route (the company's own
 * minimum put in with one tap, the web's own rule), the network fee, the
 * balance, the asset's own availability. Only `buy` asks the server for a
 * Review.
 */
export function composeAction(
  input: Readonly<{
    connected: boolean
    signedIn: boolean
    amountUsd: number | null
    lockedReview: boolean
    preparing: boolean
    /** The debounced sum an order would be asked for equals the one on screen. */
    priced: boolean
    needsSol: boolean
    insufficient: boolean
    unavailable: boolean
    /** The sum's route, when its quote found none: the company's own minimum as the ladder has read it; idle otherwise. */
    route?: RouteMinimum
  }>,
): ComposeAction {
  const route = input.route ?? { state: 'idle' }
  if (input.lockedReview) return { kind: 'release' }
  if (!input.connected) return { kind: 'connect' }
  if (!input.signedIn) return { kind: 'sign-in' }
  if (input.amountUsd !== null && input.amountUsd < MIN_BUY_USD) return { kind: 'minimum' }
  if (!isBuyableSum(input.amountUsd)) return { kind: 'enter' }
  if (route.state === 'found') return { kind: 'use-minimum', usd: route.minimumUsd }
  if (route.state === 'finding') return { kind: 'finding-minimum', usd: input.amountUsd }
  if (route.state === 'none') return { kind: 'unavailable' }
  if (input.preparing) return { kind: 'preparing' }
  if (input.needsSol) return { kind: 'need-sol' }
  if (input.insufficient) return { kind: 'not-enough' }
  if (input.unavailable) return { kind: 'unavailable' }
  if (!input.priced) return { kind: 'settling', usd: input.amountUsd }
  return { kind: 'buy', usd: input.amountUsd }
}
