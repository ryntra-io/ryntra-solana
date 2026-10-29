/**
 * Words and judgements for tokenized stocks — the same semantics the web's
 * stock surface carries (reference · session · issuer · units), without its
 * table. Pure: nothing here reads the network or computes a figure the
 * server did not; the one derivation is the reference's *state*, judged
 * again at render from its fetch time, so a copy served from a cache a
 * minute later cannot call a stale figure current.
 */

import type { ReferenceState, SessionPeriod, StockIssuerId, StockUniverseRow } from '@/lib/api'
import type { Locale } from '@/lib/i18n'

export const ISSUER_SHORT: Readonly<Record<string, string>> = {
  xstocks: 'xStocks',
  backpack: 'Backpack',
  ondo: 'Ondo',
  prestocks: 'PreStocks',
}

export const ISSUER_FULL: Readonly<Record<string, string>> = {
  xstocks: 'xStocks · Backed Finance',
  backpack: 'Backpack Securities',
  ondo: 'Ondo Global Markets',
  prestocks: 'PreStocks',
}

/** The issuer's name as a row says it; an issuer the app has no word for keeps its id. */
export function issuerLabel(id: StockIssuerId, form: 'short' | 'full' = 'short'): string {
  return (form === 'short' ? ISSUER_SHORT : ISSUER_FULL)[id] ?? id
}

const SUPPORTED_ISSUERS: ReadonlySet<string> = new Set(Object.keys(ISSUER_SHORT))

/**
 * The issuers whose tokens the app offers — the ones whose own documents its
 * words stand on. Private companies come through PreStocks
 * alone: a token of any other issuer is not listed, searched or
 * bought here, and one a wallet still holds reads as no longer supported.
 */
export function isSupportedIssuer(id: string | null | undefined): boolean {
  return typeof id === 'string' && SUPPORTED_ISSUERS.has(id)
}

type VenueRow = Readonly<{ category: string | null; issuer: Readonly<{ label: string; tag: string }> | null }>

/** Whether a venue's row is offered in a list or a search: a stock token only from a supported issuer. */
export function isOfferedMarket(row: VenueRow): boolean {
  return row.category !== 'stock' || row.issuer === null || isSupportedIssuer(row.issuer.tag)
}

/** A row a person keeps (the watchlist, History's names): a token of an issuer the app does not support names no issuer. */
export function withoutRetiredIssuer<T extends VenueRow>(row: T): T {
  return row.issuer !== null && !isSupportedIssuer(row.issuer.tag) ? { ...row, issuer: null } : row
}

/**
 * The session word beside a stock, in both languages — the web's own
 * (`lib/stocks/session.ts`); unknown is a dash, never a guess.
 */
export const SESSION_WORDS: Readonly<Record<Locale, Readonly<Record<SessionPeriod, string>>>> = {
  en: {
    market: 'Market open',
    extended: 'Extended hours',
    overnight: 'Overnight',
    // The exchange behind the token, not the token: it trades around the clock (M44.6).
    closed: 'Exchange closed',
    unknown: 'Session —',
  },
  uk: {
    market: 'Сесія відкрита',
    extended: 'Подовжені години',
    overnight: 'Нічна сесія',
    closed: 'Біржа зачинена',
    unknown: 'Сесія —',
  },
}

/** The reference's state in both languages — the web's own words. */
export const REFERENCE_WORDS: Readonly<Record<Locale, Readonly<Record<ReferenceState, string>>>> = {
  en: {
    current: 'Current',
    'last-available': 'Last available',
    'confirmed-close': 'Confirmed close',
    stale: 'Stale',
    unavailable: 'Unavailable',
  },
  uk: {
    current: 'Поточний',
    'last-available': 'Останній доступний',
    'confirmed-close': 'Підтверджене закриття',
    stale: 'Застарілий',
    unavailable: 'Недоступно',
  },
}

export function sessionWord(period: SessionPeriod, locale: Locale = 'en'): string {
  return SESSION_WORDS[locale][period]
}

export function referenceWord(state: ReferenceState, locale: Locale = 'en'): string {
  return REFERENCE_WORDS[locale][state]
}

/** A fetch older than this is stale whatever the session says. */
export const REFERENCE_STALE_AFTER_MS = 5 * 60 * 1000

/**
 * The state of a reference figure fetched at `fetchedAt`, judged at `nowMs`:
 * no figure → unavailable; fetched too long ago → stale, even with the
 * exchange open; exchange open → current; closed or unknown → last available,
 * never a confirmed close, which only a source stating an official close may say.
 */
export function judgeReference(
  input: Readonly<{ perShare: number | null; fetchedAt: string | null; exchangeOpen: boolean | null; nowMs: number }>,
): ReferenceState {
  if (input.perShare === null || !Number.isFinite(input.perShare) || input.perShare <= 0) return 'unavailable'
  const fetched = input.fetchedAt === null ? Number.NaN : Date.parse(input.fetchedAt)
  if (!Number.isFinite(fetched) || input.nowMs - fetched > REFERENCE_STALE_AFTER_MS) return 'stale'
  return input.exchangeOpen === true ? 'current' : 'last-available'
}

/** The universe row's own state, re-judged now: the exchange is open only in the market period. */
export function judgeUniverseRow(row: StockUniverseRow, nowMs: number): ReferenceState {
  return judgeReference({
    perShare: row.reference,
    fetchedAt: row.referenceAt,
    exchangeOpen: row.period === 'unknown' ? null : row.period === 'market',
    nowMs,
  })
}

/** A multiplier differs from one when the token stands for more or less than a whole share. */
export function isScaled(multiplier: number | null | undefined): multiplier is number {
  return typeof multiplier === 'number' && Number.isFinite(multiplier) && Math.abs(multiplier - 1) > 1e-9
}

/** `1 NVDAx = 1.001701 NVDA` · `1 NVDAx = 1,001701 NVDA` — the units line, only through a known multiplier. */
export function unitsLine(
  symbol: string,
  underlying: string,
  multiplier: number | null | undefined,
  locale: Locale = 'en',
): string | null {
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) return null
  const figure = multiplier.toFixed(6)
  return `1 ${symbol} = ${locale === 'uk' ? figure.replace('.', ',') : figure} ${underlying}`
}
