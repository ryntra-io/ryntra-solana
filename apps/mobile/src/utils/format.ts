/**
 * Figures on a Ryntra screen carry their own truth: an unknown value is a dash,
 * never a zero; every time is shown; a stale figure says so. These helpers are
 * the only place the app turns numbers and times into text.
 */

import type { Locale } from '@/lib/i18n'

export const DASH = '—'

/** What a screen reader says for a dash that stands for an unknown figure — never «тире». */
export const UNKNOWN_SPOKEN: Readonly<Record<Locale, string>> = { en: 'unknown', uk: 'невідомо' }
/** What it says for a sum the eye on Home hid — never a row of bullets. */
export const HIDDEN_SPOKEN: Readonly<Record<Locale, string>> = { en: 'hidden', uk: 'приховано' }
const HIDDEN_MARK = /^•{3,}$/

/** A figure as a screen reader says it: an unknown value's dash is «невідомо», a hidden sum «приховано»; else as it is. */
export function saidFigure(value: string, locale: Locale): string {
  const trimmed = value.trim()
  if (trimmed === DASH) return UNKNOWN_SPOKEN[locale]
  if (HIDDEN_MARK.test(trimmed)) return HIDDEN_SPOKEN[locale]
  return writtenOut(value)
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'
const SUBSCRIPT_PRICE = /0([.,])0([₀-₉]+)(\d+)/g

/** A tiny price's zeros counted in a subscript («0.0₅501») written out for a screen reader («0.00000501»). */
function writtenOut(text: string): string {
  return text.replace(SUBSCRIPT_PRICE, (_match, sep: string, sub: string, digits: string) => {
    const zeros = Number(
      sub
        .split('')
        .map((mark) => SUBSCRIPT.indexOf(mark))
        .join(''),
    )
    return `0${sep}${'0'.repeat(zeros)}${digits}`
  })
}

/**
 * A text's own label for a screen reader when it shows an unknown figure: the dash alone, or the dash before its unit
 * («— SOL»), is said as «невідомо». Null when the text says no unknown figure — a dash inside a sentence stays a dash.
 */
export function spokenUnknown(text: string, locale: Locale): string | null {
  const trimmed = text.trim()
  if (trimmed === DASH) return UNKNOWN_SPOKEN[locale]
  if (HIDDEN_MARK.test(trimmed)) return HIDDEN_SPOKEN[locale]
  if (trimmed.startsWith(`${DASH} `)) return `${UNKNOWN_SPOKEN[locale]}${trimmed.slice(DASH.length)}`
  return null
}

/**
 * What a text is said as, always a string: its unknown figure as «невідомо» (see `spokenUnknown`), else the text
 * itself. A text passes it on every render so a screen reader's label follows the figure — Android keeps the last
 * label it was given when the prop is dropped, so a «—» that fills in would still be read as «невідомо».
 */
export function spokenText(text: string, locale: Locale): string {
  return spokenUnknown(text, locale) ?? writtenOut(text)
}

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
/** Below a cent a price keeps three significant digits, so look-alike tokens never read as the same «$0.000003». */
const tinySignificant: Readonly<Record<Locale, Intl.NumberFormat>> = {
  en: new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3, maximumFractionDigits: 20 }),
  uk: new Intl.NumberFormat('uk-UA', { maximumSignificantDigits: 3, maximumFractionDigits: 20 }),
}
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * Ukrainian groups with a space and decimals with a comma — «$1 409,69»,
 * «+0,27%». The dollar sign stays in front, as the web
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
 * A USD price: two decimals from $1 up, up to six from a cent, and below a
 * cent three significant digits — «$0.00123»; from four zeros after the point
 * the zeros are counted in a subscript, as launch pages write it: «$0.0₅501».
 * A meme's per-token price is never written as $0.00, and look-alikes never
 * read as one price; a dash when unknown.
 */
export function formatPrice(value: number | null | undefined, locale: Locale): string {
  if (!isFinite_(value)) return DASH
  if (locale === 'uk') return ukPrice(value)
  if (value === 0) return usd.format(0)
  const magnitude = Math.abs(value)
  if (magnitude >= 1) return usd.format(value)
  if (magnitude >= 0.01) return usdSmall.format(value)
  return `${value < 0 ? '−' : ''}$${tinyPrice(magnitude, locale)}`
}

