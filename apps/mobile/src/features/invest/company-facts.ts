/**
 * A company's facts at rest — the pure half (M23; the web's
 * `RYN-COMPANY-PAGE-001`, its `company-facts-model.ts` and
 * `company-facts-blocks.tsx`).
 *
 * What a company's page says under its name and in its blocks is shaped here
 * once and tested, by the web's rules and in its figures: money in the web's
 * short form («$1,93 трлн», «$24,7 млн», «$912 тис.»), people and trades whole
 * («113 тис.», «9 996»), a share with two decimals under one per cent and one
 * above («0,12%», «100,1%»), a day as the web writes it («26 вер. 2026 р.»,
 * «30.03.2026», «12.06.2026»), the exchange's short name, the issuer's label
 * and what it says of dividends, the backing, the year's range and where the
 * price stands in it, the share of buying in a day's trading. A fact the
 * contract does not give comes back null and is not drawn — never a zero,
 * never a guess; a block with nothing to say is not drawn at all.
 *
 * The web reads the company's SEC figures, its industry and «Про компанію»'s
 * lines from files of its own (`lib/stocks/company-facts.data.ts`,
 * `company-profiles.ts`, `company-sectors.ts`) — no route serves them, so the
 * phone asks line A for them (request 37) and says nothing in their place.
 * No fetch, no clock, no React.
 */

import type { Candle, CompanyPath, StockIssuerId, StockReserves } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'
import { formatClock } from '../../utils/format.ts'
import type { CompanyCopy, DividendIssuer } from './company-copy.ts'
import type { TruthTopicId } from './truth-topics.ts'

const numberTag = (locale: Locale): string => (locale === 'uk' ? 'uk-UA' : 'en-US')

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const UNITS: readonly Readonly<{ size: number; en: string; uk: string }>[] = [
  { size: 1e12, en: 'T', uk: ' трлн' },
  { size: 1e9, en: 'B', uk: ' млрд' },
  { size: 1e6, en: 'M', uk: ' млн' },
  { size: 1e3, en: 'K', uk: ' тис.' },
]

/* ---- figures ---- */

/** «$5,44 трлн» · «$303 млрд» · «$16,3 млн» · «$912 тис.» · «$41» — three significant figures at most, a minus for a loss. */
export function moneyShort(value: number | null | undefined, locale: Locale): string | null {
  if (!isFiniteNumber(value)) return null
  const abs = Math.abs(value)
  const unit = UNITS.find((entry) => abs >= entry.size) ?? null
  const scaled = unit ? abs / unit.size : abs
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  const text = new Intl.NumberFormat(numberTag(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: unit ? digits : scaled >= 1 ? 0 : 2,
  }).format(scaled)
  return `${value < 0 ? '−' : ''}$${text}${unit ? unit[locale] : ''}`
}

/** «113 тис.» · «1,2 млн» · «9 996» — people and trades, whole. */
export function countShort(value: number | null | undefined, locale: Locale): string | null {
  if (!isFiniteNumber(value) || value < 0) return null
  if (value < 10_000) return new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 0 }).format(value)
  const unit = UNITS.find((entry) => value >= entry.size) as (typeof UNITS)[number]
  const scaled = value / unit.size
  return `${new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: scaled >= 100 ? 0 : 1 }).format(scaled)}${unit[locale]}`
}

/** «0,12%» — a share, two decimals under one per cent, one above. */
export function pctShort(value: number | null | undefined, locale: Locale): string | null {
  if (!isFiniteNumber(value)) return null
  const digits = Math.abs(value) < 1 ? 2 : 1
  return `${new Intl.NumberFormat(numberTag(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}%`
}

/* ---- days ---- */

