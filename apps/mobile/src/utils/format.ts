/**
 * Figures on a Ryntra screen carry their own truth: an unknown value is a dash,
 * never a zero; every time is shown; a stale figure says so. These helpers are
 * the only place the app turns numbers and times into text.
 */

import type { Locale } from '@/lib/i18n'

export const DASH = '—'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const usdSmall = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * Ukrainian groups with a space and decimals with a comma — «$1 409,69»,
 * «+0,27%» (canon §2, rule 2). The dollar sign stays in front, as the web
 * line writes it; the English shapes below are unchanged.
 */
const ukMoney = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ukSmall = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
const ukPercent = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The words a time needs in each language; figures themselves never change. */
const TIME_WORDS: Readonly<
  Record<
    Locale,
    {
      justNow: string
      minutes: string
      hours: string
      days: string
      ago: string
      today: string
      tomorrow: string
      yesterday: string
    }
  >
> = {
  en: {
    justNow: 'just now',
    minutes: 'min',
    hours: 'h',
    days: 'd',
    ago: 'ago',
    today: 'today',
    tomorrow: 'tomorrow',
    yesterday: 'yesterday',
  },
  uk: {
    justNow: 'щойно',
    minutes: 'хв',
    hours: 'год',
    days: 'д',
    ago: 'тому',
    today: 'сьогодні',
    tomorrow: 'завтра',
    yesterday: 'вчора',
  },
}

function isFinite_(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * A USD price: two decimals from $1 up, up to six below it, and below a
 * millionth four significant digits — a meme's per-token price is never
 * written as $0.00; a dash when unknown.
 */
export function formatPrice(value: number | null | undefined, locale: Locale = 'en'): string {
  if (!isFinite_(value)) return DASH
  if (locale === 'uk') return ukPrice(value)
  if (value === 0) return usd.format(0)
  const magnitude = Math.abs(value)
  if (magnitude >= 1) return usd.format(value)
  if (magnitude >= 0.000001) return usdSmall.format(value)
  const places = Math.min(20, 3 - Math.floor(Math.log10(magnitude)))
  return `${value < 0 ? '−' : ''}$${magnitude.toFixed(places).replace(/0+$/, '')}`
}

/** The same price in the Ukrainian shape: «$224,66», «$0,00042». */
function ukPrice(value: number): string {
  const magnitude = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (magnitude === 0) return `$${ukMoney.format(0)}`
  if (magnitude >= 1) return `${sign}$${ukMoney.format(magnitude)}`
  if (magnitude >= 0.000001) return `${sign}$${ukSmall.format(magnitude)}`
  const places = Math.min(20, 3 - Math.floor(Math.log10(magnitude)))
  return `${sign}$${magnitude.toFixed(places).replace(/0+$/, '').replace('.', ',')}`
}

/** A USD amount of money — always two decimals ($1,234.56 · $1 234,56); a positive amount under a cent says so; a dash when unknown. */
export function formatUsd(value: number | null | undefined, locale: Locale = 'en'): string {
  if (!isFinite_(value)) return DASH
  const cent = locale === 'uk' ? '<$0,01' : '<$0.01'
  if (value > 0 && value < 0.005) return cent
  if (value < 0 && value > -0.005) return `−${cent}`
  if (locale === 'uk') return `${value < 0 ? '−' : ''}$${ukMoney.format(Math.abs(value))}`
  return value < 0 ? `−${usd.format(-value)}` : usd.format(value)
}

/** A signed USD change (+$12.30, −$0.45 · +$12,30); a dash when unknown. */
export function formatUsdSigned(value: number | null | undefined, locale: Locale = 'en'): string {
  if (!isFinite_(value)) return DASH
  const rounded = Math.round(Math.abs(value) * 100) / 100
  const money = (amount: number) => (locale === 'uk' ? `$${ukMoney.format(amount)}` : usd.format(amount))
  if (rounded === 0) return money(0)
  return `${value > 0 ? '+' : '−'}${money(rounded)}`
}

/**
 * A USD amount for volumes and liquidity — compact ($27.9M · $27,9M: the web's
 * Spot keeps the K, M and B in both languages, the comma is Ukrainian's), a dash
 * when unknown.
 */
export function formatUsdCompact(value: number | null | undefined, locale: Locale = 'en'): string {
  if (!isFinite_(value)) return DASH
  const text = compact.format(value)
  return `$${locale === 'uk' ? text.replace('.', ',') : text}`
}

/** A signed percentage (+0.27%, −1.20% · +0,27%); a dash when unknown. */
export function formatPercent(value: number | null | undefined, locale: Locale = 'en'): string {
  if (!isFinite_(value)) return DASH
  const rounded = Math.round(Math.abs(value) * 100) / 100
  const sign = rounded === 0 ? '' : value > 0 ? '+' : '−'
  return `${sign}${(locale === 'uk' ? ukPercent : percent).format(rounded)}%`
}

/** Direction of a signed figure — the tone a chip takes. Zero and unknown are neutral. */
export function signOf(value: number | null | undefined): 'up' | 'down' | 'flat' {
  if (!isFinite_(value) || value === 0) return 'flat'
  return value > 0 ? 'up' : 'down'
}

/** Wall-clock time of an ISO timestamp (HH:MM, 24h); a dash when absent or unparsable. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return DASH
  const time = Date.parse(iso)
  return Number.isNaN(time) ? DASH : clock.format(new Date(time))
}

/** Age of an ISO timestamp against `now`: "just now", "2 min ago", "3 h ago", "2 d ago" — in the given language. */
export function formatAge(iso: string | null | undefined, now: number = Date.now(), locale: Locale = 'en'): string {
  if (!iso) return DASH
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return DASH
  const words = TIME_WORDS[locale]
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 45) return words.justNow
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} ${words.minutes} ${words.ago}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ${words.hours} ${words.ago}`
  return `${Math.round(hours / 24)} ${words.days} ${words.ago}`
}

/** A base58 address for a row: first four, an ellipsis, last four. */
export function shortAddress(address: string | null | undefined, edge = 4): string {
  if (!address) return DASH
  if (address.length <= edge * 2 + 1) return address
  return `${address.slice(0, edge)}…${address.slice(-edge)}`
}

/** The number shape of each language: «1,234.5» · «1 234,5». */
const NUMBER_TAG: Readonly<Record<Locale, string>> = { en: 'en-US', uk: 'uk-UA' }

/** A token amount with up to `maxFractionDigits` decimals, trailing zeros trimmed; a dash when unknown. */
export function formatAmount(value: number | null | undefined, maxFractionDigits = 6, locale: Locale = 'en'): string {
  if (!isFinite_(value)) return DASH
  return new Intl.NumberFormat(NUMBER_TAG[locale], { maximumFractionDigits: maxFractionDigits }).format(value)
}

const monthShort: Readonly<Record<Locale, Intl.DateTimeFormat>> = {
  en: new Intl.DateTimeFormat('en-US', { month: 'short' }),
  uk: new Intl.DateTimeFormat('uk-UA', { month: 'short' }),
}

/** Day and month, day first (14 Sep · 14 вер.) — a short month in the given language. */
function dayMonth(date: Date, locale: Locale = 'en'): string {
  return `${date.getDate()} ${monthShort[locale].format(date)}`
}

/** A calendar day (14 Sep), with its year when it is not this year (10 May 2025); a dash when absent or unparsable. */
export function formatDay(iso: string | null | undefined, now: number = Date.now(), locale: Locale = 'en'): string {
  if (!iso) return DASH
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return DASH
  const date = new Date(time)
  const day = dayMonth(date, locale)
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${date.getFullYear()}`
}