/**
 * A price in a list's column: as `formatPrice`, but between a cent and a dollar at most four significant digits —
 * «$0.1447», never «$0.144709» beside «$1.72» — so the column reads at one precision. Below a cent the three
 * significant digits and the subscript stay; a dash when unknown.
 */
export function formatListPrice(value: number | null | undefined, locale: Locale): string {
  if (!isFinite_(value)) return DASH
  const magnitude = Math.abs(value)
  if (magnitude >= 0.01 && magnitude < 1) return formatPrice(Number(value.toPrecision(4)), locale)
  return formatPrice(value, locale)
}

/** The same price in the Ukrainian shape: «$224,66», «$0,00042», «$0,0₅501». */
function ukPrice(value: number): string {
  const magnitude = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (magnitude === 0) return `$${ukMoney.format(0)}`
  if (magnitude >= 1) return `${sign}$${ukMoney.format(magnitude)}`
  if (magnitude >= 0.01) return `${sign}$${ukSmall.format(magnitude)}`
  return `${sign}$${tinyPrice(magnitude, 'uk')}`
}

/**
 * A positive price below a cent with three significant digits: «0.00123» written out while it has fewer than four
 * zeros after the point, «0.0₅501» (five zeros, then 501) from four — the launch pages' shape.
 */
function tinyPrice(magnitude: number, locale: Locale): string {
  const sep = locale === 'uk' ? ',' : '.'
  let zeros = Math.ceil(-Math.log10(magnitude) - 1e-12) - 1
  let digits = Math.round(magnitude * 10 ** (zeros + 3))
  // A figure the rounding carries to a thousand (0.00000999 → 0.0000100) has one zero fewer.
  if (digits >= 1000) {
    zeros -= 1
    digits = Math.round(digits / 10)
  }
  const shown = digits.toString().replace(/0+$/, '') || '0'
  if (zeros < 4) return tinySignificant[locale].format(Number(`0.${'0'.repeat(zeros)}${shown}`))
  const sub = String(zeros)
    .split('')
    .map((digit) => SUBSCRIPT[Number(digit)])
    .join('')
  return `0${sep}0${sub}${shown}`
}

/** A USD amount of money — always two decimals ($1,234.56 · $1 234,56); a positive amount under a cent says so; a dash when unknown. */
export function formatUsd(value: number | null | undefined, locale: Locale): string {
  if (!isFinite_(value)) return DASH
  const cent = locale === 'uk' ? '<$0,01' : '<$0.01'
  if (value > 0 && value < 0.005) return cent
  if (value < 0 && value > -0.005) return `−${cent}`
  if (locale === 'uk') return `${value < 0 ? '−' : ''}$${ukMoney.format(Math.abs(value))}`
  return value < 0 ? `−${usd.format(-value)}` : usd.format(value)
}

/** A signed USD change (+$12.30, −$0.45 · +$12,30); a dash when unknown. */
export function formatUsdSigned(value: number | null | undefined, locale: Locale): string {
  if (!isFinite_(value)) return DASH
  const rounded = Math.round(Math.abs(value) * 100) / 100
  const money = (amount: number) => (locale === 'uk' ? `$${ukMoney.format(amount)}` : usd.format(amount))
  if (rounded === 0) return money(0)
  return `${value > 0 ? '+' : '−'}${money(rounded)}`
}

/** Ukrainian's own words for the compact sizes, as «Про компанію» writes them (`company-facts.ts`: «$303 млрд»). */
const UK_COMPACT: readonly Readonly<{ size: number; word: string }>[] = [
  { size: 1e12, word: 'трлн' },
  { size: 1e9, word: 'млрд' },
  { size: 1e6, word: 'млн' },
  { size: 1e3, word: 'тис.' },
]
const ukCompact = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 })

/** «$2,7 млрд» · «$926,3 млн» · «$110,5 тис.» · «$512,3» — the English compact's rounding, Ukrainian's words. */
function ukUsdCompact(value: number): string {
  const magnitude = Math.abs(value)
  let index = UK_COMPACT.findIndex((unit) => magnitude >= unit.size)
  let scaled = index === -1 ? magnitude : magnitude / UK_COMPACT[index]!.size
  // A figure the rounding carries to a thousand of its size is said in the next one, as English says «$1M», never «$1000K».
  if (Math.round(scaled * 10) / 10 >= 1000 && index !== 0) {
    index = index === -1 ? UK_COMPACT.length - 1 : index - 1
    scaled = magnitude / UK_COMPACT[index]!.size
  }
  const word = index === -1 ? '' : ` ${UK_COMPACT[index]!.word}`
  return `${value < 0 ? '−' : ''}$${ukCompact.format(scaled)}${word}`
}