/** «26 вер. 2026 р.» · «Sep 26, 2026» — a day as a source dated it, read in UTC (no clock). */
export function dayShort(iso: string | null | undefined, locale: Locale): string | null {
  if (!iso) return null
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  return new Intl.DateTimeFormat(numberTag(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(at))
}

/** «30.03.2026» · «03/30/2026» — short enough to sit under a figure on a phone, the reader's own calendar. */
export function dayNumeric(atMs: number, locale: Locale): string {
  return new Intl.DateTimeFormat(numberTag(locale), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(atMs),
  )
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** «12.06.2026» · «Jun 12, 2026» — a recorded day of a company's path, `YYYY-MM-DD` or a full time read in UTC. */
export function pathDay(iso: string, locale: Locale): string | null {
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00.000Z` : iso)
  if (!Number.isFinite(at.getTime())) return null
  const day = at.getUTCDate()
  const month = at.getUTCMonth()
  const year = at.getUTCFullYear()
  if (locale === 'uk') return `${String(day).padStart(2, '0')}.${String(month + 1).padStart(2, '0')}.${year}`
  return `${EN_MONTHS[month]} ${day}, ${year}`
}

/* ---- the head: the ticker on its exchange, the industry ---- */

const MIC_NAMES: Readonly<Record<string, string>> = {
  XNAS: 'Nasdaq',
  XNGS: 'Nasdaq',
  XNYS: 'NYSE',
  ARCX: 'NYSE Arca',
  XASE: 'NYSE American',
  BATS: 'Cboe',
  XHKG: 'HKEX',
  XLON: 'LSE',
  XETR: 'Xetra',
}

/** The exchange's short name — «Nasdaq», «NYSE Arca» — from its MIC, else its stated name without the boilerplate. */
export function exchangeShort(exchange: Readonly<{ mic: string; name: string }> | null | undefined): string | null {
  if (exchange?.mic && MIC_NAMES[exchange.mic]) return MIC_NAMES[exchange.mic]!
  if (exchange?.name) return exchange.name.replace(/\s+(Stock Market|Stock Exchange|Global Select Market)$/i, '')
  return null
}

/** When a private token's company went public, by its path: the IPO's day — only while the path names a swap. */
export function publicSinceOf(path: CompanyPath | null | undefined): string | null {
  if (!path?.swap) return null
  return path.steps.find((step) => step.step === 'ipo')?.date ?? null
}

export type CompanyHead = Readonly<{
  /** The line under the name: «NVDA · Nasdaq», «Приватна компанія», «SPACEX · токен PreStocks». */
  subline: string | null
  /** A private company's standing, said again in «Про компанію»: «Приватна компанія», «Публічна з 12.06.2026». */
  status: string | null
  /** The exchange's short name, for «Про компанію»; null for a private token or an issuer that states none. */
  exchange: string | null
  /** The share's ticker, for «Про компанію»; null for a private token. */
  ticker: string | null
}>

/**
 * Who the company is, under its name (the web's head): the ticker on its
 * exchange — the industry once the contract serves it (request 37) — for a
 * listed company; «Приватна компанія» for a private one, or, once it has gone
 * public and its token waits to be swapped, what the token is: «SPACEX · токен
 * PreStocks».
 */
export function companyHead(
  input: Readonly<{
    preIpo: boolean
    symbol: string
    ticker: string | null
    exchange: Readonly<{ mic: string; name: string }> | null | undefined
    path: CompanyPath | null | undefined
  }>,
  words: CompanyCopy,
  locale: Locale,
): CompanyHead {
  if (input.preIpo) {
    const since = publicSinceOf(input.path)
    const day = since ? pathDay(since, locale) : null
    const status = day ? words.publicSince(day) : words.privateCompany
    return {
      subline: day ? `${input.symbol} · ${words.preStocksToken}` : status,
      status,
      exchange: null,
      ticker: null,
    }
  }
  const ticker = input.ticker && input.ticker.trim().length > 0 ? input.ticker : null
  const exchange = exchangeShort(input.exchange)
  return {
    subline: ticker ? (exchange ? `${ticker} · ${exchange}` : ticker) : null,
    status: null,
    exchange,
    ticker,
  }
}

/* ---- the blocks ---- */

export type CompanyStat = Readonly<{ key: string; label: string; value: string; hint: string | null }>
export type CompanyFact = Readonly<{ key: string; label: string; value: string; note: string | null }>

/**
 * «Ключові показники» for a private company: PreStocks' own valuation of it and
 * the one the token's price implies, each under its issuer's name and the
 * time Ryntra read it. The listed company's figures from its SEC filings wait
 * for the contract (request 37).
 */
export function privateStats(
  mark: Readonly<{
    valuationUsd: number | null
    impliedValuationUsd?: number | null
    fetchedAt: string
    stale: boolean
  }> | null,
  issuer: string,
  words: CompanyCopy,
  locale: Locale,
): CompanyStat[] {
  if (!mark) return []
  const at = formatClock(mark.fetchedAt)
  const hint = [issuer, words.atTime(at), mark.stale ? words.notUpdated : null].filter(Boolean).join(' · ')
  const stats: CompanyStat[] = []
  const valuation = moneyShort(mark.valuationUsd, locale)
  if (valuation) stats.push({ key: 'valuation', label: words.companyValuation, value: valuation, hint })
  const implied = moneyShort(mark.impliedValuationUsd, locale)
  if (implied) stats.push({ key: 'implied', label: words.byTokenPrice, value: implied, hint })
  return stats
}

/**
 * «Про компанію» as far as the contract says it: a private company's status,
 * a listed one's exchange and ticker. What the company does, its industry, its
 * headquarters, its fiscal year and its latest report are the web's own files
 * — request 37.
 */
export function aboutFacts(head: CompanyHead, words: CompanyCopy): CompanyFact[] {
  const facts: CompanyFact[] = []
  if (head.status) facts.push({ key: 'status', label: words.statusWord, value: head.status, note: null })
  if (head.exchange)
    facts.push({
      key: 'exchange',
      label: words.exchangeWord,
      value: head.ticker ? `${head.exchange} · ${head.ticker}` : head.exchange,
      note: null,
    })
  return facts
}

/** The label from the issuer's documents (canon §7): the topic that carries it and its line; null for an issuer no document was read for. */
export function truthTopicOf(issuer: StockIssuerId): TruthTopicId | null {
  switch (issuer) {
    case 'xstocks':
      return 'truthXStocks'
    case 'ondo':
      return 'truthOndo'
    case 'backpack':
      return 'truthBackpack'
    case 'prestocks':
      return 'truthPreStocks'
    default:
      return null
  }
}

const isDividendIssuer = (issuer: StockIssuerId): issuer is DividendIssuer =>
  issuer === 'xstocks' || issuer === 'ondo' || issuer === 'backpack' || issuer === 'prestocks'

/** «×1,0017» — the multiplier a scaled token carries, when it is not one. */
export function multiplierWord(multiplier: number | null | undefined, locale: Locale): string | null {
  if (!isFiniteNumber(multiplier) || multiplier <= 0 || Math.abs(multiplier - 1) < 1e-9) return null
  return `×${new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 4 }).format(multiplier)}`
}

/** The issuer's reserves against the tokens out: «100,1%», from the shares held and the supply, both as the issuer states them. */
export function backingPct(
  sharesHeld: string | number | null | undefined,
  circulating: string | number | null | undefined,
): number | null {
  if (sharesHeld === null || sharesHeld === undefined || sharesHeld === '') return null
  if (circulating === null || circulating === undefined || circulating === '') return null
  const held = Number(sharesHeld)
  const out = Number(circulating)
  if (!Number.isFinite(held) || !Number.isFinite(out) || out <= 0 || held < 0) return null
  return (held / out) * 100
}

/** The issuer's fee on a transfer, as the chain states it: «1,0%»; null for none. */
export function issuerFeeText(feeBps: number | null | undefined, locale: Locale): string | null {
  return isFiniteNumber(feeBps) && feeBps > 0 ? pctShort(feeBps / 100, locale) : null
}

/**
 * «Що ти купуєш» under the label and its line: the issuer, the backing — the
 * issuer's proof of reserves with its day, where it publishes one — what
 * happens to the company's dividends (with the multiplier they come in, for
 * xStocks), the issuer's fee on a transfer as the chain states it, «Немає»
 * where the chain was read and states none.
 */
export function whatYouBuyFacts(
  input: Readonly<{
    issuer: StockIssuerId
    issuerLabel: string
    reserves: StockReserves | null
    multiplier: number | null
    feeBps: number | null
    /** The mint was read on the chain: a fee it does not state is none, not unknown. */
    chainRead: boolean
  }>,
  words: CompanyCopy,
  locale: Locale,
): CompanyFact[] {
  const facts: CompanyFact[] = [{ key: 'issuer', label: words.issuerWord, value: input.issuerLabel, note: null }]
  const reserves = input.reserves
  const backed = reserves ? backingPct(reserves.sharesHeld, reserves.circulatingSupply) : null
  if (reserves && backed !== null) {
    const shares = Number(reserves.sharesHeld)
    const held = Number.isFinite(shares)
      ? new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 0 }).format(shares)
      : null
    const custodian = reserves.custodians[0] ?? null
    const day = dayShort(reserves.observedAt, locale)
    facts.push({
      key: 'backing',
      label: words.backing,
      value: pctShort(backed, locale) as string,
      note:
        [held && custodian ? words.sharesHeld(held, custodian) : null, day ? words.reservesAt(day) : null]
          .filter(Boolean)
          .join(' · ') || null,
    })
  }
  if (isDividendIssuer(input.issuer))
    facts.push({
      key: 'dividends',
      label: words.dividendsWord,
      value: words.dividends[input.issuer],
      note: input.issuer === 'xstocks' ? multiplierWord(input.multiplier, locale) : null,
    })
  const fee = issuerFeeText(input.feeBps, locale)
  if (fee) facts.push({ key: 'fee', label: words.issuerFee, value: fee, note: null })
  else if (input.chainRead) facts.push({ key: 'fee', label: words.issuerFee, value: words.noFee, note: null })
  return facts
}

/** The buying side of a day's trading, per cent of the trades; null without both sides. */
export function buyShare(buys: number | null | undefined, sells: number | null | undefined): number | null {
  if (!isFiniteNumber(buys) || !isFiniteNumber(sells) || buys < 0 || sells < 0) return null
  const total = buys + sells
  return total > 0 ? (buys / total) * 100 : null
}

export type TradingDay = Readonly<{
  stats: readonly CompanyStat[]
  /** Buying and selling, per cent of the day's trades; null without both. */
  pressure: Readonly<{ buys: string; sells: string; buyPct: number }> | null
  /** «На Solana з 27 черв. 2025 р.»; null when the venue states no first pool. */
  since: string | null
}>

/**
 * «Торги на Solana · 24 год» from the venue's own read of the token: the day's
 * volume, the liquidity, the holders, the traders and the trades, buying
 * against selling by the number of trades, and since when the token trades on
 * Solana.
 */
export function tradingDay(
  market: Readonly<{
    volume24hUsd: number | null
    liquidityUsd: number | null
    holders: number | null
    firstPoolAt: string | null
    stats: Readonly<{ h24: Readonly<{ buys: number | null; sells: number | null; traders: number | null }> }>
  }>,
  words: CompanyCopy,
  locale: Locale,
): TradingDay {
  const stats: CompanyStat[] = []
  const add = (key: string, label: string, value: string | null) => {
    if (value) stats.push({ key, label, value, hint: null })
  }
  const { buys, sells, traders } = market.stats.h24
  add('volume', words.volume24h, moneyShort(market.volume24hUsd, locale))
  add('liquidity', words.liquidity, moneyShort(market.liquidityUsd, locale))
  add('holders', words.holders, countShort(market.holders, locale))
  add('traders', words.traders24h, countShort(traders, locale))
  add(
    'trades',
    words.trades24h,
    countShort(isFiniteNumber(buys) && isFiniteNumber(sells) ? buys + sells : null, locale),
  )
  const buyPct = buyShare(buys, sells)
  const since = dayShort(market.firstPoolAt, locale)
  return {
    stats,
    pressure:
      buyPct === null
        ? null
        : { buys: pctShort(buyPct, locale) as string, sells: pctShort(100 - buyPct, locale) as string, buyPct },
    since: since ? words.onSolanaSince(since) : null,
  }
}

/* ---- the price over the year ---- */

const DAY_MS = 86_400_000
const YEAR_MS = 365 * DAY_MS

export type LinePoint = Readonly<{ at: number; price: number }>

/**
 * The year's daily closes, oldest first, anchored to the page's price — the
 * chart is one pool's history, and its last trade can sit a per cent away from
 * the venue's price the page shows, so every point keeps its ratio to the last
 * and the line ends where the page's price stands (the web's `anchorPoints`).
 */
export function yearPoints(candles: readonly Candle[], price: number | null, nowMs: number): LinePoint[] {
  const from = nowMs - YEAR_MS
  const points = candles
    .map((candle) => ({ at: candle.time * 1000, price: candle.close }))
    .filter(
      (point) =>
        Number.isFinite(point.at) &&
        Number.isFinite(point.price) &&
        point.price > 0 &&
        point.at >= from &&
        point.at <= nowMs + 60_000,
    )
    .sort((a, b) => a.at - b.at)
  const last = points[points.length - 1]?.price ?? null
  if (!isFiniteNumber(price) || price <= 0 || last === null || last <= 0) return points
  const scale = price / last
  return points.map((point) => ({ at: point.at, price: point.price * scale }))
}

export type YearRange = Readonly<{
  low: number
  high: number
  lowAt: number
  highAt: number
  /** Where the live price stands between the two, 0 to 1; null without a price or a span. */
  position: number | null
  /** The first point: a history younger than the year says from when. */
  since: number
}>

/**
 * The lowest and highest point of the year's line with the live price, which
 * is part of the year, and where the price stands between them. Fewer than two
 * points say nothing.
 */
export function yearRange(points: readonly LinePoint[], price: number | null, nowMs: number): YearRange | null {
  const from = nowMs - YEAR_MS
  const year = points.filter((point) => Number.isFinite(point.price) && point.price > 0 && point.at >= from)
  if (year.length < 2) return null
  let low = year[0]!
  let high = year[0]!
  for (const point of year) {
    if (point.price < low.price) low = point
    if (point.price > high.price) high = point
  }
  const live = isFiniteNumber(price) && price > 0 ? price : null
  const lowValue = live !== null ? Math.min(low.price, live) : low.price
  const highValue = live !== null ? Math.max(high.price, live) : high.price
  const span = highValue - lowValue
  return {
    low: lowValue,
    high: highValue,
    lowAt: live !== null && live < low.price ? nowMs : low.at,
    highAt: live !== null && live > high.price ? nowMs : high.at,
    position: live !== null && span > 0 ? Math.min(1, Math.max(0, (live - lowValue) / span)) : null,
    since: year.reduce((min, point) => Math.min(min, point.at), Infinity),
  }
}

/** A history that starts well inside the year says since when (the web's 330 days). */
export function yearStartsLate(range: YearRange, nowMs: number): boolean {
  return range.since > nowMs - 330 * DAY_MS
}