function daysFromToday(time: number, now: number): number {
  const dayOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  return Math.round((dayOf(new Date(time)) - dayOf(new Date(now))) / 86_400_000)
}

/**
 * The day a statement groups by: "Today" and "Yesterday" as words, the day
 * itself otherwise (17 Sep, 10 May 2025) — in the given language.
 */
export function formatDayHeading(
  iso: string | null | undefined,
  now: number = Date.now(),
  locale: Locale = 'en',
): string {
  if (!iso) return DASH
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return DASH
  const days = daysFromToday(time, now)
  const words = TIME_WORDS[locale]
  const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
  if (days === 0) return capital(words.today)
  if (days === -1) return capital(words.yesterday)
  return formatDay(iso, now, locale)
}

/**
 * A moment as a person reads it against now: the clock alone today
 * ("11:24"), "tomorrow 11:24" or "yesterday 11:24" a day away, the day and
 * clock otherwise ("17 Sep 11:24"); a dash when absent or unparsable.
 */
export function formatMoment(iso: string | null | undefined, now: number = Date.now(), locale: Locale = 'en'): string {
  if (!iso) return DASH
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return DASH
  const days = daysFromToday(time, now)
  const at = clock.format(new Date(time))
  const words = TIME_WORDS[locale]
  if (days === 0) return at
  if (days === 1) return `${words.tomorrow} ${at}`
  if (days === -1) return `${words.yesterday} ${at}`
  return `${formatDay(iso, now, locale)} ${at}`
}

/**
 * The time of a chart bar, as the window needs it: a clock inside a day
 * (`intraday`), day and clock across a few days (`days`), the day alone
 * across months (`months`). Unix seconds in; a dash when not a time.
 */
export function formatBarTime(
  unixSeconds: number,
  scale: 'intraday' | 'days' | 'months',
  locale: Locale = 'en',
): string {
  if (!Number.isFinite(unixSeconds)) return DASH
  const date = new Date(unixSeconds * 1000)
  if (scale === 'intraday') return clock.format(date)
  if (scale === 'days') return `${dayMonth(date, locale)} ${clock.format(date)}`
  return dayMonth(date, locale)
}

/** A whole count (holders, traders) with thousands separators (9,997 · 9 997); a dash when unknown. */
export function formatCount(value: number | null | undefined, locale: Locale = 'en'): string {
  if (!isFinite_(value)) return DASH
  return new Intl.NumberFormat(NUMBER_TAG[locale], { maximumFractionDigits: 0 }).format(value)
}

/** A percentage with no sign for shares of a whole (top holders 30.7% · 30,7%); a dash when unknown. */
export function formatShare(value: number | null | undefined, locale: Locale = 'en'): string {
  if (!isFinite_(value)) return DASH
  return `${new Intl.NumberFormat(NUMBER_TAG[locale], { maximumFractionDigits: 1 }).format(value)}%`
}