/**
 * A USD amount for volumes and liquidity — compact: «$27.9M» in English,
 * «$27,9 млн» in Ukrainian (the words «Про компанію» uses); a dash when unknown.
 */
export function formatUsdCompact(value: number | null | undefined, locale: Locale): string {
  if (!isFinite_(value)) return DASH
  if (locale === 'uk') return ukUsdCompact(value)
  return `$${compact.format(value)}`
}

/** A signed percentage (+0.27%, −1.20% · +0,27%); a dash when unknown. */
export function formatPercent(value: number | null | undefined, locale: Locale): string {
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

/**
 * Direction of a percentage as `formatPercent` writes it: a move that rounds to «0,00%» is neutral, never a red or
 * green zero (ST-5 r4: BONK's −0.004% read as a red «0,00%»).
 */
export function percentSignOf(value: number | null | undefined): 'up' | 'down' | 'flat' {
  if (!isFinite_(value)) return 'flat'
  return Math.round(Math.abs(value) * 100) === 0 ? 'flat' : signOf(value)
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

/**
 * A token amount with up to `maxFractionDigits` decimals, trailing zeros trimmed down to `minFractionDigits` (none by
 * default; a column of sizes keeps them, so its decimals line up); a dash when unknown.
 */
export function formatAmount(
  value: number | null | undefined,
  maxFractionDigits: number,
  locale: Locale,
  minFractionDigits = 0,
): string {
  if (!isFinite_(value)) return DASH
  return new Intl.NumberFormat(NUMBER_TAG[locale], {
    minimumFractionDigits: Math.min(minFractionDigits, maxFractionDigits),
    maximumFractionDigits: maxFractionDigits,
  }).format(value)
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

/** Whether an ISO timestamp falls on `now`'s own day; false when absent or unparsable. */
export function isToday(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false
  const time = Date.parse(iso)
  return !Number.isNaN(time) && daysFromToday(time, now) === 0
}

/**
 * A time with its preposition, as a line says it: «о 14:32», «вчора о
 * 22:30», «3 жовт. о 08:30» — "at 14:32", "yesterday at 22:30", "3 Oct at
 * 08:30". A read kept from another day names its day, so it never reads as
 * today's. A dash when absent or unparsable.
 */
export function formatAt(iso: string | null | undefined, now: number, locale: Locale = 'en'): string {
  if (!iso) return DASH
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return DASH
  const days = daysFromToday(time, now)
  const at = clock.format(new Date(time))
  const words = TIME_WORDS[locale]
  const preposition = locale === 'uk' ? 'о' : 'at'
  const day =
    days === 0 ? null : days === 1 ? words.tomorrow : days === -1 ? words.yesterday : formatDay(iso, now, locale)
  return day ? `${day} ${preposition} ${at}` : `${preposition} ${at}`
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
export function formatCount(value: number | null | undefined, locale: Locale): string {
  if (!isFinite_(value)) return DASH
  return new Intl.NumberFormat(NUMBER_TAG[locale], { maximumFractionDigits: 0 }).format(value)
}

/** A percentage with no sign for shares of a whole (top holders 30.7% · 30,7%); a dash when unknown. */
export function formatShare(value: number | null | undefined, locale: Locale): string {
  if (!isFinite_(value)) return DASH
  return `${new Intl.NumberFormat(NUMBER_TAG[locale], { maximumFractionDigits: 1 }).format(value)}%`
}

/**
 * A sentence or figure the server printed in the English shape, said in the
 * language's: in Ukrainian «$1,234.50» reads «$1 234,50» and «0.25%» «0,25%»;
 * English is left as it came. Only figures change, never the words.
 */
export function localizeFigures(text: string, locale: Locale): string {
  if (locale !== 'uk') return text
  return text.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+/g, (figure) => {
    const [whole, fraction] = figure.split('.')
    const grouped = whole.replace(/,/g, ' ')
    return fraction === undefined ? grouped : `${grouped},${fraction}`
  })
}
